/**
 * Envoie du BTC natif de test depuis le déployeur jetable vers une adresse (testnet uniquement).
 *
 *   node --import tsx scripts/mezo-send-btc.ts 0xDestinataire 0.02
 */
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "../src/lib/evm/networks";

loadEnv({ path: resolve(__dirname, "..", ".env.local"), quiet: true });

async function main() {
  const [to, amount] = process.argv.slice(2);
  if (!/^0x[0-9a-fA-F]{40}$/.test(to ?? "") || !amount) throw new Error("Usage : mezo-send-btc.ts <adresse> <montant BTC>");
  const key = process.env.MEZO_DEPLOYER_KEY?.trim();
  if (!key) throw new Error("MEZO_DEPLOYER_KEY manquante dans .env.local");
  const account = privateKeyToAccount(key as Hex);
  const transport = http(process.env.EVM_RPC_URL || mezoTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: mezoTestnet, transport });
  if (await publicClient.getChainId() !== mezoTestnet.id) throw new Error("RPC sur une autre chaîne");
  const wallet = createWalletClient({ account, chain: mezoTestnet, transport });
  const hash = await wallet.sendTransaction({ to: to as Hex, value: parseEther(amount) });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, retryCount: 20, retryDelay: 1_500 });
  if (receipt.status !== "success") throw new Error(`Transfert rejeté (${hash})`);
  console.log(`✓ ${amount} BTC envoyés à ${to} · tx ${hash}`);
  console.log(`solde restant du déployeur : ${formatEther(await publicClient.getBalance({ address: account.address }))} BTC`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
