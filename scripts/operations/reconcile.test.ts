import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Hex } from "viem";
import { FIXTURE_CHAIN_ID, FIXTURE_ESCROW, FIXTURE_LOANS, FIXTURE_TX } from "./accounting-fixture";
import type { RawLog } from "./escrow-events";
import { eventsDocument, rawLog } from "./escrow-testkit";
import { reconcile } from "./reconcile.mjs";

interface Gap { severity: string; code: string; ref: string | null }
interface Entry { key: string; kind: string; classification: string; observations: number; firstSeenAtMs: number }
interface AccountRow { address: string; outstandingAtomic: string; accruedAtomic: string; withdrawnAtomic: string }

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const committed = read("./fixtures/runner-accounting-export.v1.json");
const plan = read("../../deploy/operations/testnet-plan.json");
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const TX = { release: FIXTURE_TX.release as Hex, failure: FIXTURE_TX.failure as Hex };
const codes = (report: { gaps: Gap[] }) => report.gaps.map((gap) => gap.code);
const E18 = BigInt(10) ** BigInt(18);
const SIRIUS = `0x${"5e".repeat(20)}`;
const BORROWER = `0x${"b0".repeat(20)}`;
const PROVIDER = `0x${"c0".repeat(20)}`;
const DATASET = BigInt(5) * E18;
const COMPUTE = BigInt(7) * E18;
const CAP = BigInt(10) ** BigInt(15);
const FEE = BigInt(250000); // même consommation que le reçu d'échec de l'export synthétique
const REFUND = DATASET + COMPUTE - FEE;
const ESCROWS = [{ address: FIXTURE_ESCROW, version: "v7" as const, fromBlock: BigInt(0) }];
const STABLE = BigInt(200);
const BOUNDS = { lowerMicros: "990000", upperMicros: "1010000" };

function lock(loanKey: string, block: bigint, tx: Hex, seq: bigint, maxFailureFee = CAP) {
  return rawLog("v7", FIXTURE_ESCROW, block, 0, tx, "LoanLocked", { loanKey, borrower: BORROWER, provider: PROVIDER, computeRecipient: SIRIUS,
    datasetAmount: DATASET, computeAmount: COMPUTE, maxFailureFee, deadline: BigInt(1_900_000_000), termsHash: hash(77), seq });
}
const locks = () => [lock(FIXTURE_LOANS.success, BigInt(100), hash(10), BigInt(1)), lock(FIXTURE_LOANS.failure, BigInt(101), hash(11), BigInt(2)), lock(FIXTURE_LOANS.uncertain, BigInt(102), hash(12), BigInt(3))];
function release(loanKey: string, block: bigint, tx: Hex, provider = PROVIDER, computeRecipient = SIRIUS) {
  return [
    rawLog("v7", FIXTURE_ESCROW, block, 0, tx, "CreditAccrued", { account: provider, loanKey, amount: DATASET, balance: DATASET }),
    rawLog("v7", FIXTURE_ESCROW, block, 1, tx, "CreditAccrued", { account: computeRecipient, loanKey, amount: COMPUTE, balance: COMPUTE }),
    rawLog("v7", FIXTURE_ESCROW, block, 2, tx, "LoanReleased", { loanKey, provider, computeRecipient, preimage: hash(88), datasetAmount: DATASET, computeAmount: COMPUTE, seq: BigInt(4) }),
    rawLog("v7", FIXTURE_ESCROW, block, 3, tx, "PreimageRevealed", { hashlock: hash(99), loanKey, preimage: hash(88) }),
  ];
}
function fail(loanKey: string, block: bigint, tx: Hex, retainedFee = FEE) {
  return [
    rawLog("v7", FIXTURE_ESCROW, block, 0, tx, "ExecutionRecorded", { loanKey, consumedCompute: retainedFee, evidenceHash: FIXTURE_TX.failureEvidence, observedAt: BigInt(1_790_000_000), finalFailure: true, seq: BigInt(5) }),
    rawLog("v7", FIXTURE_ESCROW, block, 1, tx, "CreditAccrued", { account: BORROWER, loanKey, amount: DATASET + COMPUTE - retainedFee, balance: DATASET + COMPUTE - retainedFee }),
    rawLog("v7", FIXTURE_ESCROW, block, 2, tx, "CreditAccrued", { account: SIRIUS, loanKey, amount: retainedFee, balance: COMPUTE + retainedFee }),
    rawLog("v7", FIXTURE_ESCROW, block, 3, tx, "LoanFailed", { loanKey, borrower: BORROWER, refundAmount: DATASET + COMPUTE - retainedFee, retainedFee, seq: BigInt(5) }),
  ];
}
const withdraw = (account: string, amount: bigint, block: bigint, tx: Hex) => rawLog("v7", FIXTURE_ESCROW, block, 0, tx, "Withdrawn", { account, amount });

