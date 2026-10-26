// Usage (lecture seule, aucun compte de signature) :
//   EVM_NETWORK=testnet EVM_RPC_URL=… NODE_OPTIONS=--conditions=react-server \
//     node --import tsx scripts/operations/escrow-events-cli.ts v7:0xESCROW:BLOC_DE_DEPLOIEMENT [v6:0x…:BLOC …] [--chunk=5000]
// Le bloc stable suit la politique de finalité de l'application (SIRIUS_EVM_FINALITY / SIRIUS_EVM_CONFIRMATIONS).
// Sortie : un document JSON sur la sortie standard. Aucun fichier n'est écrit, aucun .env n'est chargé.
import type { Hex } from "viem";
import { getPublicClient } from "../../src/lib/evm/client";
import { confirmedBlock } from "../../src/lib/evm/finality";
import { resolveServerNetwork } from "../../src/lib/evm/networks";
import { collectEscrowEvents, parseEscrowArgument, type ChainReader } from "./escrow-events";

async function main() {
  const args = process.argv.slice(2);
  const chunkArg = args.find((arg) => arg.startsWith("--chunk="));
  const escrows = args.filter((arg) => arg !== chunkArg).map(parseEscrowArgument);
  if (!escrows.length || !process.env.EVM_NETWORK?.trim() || !process.env.EVM_RPC_URL?.trim()) throw new Error();
  const chunkSize = chunkArg ? BigInt(/^--chunk=([1-9][0-9]{0,5})$/.exec(chunkArg)?.[1] ?? "x") : undefined;
  const { chain } = resolveServerNetwork();
  const client = getPublicClient();
  const stable = await confirmedBlock(client);
  if (stable.number === null || !stable.hash) throw new Error();
  const reader: ChainReader = {
    getChainId: () => client.getChainId(),
    getLogs: ({ address, fromBlock, toBlock }) => client.getLogs({ address, fromBlock, toBlock }),
    getBlock: ({ blockNumber }) => client.getBlock({ blockNumber }),
  };
  const document = await collectEscrowEvents({ reader, chainId: chain.id, escrows,
    stableBlock: { number: stable.number, hash: stable.hash as Hex }, chunkSize });
  console.log(JSON.stringify(document, null, 2));
}

void main().catch(() => {
  console.error("Relevé des escrows refusé : vérifier réseau, RPC, adresses, blocs de départ et finalité. Aucune transaction envoyée, aucun relevé partiel produit.");
  process.exitCode = 1;
});
