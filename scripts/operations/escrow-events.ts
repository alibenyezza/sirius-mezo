// A2.2 — Relevé des événements des escrows Sirius, en lecture seule, jusqu'à un bloc stable.
// Aucune signature, aucune transaction. Le relevé est complet ou refusé : une plage manquante,
// un journal hors plage, un log retiré ou une réorganisation pendant la lecture arrêtent tout,
// pour que la comptabilité ne travaille jamais sur un relevé partiel présenté comme complet.
import { decodeEventLog, type Abi, type Hex } from "viem";
import { siriusescrowAbi } from "../../src/lib/evm/abi/siriusescrow";
import { siriusescrowv7Abi } from "../../src/lib/evm/abi/siriusescrowv7";

export type EscrowVersion = "v5" | "v6" | "v7";
export interface EscrowSource { address: string; version: EscrowVersion; fromBlock: bigint }

/** Sous-ensemble du client viem utilisé : facile à simuler, impossible d'y signer. */
export interface ChainReader {
  getChainId(): Promise<number>;
  getLogs(args: { address: Hex; fromBlock: bigint; toBlock: bigint }): Promise<RawLog[]>;
  getBlock(args: { blockNumber: bigint }): Promise<{ number: bigint | null; hash: Hex | null }>;
}

export interface RawLog {
  address: string;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: bigint | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  logIndex: number | null;
  removed?: boolean;
}

export interface EscrowEvent {
  escrow: string;
  version: EscrowVersion;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  /** Nom de l'événement, ou null si la signature n'appartient pas à l'ABI de cette version. */
  name: string | null;
  /** Arguments décodés ; entiers en chaînes, adresses et octets en hexadécimal minuscule. */
  args: Record<string, string | boolean> | null;
  /** Journal brut conservé uniquement quand il n'a pas pu être décodé. */
  raw: { topics: string[]; data: string } | null;
}

export interface EscrowEventsDocument {
  version: 1;
  kind: "sirius-escrow-events";
  chainId: number;
  observedAtMs: number;
  stableBlock: { number: string; hash: string };
  escrows: Array<{ address: string; version: EscrowVersion; fromBlock: string; toBlock: string; events: number }>;
  undecoded: number;
  events: EscrowEvent[];
}

const ABIS: Record<EscrowVersion, Abi> = {
  // v5 et v6 partagent la source SiriusEscrow ; un événement propre à v5 reste conservé brut.
  v5: siriusescrowAbi as Abi,
  v6: siriusescrowAbi as Abi,
  v7: siriusescrowv7Abi as Abi,
};

const MAX_CHUNK = BigInt(100_000);
const hex = (value: string) => value.toLowerCase();
const isAddress = (value: string) => /^0x[0-9a-f]{40}$/i.test(value);
const isHash = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);

