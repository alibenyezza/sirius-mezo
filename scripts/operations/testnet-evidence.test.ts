import assert from "node:assert/strict";
import { test } from "node:test";
import type { Hex } from "viem";
import { collectEvidence, diffEvidence, parseAccount, parseEscrow, parseLoan, type EvidenceReader } from "./testnet-evidence";

const V7 = `0x${"a7".repeat(20)}`;
const V6 = `0x${"a6".repeat(20)}`;
const USDC = `0x${"1d".repeat(20)}`;
const PROVIDER = `0x${"c0".repeat(20)}`;
const BORROWER = `0x${"b0".repeat(20)}`;
const RECIPIENT = `0x${"d0".repeat(20)}`;
const LOAN = `0x${"11".repeat(32)}`;
const E18 = BigInt(10) ** BigInt(18);
const blockHash = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const txHash = (n: number) => `0x${(n + 500).toString(16).padStart(64, "0")}` as Hex;

/** État simulé de la chaîne, modifiable entre deux relevés. */
function chain(state: { usdc: Record<string, bigint>; eth: Record<string, bigint>; credits: Record<string, Record<string, bigint>>;
  accounting: Record<string, bigint[]>; loanStatus: number; consumed: bigint; receipts: Record<string, { block: bigint; status: "success" | "reverted"; hash?: Hex }> }) {
  const calls: string[] = [];
  const reader: EvidenceReader = {
    getChainId: async () => 31611,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: blockHash(blockNumber), timestamp: BigInt(1_790_000_000) + blockNumber }),
    getBalance: async ({ address }) => state.eth[address] ?? BigInt(0),
    readContract: async ({ address, functionName, args, blockNumber }) => {
      calls.push(`${functionName}@${blockNumber}`);
      if (functionName === "balanceOf") return state.usdc[String(args?.[0])] ?? BigInt(0);
      if (functionName === "creditOf") return state.credits[address]?.[String(args?.[0])] ?? BigInt(0);
      if (functionName === "VERSION") return address === V7 ? "sirius-escrow-usdc-v7" : "sirius-escrow-usdc-v6";
      if (functionName === "accounting") return state.accounting[address];
      if (functionName === "isRefundable") return state.loanStatus === 1;
      if (functionName === "isReleasable") return state.loanStatus === 1;
      if (functionName === "getLoan") return { provider: PROVIDER, borrower: BORROWER, datasetAmount: BigInt(5) * E18, computeAmount: BigInt(7) * E18,
        maxFailureFee: BigInt(10) ** BigInt(15), consumedCompute: state.consumed, deadline: BigInt(1_900_000_000), status: state.loanStatus };
      throw new Error(`lecture inattendue ${functionName}`);
    },
    getTransactionReceipt: async ({ hash }) => {
      const receipt = state.receipts[hash];
      if (!receipt) throw new Error("reçu absent");
      return { transactionHash: hash, status: receipt.status, blockNumber: receipt.block, blockHash: receipt.hash ?? blockHash(receipt.block),
        gasUsed: BigInt(21000), effectiveGasPrice: BigInt(1_000_000_000), from: BORROWER as Hex, to: V7 as Hex };
    },
  };
  return { reader, calls };
}

const base = () => ({
  usdc: { [BORROWER]: BigInt(100) * E18, [PROVIDER]: BigInt(0), [RECIPIENT]: BigInt(0) }, eth: { [BORROWER]: E18 },
  credits: { [V7]: {}, [V6]: { [PROVIDER]: BigInt(10) * E18 } } as Record<string, Record<string, bigint>>,
  accounting: { [V7]: [BigInt(0), BigInt(0), BigInt(0), BigInt(0)], [V6]: [BigInt(10) * E18, BigInt(20) * E18, BigInt(30) * E18, BigInt(5)] },
  loanStatus: 1, consumed: BigInt(0),
  receipts: { [txHash(1)]: { block: BigInt(150), status: "success" as const, hash: undefined as Hex | undefined } } as Record<string, { block: bigint; status: "success" | "reverted"; hash?: Hex }>,
});
const input = (reader: EvidenceReader, extra: Record<string, unknown> = {}) => ({
  reader, chainId: 31611, stableBlock: { number: BigInt(200), hash: blockHash(BigInt(200)) }, usdc: { address: USDC, decimals: 18 },
  accounts: [{ label: "borrower", address: BORROWER }, { label: "provider", address: PROVIDER }, { label: "recipient", address: RECIPIENT }],
  escrows: [{ address: V7, version: "v7" as const }, { address: V6, version: "v6" as const }], loans: [{ escrow: V7, loanKey: LOAN }],
  transactions: [txHash(1)], now: 1, ...extra,
});

