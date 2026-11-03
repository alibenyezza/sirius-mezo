import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MUSD_BORROWING_RATE_BPS, MUSD_MCR } from "./protocol";
import {
  borrowingFee,
  drawQuote,
  icr,
  nominalIcr,
  ONE,
  REASON_BELOW_THRESHOLD,
  REASON_CAPACITY,
  REASON_NO_TROVE,
  REASON_RECOVERY_MODE,
} from "./trove-math";

const E18 = BigInt(10) ** BigInt(18);
const usd = (n: number) => BigInt(n) * E18;
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);

// Vecteur de référence : 1 BTC à 77 000 $, dette 2 000 MUSD, tirage de 10 MUSD.
const COLL = ONE;
const PRICE = usd(77_000);
const DEBT = usd(2_000);

describe("icr / nominalIcr", () => {
  it("calcule le ratio en 1e18 : 1 BTC à 77 000 $ sur 2 000 MUSD = 38,5", () => {
    assert.equal(icr(COLL, DEBT, PRICE), BigInt("38500000000000000000"));
  });

  it("arrondit vers le bas comme le contrat", () => {
    // 1 BTC à 100 000 $ sur 3 MUSD : 33 333,33… → troncature.
    assert.equal(icr(ONE, usd(3), usd(100_000)), BigInt("33333333333333333333333"));
  });

  it("rend uint256.max sans dette, comme TroveManager", () => {
    assert.equal(icr(ONE, BigInt(0), PRICE), UINT256_MAX);
    assert.equal(nominalIcr(ONE, BigInt(0)), UINT256_MAX);
  });

  it("le ratio nominal vaut coll * 1e20 / debt, indépendant du prix", () => {
    assert.equal(nominalIcr(COLL, DEBT), BigInt("50000000000000000")); // 1e38 / 2e21
    assert.equal(nominalIcr(usd(2), usd(1)), BigInt(2) * BigInt(10) ** BigInt(20));
  });

  it("refuse les valeurs négatives", () => {
    assert.throws(() => icr(-ONE, DEBT, PRICE), RangeError);
    assert.throws(() => nominalIcr(ONE, -DEBT), RangeError);
  });
});

describe("borrowingFee", () => {
  it("0,1 % de 10 MUSD = 0,01 MUSD, valeur rendue par BorrowerOperations.getBorrowingFee", () => {
    assert.equal(borrowingFee(usd(10), MUSD_BORROWING_RATE_BPS), BigInt("10000000000000000"));
  });

  it("tronque vers le bas et accepte un taux en bigint", () => {
    assert.equal(borrowingFee(BigInt(999), 10), BigInt(0));
    assert.equal(borrowingFee(BigInt(1_000), BigInt(10)), BigInt(1));
    assert.equal(borrowingFee(usd(100), 0), BigInt(0));
  });
});

