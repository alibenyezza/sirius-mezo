import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, type Abi, type AbiEvent, type Hex } from "viem";
import { siriusescrowAbi } from "../../src/lib/evm/abi/siriusescrow";
import { siriusescrowv7Abi } from "../../src/lib/evm/abi/siriusescrowv7";
import { collectEscrowEvents, parseEscrowArgument, type ChainReader, type RawLog } from "./escrow-events";

const V7 = `0x${"a7".repeat(20)}`;
const V6 = `0x${"a6".repeat(20)}`;
const BORROWER = `0x${"b0".repeat(20)}`;
const PROVIDER = `0x${"c0".repeat(20)}`;
const RECIPIENT = `0x${"d0".repeat(20)}`;
const LOAN = `0x${"11".repeat(32)}` as Hex;
const blockHash = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const txHash = (n: number) => `0x${(n + 1000).toString(16).padStart(64, "0")}` as Hex;

function encode(abi: Abi, eventName: string, args: Record<string, unknown>) {
  const event = abi.find((item) => item.type === "event" && item.name === eventName) as AbiEvent;
  const indexed = Object.fromEntries(event.inputs.filter((input) => input.indexed).map((input) => [input.name, args[input.name!]]));
  const plain = event.inputs.filter((input) => !input.indexed);
  return {
    topics: encodeEventTopics({ abi, eventName, args: indexed } as never) as Hex[],
    data: encodeAbiParameters(plain, plain.map((input) => args[input.name!])),
  };
}

function log(address: string, block: bigint, index: number, encoded: { topics: Hex[]; data: Hex }): RawLog {
  return { address, blockNumber: block, blockHash: blockHash(block), transactionHash: txHash(index), logIndex: index, ...encoded };
}

const v7Logs = [
  log(V7, BigInt(120), 0, encode(siriusescrowv7Abi as Abi, "LoanLocked", { loanKey: LOAN, borrower: BORROWER, provider: PROVIDER,
    computeRecipient: RECIPIENT, datasetAmount: BigInt(5_000_000), computeAmount: BigInt(7_000_000), maxFailureFee: BigInt(1_000_000),
    deadline: 1_900_000_000, termsHash: `0x${"22".repeat(32)}`, seq: BigInt(1) })),
  log(V7, BigInt(180), 3, encode(siriusescrowv7Abi as Abi, "LoanFailed", { loanKey: LOAN, borrower: BORROWER,
    refundAmount: BigInt(11_750_000), retainedFee: BigInt(250_000), seq: BigInt(2) })),
  log(V7, BigInt(180), 4, encode(siriusescrowv7Abi as Abi, "CreditAccrued", { account: RECIPIENT, loanKey: LOAN,
    amount: BigInt(250_000), balance: BigInt(250_000) })),
];
const v6Logs = [
  log(V6, BigInt(30), 1, encode(siriusescrowAbi as Abi, "LoanRefunded", { loanKey: LOAN, borrower: BORROWER, amount: BigInt(20_000_000), seq: BigInt(9) })),
];

function reader(logs: RawLog[], overrides: Partial<ChainReader> = {}) {
  const calls: Array<{ address: string; fromBlock: bigint; toBlock: bigint }> = [];
  const value: ChainReader = {
    getChainId: async () => 31611,
    getLogs: async (args) => {
      calls.push(args);
      return logs.filter((item) => item.address === args.address && item.blockNumber! >= args.fromBlock && item.blockNumber! <= args.toBlock);
    },
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: blockHash(blockNumber) }),
    ...overrides,
  };
  return { value, calls };
}
const stableBlock = { number: BigInt(200), hash: blockHash(BigInt(200)) };
const sources = [{ address: V7, version: "v7" as const, fromBlock: BigInt(100) }, { address: V6, version: "v6" as const, fromBlock: BigInt(0) }];

test("le relevé décode les événements v7 et v6 avec montants exacts en chaînes et ordre canonique", async () => {
  const { value } = reader([...v7Logs, ...v6Logs]);
  const doc = await collectEscrowEvents({ reader: value, chainId: 31611, escrows: sources, stableBlock, chunkSize: BigInt(50), now: 1 });
  assert.deepEqual(doc.events.map((e) => e.name), ["LoanRefunded", "LoanLocked", "LoanFailed", "CreditAccrued"]);
  const failed = doc.events.find((e) => e.name === "LoanFailed")!;
  assert.deepEqual(failed.args, { loanKey: LOAN, borrower: BORROWER, refundAmount: "11750000", retainedFee: "250000", seq: "2" });
  assert.equal(doc.events.find((e) => e.name === "LoanLocked")!.args!.computeAmount, "7000000");
  assert.equal(doc.undecoded, 0);
  assert.deepEqual(doc.escrows.map((e) => [e.version, e.events, e.toBlock]), [["v7", 3, "200"], ["v6", 1, "200"]]);
});