/** Scénario de référence : un succès réglé, un échec mesuré, un calcul incertain, un devis jamais verrouillé. */
const scenarioLogs = () => [...locks(), ...release(FIXTURE_LOANS.success, BigInt(120), TX.release), ...fail(FIXTURE_LOANS.failure, BigInt(130), TX.failure), withdraw(PROVIDER, DATASET, BigInt(140), hash(13))];
async function baseInput(logs: RawLog[] = scenarioLogs(), extra: Record<string, unknown> = {}) {
  const events = await eventsDocument(logs, ESCROWS, STABLE, FIXTURE_CHAIN_ID);
  return { export: committed, events, siriusAccounts: [SIRIUS, committed.wallet], usdcDecimals: 18, usdPerUsdc: BOUNDS, now: 1_800_000_000_000, ...extra };
}

test("chaque montant tombe dans une seule case : revenu Sirius, dû aux tiers, dépôt verrouillé, réservation, incertain", async () => {
  const report = reconcile(await baseInput());
  assert.equal(report.revenue.acquiredAtomic, String(COMPUTE + FEE));
  assert.deepEqual(report.revenue.byCause, { computeOnRelease: String(COMPUTE), retainedOnFailure: String(FEE), retainedOnRefund: "0", other: "0" });
  assert.equal(report.revenue.inEscrowAtomic, String(COMPUTE + FEE));
  assert.equal(report.revenue.withdrawnAtomic, "0");
  const account = (address: string): AccountRow => report.owed.byAccount.find((row: AccountRow) => row.address === address)!;
  assert.deepEqual([account(PROVIDER).accruedAtomic, account(PROVIDER).withdrawnAtomic, account(PROVIDER).outstandingAtomic], [String(DATASET), String(DATASET), "0"]);
  assert.equal(account(BORROWER).outstandingAtomic, String(REFUND));
  assert.equal(report.owed.outstandingAtomic, String(REFUND));
  assert.deepEqual(report.owed.accruedByCause, { providerDataset: String(DATASET), borrowerRefund: String(REFUND), other: "0" });
  assert.equal(report.owed.lockedDepositsAtomic, String(DATASET + COMPUTE));
  assert.deepEqual(report.owed.openLoans, [`${FIXTURE_ESCROW}:${FIXTURE_LOANS.uncertain}`]);
  assert.equal(report.reservations.allocatedUsdMicros, committed.totals.allocatedUsdMicros);
  assert.equal(report.reservations.allocation.usdMicros.matches, true);
  assert.deepEqual([report.uncertain.pendingTransactions, report.uncertain.workflows], [1, 1]);
  // Revenus au plancher (0,99 USD/USDC, arrondi bas), dettes au plafond (1,01, arrondi haut).
  assert.equal(report.revenue.acquiredUsdMicrosLowerBound, "6930000");
  assert.equal(report.owed.outstandingUsdMicrosUpperBound, "12120000");
  assert.equal(report.owed.lockedDepositsUsdMicrosUpperBound, "12120000");
  const found = codes(report);
  for (const expected of ["pending-but-mined", "pending-journal-missing", "execution-uncertain", "gas-receipt-missing"]) assert.ok(found.includes(expected), expected);
  assert.equal(report.severity.critical, 0);
  assert.equal(report.level, "warning");
  assert.deepEqual(report.entries.reduce((acc: Record<string, number>, entry: Entry) => ({ ...acc, [entry.kind]: (acc[entry.kind] ?? 0) + 1 }), {}),
    { loan: 3, workflow: 4, operation: committed.operations.length, account: 3 });
});