describe("drawQuote", () => {
  const base = {
    coll: COLL,
    debt: DEBT,
    price: PRICE,
    feeRateBps: MUSD_BORROWING_RATE_BPS,
    mcr: MUSD_MCR,
    safetyMarginBps: 1_000,
  };

  it("autorise 10 MUSD sur un trove largement couvert", () => {
    const quote = drawQuote({ ...base, amount: usd(10) });
    assert.equal(quote.fee, BigInt("10000000000000000"));
    assert.equal(quote.newDebt, BigInt("2010010000000000000000"));
    // 77 000e18 × 1e18 / 2 010,01e18 = 38,308…
    assert.equal(quote.newIcr, (COLL * PRICE) / quote.newDebt);
    assert.equal(quote.newIcr, BigInt("38308267123049139059"));
    assert.equal(quote.threshold, BigInt("1210000000000000000")); // 1,10 × 1,10
    assert.equal(quote.allowed, true);
    assert.equal(quote.reason, null);
  });

  it("refuse sans trove actif, mais rend quand même le devis chiffré", () => {
    const quote = drawQuote({ ...base, debt: BigInt(0), amount: usd(10) });
    assert.equal(quote.allowed, false);
    assert.equal(quote.reason, REASON_NO_TROVE);
    assert.equal(quote.newDebt, BigInt("10010000000000000000"));
  });

  it("refuse un tirage qui passerait sous MCR × (1 + marge)", () => {
    // 1 BTC à 77 000 $ : dette maximale au seuil 1,21 = 63 636,36 MUSD.
    // Tirer 61 700 MUSD (+ 61,7 de frais) → dette 63 761,7 : au-dessus, refusé.
    const refused = drawQuote({ ...base, amount: usd(61_700) });
    assert.equal(refused.allowed, false);
    assert.equal(refused.reason, REASON_BELOW_THRESHOLD);
    assert.ok(refused.newIcr < refused.threshold);

    // Tirer 61 500 MUSD → dette 63 561,5 : en dessous, encore permis.
    const allowed = drawQuote({ ...base, amount: usd(61_500) });
    assert.equal(allowed.allowed, true);
    assert.ok(allowed.newIcr >= allowed.threshold);
  });

  it("sans marge, le seuil est exactement le MCR", () => {
    const quote = drawQuote({ ...base, safetyMarginBps: 0, amount: usd(10) });
    assert.equal(quote.threshold, MUSD_MCR);
  });

  it("la borne est inclusive : un ratio égal au seuil reste permis", () => {
    // 1,21 BTC à 1 000 $ sur 1 000 MUSD, sans frais ni tirage : ratio exactement 1,21.
    const quote = drawQuote({
      ...base,
      coll: BigInt("1210000000000000000"),
      debt: usd(1_000),
      price: usd(1_000),
      amount: BigInt(0),
      feeRateBps: 0,
    });
    assert.equal(quote.newIcr, quote.threshold);
    assert.equal(quote.allowed, true);
  });

  it("des frais fournis par le contrat priment sur le taux", () => {
    const quote = drawQuote({ ...base, amount: usd(10), fee: BigInt(123) });
    assert.equal(quote.fee, BigInt(123));
    assert.equal(quote.newDebt, DEBT + usd(10) + BigInt(123));
    assert.throws(() => drawQuote({ ...base, amount: usd(10), fee: BigInt(-1) }), RangeError);
  });

  it("refuse un montant négatif", () => {
    assert.throws(() => drawQuote({ ...base, amount: -usd(1) }), RangeError);
  });
});

it("refuse un tirage en Recovery Mode sous le CCR, et au-delà du plafond du trove", () => {
  const base = {
    coll: BigInt("100000000000000000"), debt: BigInt("2000000000000000000000"), price: BigInt("77000000000000000000000"),
    amount: BigInt("100000000000000000000"), feeRateBps: 10, mcr: BigInt("1100000000000000000"), safetyMarginBps: 1_000,
  };
  // Ratio après tirage ≈ 366 % : permis hors Recovery Mode comme dedans.
  assert.equal(drawQuote(base).allowed, true);
  assert.equal(drawQuote({ ...base, recoveryMode: true, ccr: BigInt("1500000000000000000") }).allowed, true);
  const tight = { ...base, coll: BigInt("40000000000000000") }; // ≈ 146 %
  assert.equal(drawQuote(tight).allowed, true);
  const recovery = drawQuote({ ...tight, recoveryMode: true, ccr: BigInt("1500000000000000000") });
  assert.equal(recovery.allowed, false);
  assert.equal(recovery.reason, REASON_RECOVERY_MODE);
  const capped = drawQuote({ ...base, maxBorrowingCapacity: BigInt("2050000000000000000000") });
  assert.equal(capped.allowed, false);
  assert.equal(capped.reason, REASON_CAPACITY);
  assert.equal(drawQuote({ ...base, maxBorrowingCapacity: BigInt(0) }).allowed, true);
});