function serialize(value: unknown): string | boolean {
  if (typeof value === "bigint" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.startsWith("0x") ? hex(value) : value;
  throw new Error("Argument d'événement non sérialisable");
}

function decode(log: RawLog, version: EscrowVersion): Pick<EscrowEvent, "name" | "args" | "raw"> {
  try {
    const decoded = decodeEventLog({ abi: ABIS[version], topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
    const args = Object.fromEntries(Object.entries((decoded.args ?? {}) as Record<string, unknown>)
      .map(([key, value]) => [key, serialize(value)]));
    return { name: decoded.eventName ?? null, args, raw: null };
  } catch {
    return { name: null, args: null, raw: { topics: log.topics.map(hex), data: hex(log.data) } };
  }
}

export async function collectEscrowEvents(options: {
  reader: ChainReader;
  chainId: number;
  escrows: EscrowSource[];
  stableBlock: { number: bigint; hash: Hex };
  chunkSize?: bigint;
  now?: number;
}): Promise<EscrowEventsDocument> {
  const { reader, chainId, escrows, stableBlock } = options;
  const chunk = options.chunkSize ?? BigInt(5_000);
  if (chunk < BigInt(1) || chunk > MAX_CHUNK) throw new Error("Taille de plage invalide");
  if (!Number.isSafeInteger(chainId) || chainId < 1 || !isHash(stableBlock.hash) || stableBlock.number < BigInt(0)) {
    throw new Error("Bloc stable invalide");
  }
  if (!escrows.length) throw new Error("Aucun escrow à relever");
  const seen = new Set<string>();
  for (const escrow of escrows) {
    if (!isAddress(escrow.address) || !(escrow.version in ABIS) || escrow.fromBlock < BigInt(0) || escrow.fromBlock > stableBlock.number) {
      throw new Error("Escrow à relever invalide");
    }
    if (seen.has(hex(escrow.address))) throw new Error("Escrow en double");
    seen.add(hex(escrow.address));
  }
  if (await reader.getChainId() !== chainId) throw new Error("RPC sur un autre réseau");

  const events: EscrowEvent[] = [];
  const summary: EscrowEventsDocument["escrows"] = [];
  const blocksWithLogs = new Map<bigint, string>();
  for (const escrow of escrows) {
    const address = hex(escrow.address) as Hex;
    let count = 0;
    for (let from = escrow.fromBlock; from <= stableBlock.number; from += chunk) {
      const to = from + chunk - BigInt(1) < stableBlock.number ? from + chunk - BigInt(1) : stableBlock.number;
      const logs = await reader.getLogs({ address, fromBlock: from, toBlock: to });
      for (const log of logs) {
        if (log.removed || hex(log.address) !== address || log.blockNumber === null || log.blockNumber < from
          || log.blockNumber > to || !isHash(log.blockHash) || !isHash(log.transactionHash)
          || !Number.isSafeInteger(log.logIndex) || (log.logIndex as number) < 0 || !log.topics.length) {
          throw new Error("Journal RPC hors plage, retiré ou incomplet");
        }
        const known = blocksWithLogs.get(log.blockNumber);
        if (known !== undefined && known !== hex(log.blockHash)) throw new Error("Deux hashes pour le même bloc : lecture incohérente");
        blocksWithLogs.set(log.blockNumber, hex(log.blockHash));
        events.push({ escrow: address, version: escrow.version, blockNumber: String(log.blockNumber), blockHash: hex(log.blockHash),
          transactionHash: hex(log.transactionHash), logIndex: log.logIndex as number, ...decode(log, escrow.version) });
        count++;
      }
    }
    summary.push({ address, version: escrow.version, fromBlock: String(escrow.fromBlock), toBlock: String(stableBlock.number), events: count });
  }

  // Chaque bloc porteur d'événements et le bloc stable doivent toujours être canoniques à la fin.
  for (const [number, expected] of [...blocksWithLogs, [stableBlock.number, hex(stableBlock.hash)] as const]) {
    const block = await reader.getBlock({ blockNumber: number });
    if (block.number !== number || !block.hash || hex(block.hash) !== expected) {
      throw new Error("Réorganisation ou vue RPC incohérente pendant le relevé");
    }
  }

  events.sort((a, b) => {
    const block = BigInt(a.blockNumber) - BigInt(b.blockNumber);
    return block !== BigInt(0) ? (block < BigInt(0) ? -1 : 1) : a.logIndex - b.logIndex;
  });
  const keys = new Set(events.map((event) => `${event.blockHash}:${event.logIndex}`));
  if (keys.size !== events.length) throw new Error("Journal RPC en double");
  return {
    version: 1, kind: "sirius-escrow-events", chainId, observedAtMs: options.now ?? Date.now(),
    stableBlock: { number: String(stableBlock.number), hash: hex(stableBlock.hash) },
    escrows: summary, undecoded: events.filter((event) => event.name === null).length, events,
  };
}

/** `v7:0xADRESSE:BLOC` → source d'escrow. */
export function parseEscrowArgument(value: string): EscrowSource {
  const match = /^(v5|v6|v7):(0x[0-9a-fA-F]{40}):([0-9]{1,12})$/.exec(value);
  if (!match) throw new Error("Escrow attendu sous la forme version:adresse:bloc");
  return { version: match[1] as EscrowVersion, address: match[2].toLowerCase(), fromBlock: BigInt(match[3]) };
}