test("le relevé lit tout au bloc stable : soldes, crédits, comptabilité des escrows, prêt et reçu canonique", async () => {
  const { reader, calls } = chain(base());
  const evidence = await collectEvidence(input(reader));
  assert.ok(calls.every((call) => call.endsWith("@200")), "toutes les lectures sont épinglées au bloc stable");
  assert.equal(evidence.stableBlock.number, "200");
  const borrower = evidence.accounts.find((a) => a.label === "borrower")!;
  assert.deepEqual([borrower.usdcAtomic, borrower.ethWei], [String(BigInt(100) * E18), String(E18)]);
  assert.equal(evidence.accounts.find((a) => a.label === "provider")!.credits[V6], String(BigInt(10) * E18));
  assert.deepEqual(evidence.escrows.map((e) => [e.version, e.lockedAtomic, e.owedAtomic, e.seq]), [["v7", "0", "0", "0"], ["v6", String(BigInt(10) * E18), String(BigInt(20) * E18), "5"]]);
  assert.deepEqual([evidence.loans[0].status, evidence.loans[0].computeAmountAtomic, evidence.loans[0].refundable], ["locked", String(BigInt(7) * E18), true]);
  assert.deepEqual(evidence.transactions[0].confirmations, "51");
  assert.deepEqual(evidence.receiptsForReconcile, [{ transactionHash: txHash(1), status: "success", gasUsed: "21000", effectiveGasPriceWei: "1000000000" }]);
});

test("un reçu au-delà du bloc stable, non canonique ou absent, ou une version d'escrow inattendue, refusent le relevé", async () => {
  const late = base(); late.receipts[txHash(1)].block = BigInt(201);
  await assert.rejects(collectEvidence(input(chain(late).reader)), /au-delà du bloc stable/);
  const reorg = base(); reorg.receipts[txHash(1)].hash = blockHash(BigInt(7));
  await assert.rejects(collectEvidence(input(chain(reorg).reader)), /non canonique/);
  await assert.rejects(collectEvidence(input(chain(base()).reader, { transactions: [txHash(2)] })), /reçu absent/);
  await assert.rejects(collectEvidence(input(chain(base()).reader, { escrows: [{ address: V7, version: "v6" }] })), /Version d'escrow/);
  await assert.rejects(collectEvidence(input(chain(base()).reader, { chainId: 1 })), /autre réseau/);
  await assert.rejects(collectEvidence(input(chain(base()).reader, { accounts: [{ label: "a", address: BORROWER }, { label: "a", address: PROVIDER }] })), /double/);
});

test("le diff d'une étape donne les mouvements USDC, les crédits, l'état du prêt et le gas des nouvelles transactions", async () => {
  const before = await collectEvidence(input(chain(base()).reader));
  // Après un échec mesuré : le borrower a payé 12 USDC au lock, il est recrédité de 11,975 et Sirius de 0,025.
  const after = base();
  after.usdc[BORROWER] = BigInt(88) * E18;
  after.credits[V7] = { [BORROWER]: BigInt(11975) * E18 / BigInt(1000), [RECIPIENT]: BigInt(25) * E18 / BigInt(1000) };
  after.accounting[V7] = [BigInt(0), BigInt(12) * E18, BigInt(12) * E18, BigInt(4)];
  after.loanStatus = 4; after.consumed = BigInt(25) * E18 / BigInt(1000);
  after.receipts[txHash(2)] = { block: BigInt(230), status: "success" };
  const evidence = await collectEvidence(input(chain(after).reader, { stableBlock: { number: BigInt(250), hash: blockHash(BigInt(250)) }, transactions: [txHash(1), txHash(2)], now: 2 }));
  const diff = diffEvidence(before, evidence);
  const borrower = diff.accounts.find((a) => a.label === "borrower")!;
  assert.equal(borrower.usdcAtomicDelta, String(-BigInt(12) * E18));
  assert.equal(borrower.creditsDelta?.[V7], String(BigInt(11975) * E18 / BigInt(1000)));
  const recipient = diff.accounts.find((a) => a.label === "recipient")!;
  assert.equal(recipient.creditsDelta?.[V7], String(BigInt(25) * E18 / BigInt(1000)));
  assert.deepEqual(diff.loans[0], { escrow: V7, loanKey: LOAN, statusBefore: "locked", statusAfter: "failed", consumedComputeDelta: String(BigInt(25) * E18 / BigInt(1000)) });
  assert.equal(diff.escrows[0].eventsSinceBefore, "4");
  assert.deepEqual(diff.newTransactions.map((tx) => tx.transactionHash), [txHash(2)]);
  assert.equal(diff.gasSpentWei, String(BigInt(21000) * BigInt(1_000_000_000)));
  assert.equal(diff.usdcMovedBetweenTrackedAccountsAtomic, String(-BigInt(12) * E18), "les 12 USDC sont partis vers l'escrow, compte non suivi");
  assert.throws(() => diffEvidence(evidence, before), /précède/);
});

test("les arguments de ligne de commande sont stricts", () => {
  assert.deepEqual(parseAccount(`provider:${PROVIDER.toUpperCase().replace("0X", "0x")}`), { label: "provider", address: PROVIDER });
  assert.deepEqual(parseEscrow(`v7:${V7}`), { version: "v7", address: V7 });
  assert.deepEqual(parseLoan(`${V7}:${LOAN}`), { escrow: V7, loanKey: LOAN });
  for (const bad of ["Provider:0x1", `v8:${V7}`, `${V7}:${LOAN.slice(0, 10)}`]) assert.throws(() => { parseAccount(bad); parseEscrow(bad); parseLoan(bad); });
});
