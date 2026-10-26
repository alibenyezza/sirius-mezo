// Kit de test : encode de vrais événements avec les ABI générées des escrows et produit un relevé
// via le vrai collecteur (A2.2) sur un lecteur simulé. Aucun réseau. Réservé aux tests.
import { encodeAbiParameters, encodeEventTopics, type Abi, type AbiEvent, type Hex } from "viem";
import { siriusescrowAbi } from "../../src/lib/evm/abi/siriusescrow";
import { siriusescrowv7Abi } from "../../src/lib/evm/abi/siriusescrowv7";
import { collectEscrowEvents, type ChainReader, type EscrowSource, type EscrowVersion, type RawLog } from "./escrow-events";

const ABIS: Record<EscrowVersion, Abi> = { v5: siriusescrowAbi as Abi, v6: siriusescrowAbi as Abi, v7: siriusescrowv7Abi as Abi };
export const blockHashOf = (block: bigint) => `0x${block.toString(16).padStart(64, "0")}` as Hex;

export function encodeEscrowEvent(version: EscrowVersion, eventName: string, args: Record<string, unknown>) {
  const abi = ABIS[version];
  const event = abi.find((item) => item.type === "event" && item.name === eventName) as AbiEvent | undefined;
  if (!event) throw new Error(`Événement inconnu : ${eventName}`);
  const indexed = Object.fromEntries(event.inputs.filter((input) => input.indexed).map((input) => [input.name, args[input.name!]]));
  const plain = event.inputs.filter((input) => !input.indexed);
  return {
    topics: encodeEventTopics({ abi, eventName, args: indexed } as never) as Hex[],
    data: encodeAbiParameters(plain, plain.map((input) => args[input.name!])),
  };
}

export function rawLog(version: EscrowVersion, address: string, block: bigint, logIndex: number, transactionHash: Hex,
  eventName: string, args: Record<string, unknown>): RawLog {
  return { address, blockNumber: block, blockHash: blockHashOf(block), transactionHash, logIndex, ...encodeEscrowEvent(version, eventName, args) };
}

/** Relevé produit par le vrai collecteur sur un lecteur simulé cohérent. */
export function eventsDocument(logs: RawLog[], escrows: EscrowSource[], stableBlock: bigint, chainId = 31611) {
  const reader: ChainReader = {
    getChainId: async () => chainId,
    getLogs: async ({ address, fromBlock, toBlock }) =>
      logs.filter((log) => log.address.toLowerCase() === address.toLowerCase() && log.blockNumber! >= fromBlock && log.blockNumber! <= toBlock),
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: blockHashOf(blockNumber) }),
  };
  return collectEscrowEvents({ reader, chainId, escrows, stableBlock: { number: stableBlock, hash: blockHashOf(stableBlock) }, now: 1 });
}
