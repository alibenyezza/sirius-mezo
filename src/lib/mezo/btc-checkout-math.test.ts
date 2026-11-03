import assert from "node:assert/strict";
import test from "node:test";
import { btcCheckoutQuote, BtcQuoteError } from "./btc-checkout-math";

const E = (n: string) => BigInt(Math.round(Number(n) * 1e6)) * BigInt(10) ** BigInt(12);
const PRICE = E("77000");

/** Pool à prix constant `rate` MUSD par BTC, frais compris. */
const pool = (rate: bigint) => async (btcIn: bigint) => btcIn * rate / BigInt(10) ** BigInt(18);

test("couvre le prix au cours du pool, avec un petit surplus", async () => {
  const quote = await btcCheckoutQuote({ amount: E("5"), oraclePrice: PRICE, maxSlippageBps: BigInt(300), quoteOut: pool(E("78500")) });
  assert.ok(BigInt(quote.expectedMusd) >= E("5"));
  assert.ok(BigInt(quote.leftoverMusd) < E("0.2"));
  assert.equal(quote.minMusdOut, E("5").toString());
});

test("ajuste quand le pool rend moins que l'oracle", async () => {
  const quote = await btcCheckoutQuote({ amount: E("5"), oraclePrice: PRICE, maxSlippageBps: BigInt(300), quoteOut: pool(E("75500")) });
  assert.ok(BigInt(quote.expectedMusd) >= E("5"));
  assert.ok(BigInt(quote.expectedMusd) >= BigInt(quote.oracleFloor));
});

test("refuse un pool trop loin de l'oracle et un pool vide", async () => {
  await assert.rejects(
    btcCheckoutQuote({ amount: E("5"), oraclePrice: PRICE, maxSlippageBps: BigInt(300), quoteOut: pool(E("70000")) }),
    (error: unknown) => error instanceof BtcQuoteError && /écarte/.test(error.message),
  );
  await assert.rejects(
    btcCheckoutQuote({ amount: E("5"), oraclePrice: PRICE, maxSlippageBps: BigInt(300), quoteOut: async () => BigInt(0) }),
    BtcQuoteError,
  );
});