test("un dépôt verrouillé n'est jamais un revenu, même au nom du bénéficiaire compute de Sirius", async () => {
  const report = reconcile(await baseInput(locks()));
  assert.equal(report.revenue.acquiredAtomic, "0");
  assert.equal(report.owed.lockedDepositsAtomic, String(BigInt(3) * (DATASET + COMPUTE)));
  assert.equal(report.owed.outstandingAtomic, "0");
  const found = codes(report);
  assert.ok(found.includes("settlement-not-on-chain"));
  assert.ok(found.includes("failure-claim-unrecorded"));
  assert.equal(report.uncertain.claimedFeesUnrecordedAtomic, String(FEE));
  assert.equal(report.severity.critical, 0);
});

test("les relevés réels v5 et v6 du testnet retrouvent 120 USDC dus, un prêt ouvert et aucun revenu Sirius", () => {
  const report = reconcile({ export: committed, events: [read("./fixtures/escrow-events.v6.testnet.json"), read("./fixtures/escrow-events.v5.testnet.json")],
    siriusAccounts: [plan.computeRecipient, plan.runner], usdcDecimals: 18, usdPerUsdc: BOUNDS });
  assert.equal(report.revenue.acquiredAtomic, "0");
  assert.equal(report.owed.outstandingAtomic, String(BigInt(120) * E18));
  assert.equal(report.owed.lockedDepositsAtomic, String(BigInt(10) * E18));
  assert.deepEqual(report.owed.openLoans, ["0x805a2c2deaa3a8926e85fed6b341dacb54cacba0:0xa798c01d64ef7aabc1d1b29f5bc22d26ecdaf1f08ba01b43f28d755a231f7390"]);
  const hardhat: AccountRow = report.owed.byAccount.find((row: AccountRow) => row.address === "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266")!;
  assert.equal(hardhat.outstandingAtomic, String(BigInt(20) * E18));
  assert.equal(report.severity.critical, 0);
  const found = codes(report);
  assert.ok(found.includes("historical-escrow"));
  assert.ok(found.includes("escrow-not-pulled"));
});

test("rejouer le rapprochement met à jour les observations sans doubler ; un recul du registre ou de la chaîne est signalé", async () => {
  const first = reconcile(await baseInput());
  const second = reconcile(await baseInput(scenarioLogs(), { previous: first, now: 1_800_000_600_000 }));
  assert.equal(second.entries.length, first.entries.length);
  assert.ok(second.entries.every((entry: Entry) => entry.observations === 2 && entry.firstSeenAtMs === first.observedAtMs));
  assert.deepEqual([second.revenue, second.owed, second.reservations], [first.revenue, first.owed, first.reservations]);
  assert.ok(!codes(second).includes("classification-regressed"));
  const rolledBack = reconcile(await baseInput(scenarioLogs().filter((log) => log.blockNumber !== BigInt(120)), { previous: first }));
  const found = codes(rolledBack);
  assert.ok(found.includes("classification-regressed"));
  assert.ok(found.includes("account-regressed"));
  assert.ok(found.includes("withdrawal-exceeds-credit"));
  assert.equal(rolledBack.level, "critical");
  await assert.rejects(async () => reconcile(await baseInput(scenarioLogs(), { previous: { ...first, wallet: `0x${"34".repeat(20)}` } })), /autre registre/);
});