test("les plages couvrent exactement du bloc de départ au bloc stable, sans trou ni recouvrement", async () => {
  const { value, calls } = reader([]);
  await collectEscrowEvents({ reader: value, chainId: 31611, escrows: [sources[0]], stableBlock, chunkSize: BigInt(30) });
  assert.deepEqual(calls.map((c) => [c.fromBlock, c.toBlock].map(Number)), [[100, 129], [130, 159], [160, 189], [190, 200]]);
});

test("un journal inconnu de l'ABI est conservé brut et compté, jamais ignoré", async () => {
  const foreign = { ...v7Logs[0], logIndex: 9, topics: [`0x${"ee".repeat(32)}`] as Hex[], data: "0x" as Hex };
  const { value } = reader([foreign]);
  const doc = await collectEscrowEvents({ reader: value, chainId: 31611, escrows: [sources[0]], stableBlock });
  assert.equal(doc.undecoded, 1);
  assert.equal(doc.events[0].name, null);
  assert.deepEqual(doc.events[0].raw, { topics: [`0x${"ee".repeat(32)}`], data: "0x" });
});

test("réseau différent, réorganisation, log retiré, hors plage ou d'un autre contrat : aucun relevé produit", async () => {
  const cases: Array<[ChainReader, RegExp]> = [
    [reader(v7Logs, { getChainId: async () => 1 }).value, /autre réseau/],
    [reader(v7Logs, { getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: blockHash(blockNumber + BigInt(1)) }) }).value, /Réorganisation/],
    [reader([{ ...v7Logs[0], removed: true }]).value, /hors plage, retiré/],
    [reader([], { getLogs: async () => [{ ...v7Logs[0], blockNumber: BigInt(999) }] }).value, /hors plage/],
    [reader([], { getLogs: async () => [{ ...v7Logs[0], address: V6 }] }).value, /hors plage/],
    [reader([], { getLogs: async () => { throw new Error("RPC indisponible"); } }).value, /RPC indisponible/],
  ];
  for (const [value, expected] of cases) {
    await assert.rejects(collectEscrowEvents({ reader: value, chainId: 31611, escrows: [sources[0]], stableBlock }), expected);
  }
});

test("deux hashes pour un même bloc ou un journal en double arrêtent le relevé", async () => {
  const conflicting = { ...v7Logs[1], blockHash: blockHash(BigInt(7)) };
  await assert.rejects(collectEscrowEvents({ reader: reader([v7Logs[2], conflicting]).value, chainId: 31611,
    escrows: [sources[0]], stableBlock }), /Deux hashes|Réorganisation/);
  const duplicate = reader([], { getLogs: async (args) => args.fromBlock === BigInt(100) ? [v7Logs[0], v7Logs[0]] : [] }).value;
  await assert.rejects(collectEscrowEvents({ reader: duplicate, chainId: 31611, escrows: [sources[0]], stableBlock }), /double/);
});

test("les arguments de ligne de commande sont stricts et les sources incohérentes refusées", async () => {
  assert.deepEqual(parseEscrowArgument(`v7:${V7.toUpperCase().replace("0X", "0x")}:123`), { version: "v7", address: V7, fromBlock: BigInt(123) });
  for (const bad of ["v8:0x" + "a".repeat(40) + ":1", "v7:0x123:1", `v7:${V7}`, `v7:${V7}:-1`]) assert.throws(() => parseEscrowArgument(bad));
  const { value } = reader([]);
  await assert.rejects(collectEscrowEvents({ reader: value, chainId: 31611, escrows: [sources[0], sources[0]], stableBlock }), /double/);
  await assert.rejects(collectEscrowEvents({ reader: value, chainId: 31611, escrows: [{ ...sources[0], fromBlock: BigInt(201) }], stableBlock }), /invalide/);
  await assert.rejects(collectEscrowEvents({ reader: value, chainId: 31611, escrows: [], stableBlock }), /Aucun escrow/);
});
