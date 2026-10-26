// Usage (lecture seule, aucun compte de signature, aucun .env chargé) :
//   EVM_NETWORK=testnet EVM_RPC_URL=… NODE_OPTIONS=--conditions=react-server node --import tsx scripts/operations/testnet-evidence-cli.ts \
//     snapshot --accounts=provider:0x…,borrower:0x…,recipient:0x… --escrows=v7:0x…,v6:0x… [--loans=0xESCROW:0xKEY,…] [--tx=0x…,…]
//   node --import tsx scripts/operations/testnet-evidence-cli.ts diff avant.json apres.json
// Le bloc stable suit la politique de finalité de l'application ; le token USDC et ses décimales sont lus sur le premier escrow.
import { readFileSync } from "node:fs";
import type { Abi, Hex } from "viem";
import { erc20Abi } from "../../src/lib/evm/abi/erc20";
import { siriusescrowAbi } from "../../src/lib/evm/abi/siriusescrow";
import { getPublicClient } from "../../src/lib/evm/client";
import { confirmedBlock } from "../../src/lib/evm/finality";
import { resolveServerNetwork } from "../../src/lib/evm/networks";
import { collectEvidence, diffEvidence, parseAccount, parseEscrow, parseLoan, type EvidenceReader } from "./testnet-evidence";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const list = (name: string) => (option(name) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const files = args.filter((arg) => !arg.startsWith("--"));
  if (command === "diff" && files.length === 2) {
    console.log(JSON.stringify(diffEvidence(JSON.parse(readFileSync(files[0], "utf8")), JSON.parse(readFileSync(files[1], "utf8"))), null, 2));
    return;
  }
  if (command !== "snapshot" || files.length || !process.env.EVM_NETWORK?.trim() || !process.env.EVM_RPC_URL?.trim()) throw new Error();
  const accounts = list("accounts").map(parseAccount);
  const escrows = list("escrows").map(parseEscrow);
  const loans = list("loans").map(parseLoan);
  const transactions = list("tx");
  const { chain } = resolveServerNetwork();
  const client = getPublicClient();
  const stable = await confirmedBlock(client);
  if (stable.number === null || !stable.hash) throw new Error();
  const first = escrows[0].address as Hex;
  const usdc = await client.readContract({ address: first, abi: siriusescrowAbi, functionName: "usdc", blockNumber: stable.number }) as Hex;
  const decimals = await client.readContract({ address: usdc, abi: erc20Abi as Abi, functionName: "decimals", blockNumber: stable.number }) as number;
  const reader: EvidenceReader = {
    getChainId: () => client.getChainId(),
    getBlock: ({ blockNumber }) => client.getBlock({ blockNumber }),
    getBalance: ({ address, blockNumber }) => client.getBalance({ address, blockNumber }),
    readContract: ({ address, abi, functionName, args, blockNumber }) => client.readContract({ address, abi, functionName, args, blockNumber } as never),
    getTransactionReceipt: ({ hash }) => client.getTransactionReceipt({ hash }),
  };
  const evidence = await collectEvidence({ reader, chainId: chain.id, stableBlock: { number: stable.number, hash: stable.hash as Hex },
    usdc: { address: usdc, decimals: Number(decimals) }, accounts, escrows, loans, transactions });
  console.log(JSON.stringify(evidence, null, 2));
}

void main().catch(() => {
  console.error("Relevé de preuve refusé : vérifier la commande, le réseau, le RPC, les comptes, escrows, prêts et hashes. Aucune transaction envoyée, aucun relevé partiel.");
  process.exitCode = 1;
});