test("règlement v7 sans opération runner, retenue au-dessus du plafond et retrait sans crédit sont critiques", async () => {
  const orphan = `0x${"aa".repeat(32)}`;
  const logs = [
    lock(orphan, BigInt(100), hash(20), BigInt(1)), ...release(orphan, BigInt(110), hash(21), `0x${"c1".repeat(20)}`),
    lock(FIXTURE_LOANS.failure, BigInt(101), hash(11), BigInt(2)), ...fail(FIXTURE_LOANS.failure, BigInt(130), TX.failure, BigInt(2) * CAP),
    withdraw(`0x${"d1".repeat(20)}`, BigInt(1), BigInt(150), hash(22)),
  ];
  const report = reconcile(await baseInput(logs));
  const found = codes(report);
  for (const expected of ["on-chain-without-runner-operation", "retained-fee-above-cap", "withdrawal-exceeds-credit"]) assert.ok(found.includes(expected), expected);
  assert.equal(report.level, "critical");
  // Le reçu d'échec du registre annonce 250000 mais la chaîne a enregistré 2×CAP : contradiction, pas une simple attente.
  assert.ok(found.includes("failure-claim-mismatch"));
});

test("factures et reçus deviennent des charges engagées ; les estimations restent des provisions", async () => {
  const invoices = [
    { id: "phala-2026-09", supplier: "phala", periodStart: "2026-09-01", periodEnd: "2026-09-30", amountUsdMicros: "2000000", status: "paid", reference: "INV-1" },
    { id: "vercel-2026-09", supplier: "vercel", periodStart: "2026-09-01", periodEnd: "2026-09-30", amountUsdMicros: "1000000", status: "due" },
    { id: "neon-2026-10", supplier: "neon", periodStart: "2026-10-01", periodEnd: "2026-10-31", amountUsdMicros: "500000", status: "estimated" },
  ];
  const receipts = [{ transactionHash: TX.release, status: "success", gasUsed: "21000", effectiveGasPriceWei: "1000000000" }];
  const report = reconcile(await baseInput(scenarioLogs(), { invoices, receipts, ethUsdMicrosUpperBound: "5000000000" }));
  assert.equal(report.charges.invoicesEngagedUsdMicros, "3000000");
  assert.equal(report.provisions.invoicesEstimatedUsdMicros, "500000");
  assert.deepEqual(report.charges.bySupplier.phala, { engagedUsdMicros: "2000000", estimatedUsdMicros: "0" });
  assert.equal(report.charges.gasEngagedWei, "21000000000000");
  assert.equal(report.charges.gasEngagedUsdMicrosUpperBound, "105000");
  assert.equal(report.charges.engagedUsdMicrosUpperBound, "3105000");
  assert.equal(report.indicative.acquiredMinusEngagedUsdMicros, "3825000");
  assert.equal(report.gaps.filter((gap: Gap) => gap.code === "gas-receipt-missing").length, 1);
  assert.ok(codes(report).includes("invoice-estimated"));
  await assert.rejects(async () => reconcile(await baseInput(scenarioLogs(), { invoices: [invoices[0], invoices[0]] })), /double/);
  await assert.rejects(async () => reconcile(await baseInput(scenarioLogs(), { receipts: [{ ...receipts[0], gasUsed: "1.5" }] })), /Reçu invalide/);
});

test("autre réseau, décimales absentes ou comptes Sirius absents : refus sans rapport partiel", async () => {
  const input = await baseInput();
  await assert.rejects(async () => reconcile({ ...input, events: { ...input.events, chainId: 1 } }), /autre réseau/);
  await assert.rejects(async () => reconcile({ ...input, usdcDecimals: 0 }), /Décimales/);
  await assert.rejects(async () => reconcile({ ...input, siriusAccounts: [] }), /Comptes Sirius/);
});
