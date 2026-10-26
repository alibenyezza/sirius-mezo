/**
 * Alimente une adresse en BTC natif et/ou en MUSD depuis le déployeur jetable (testnet uniquement).
 *
 *   node --import tsx scripts/mezo-fund.ts 0xDestinataire <BTC> <MUSD>
 *   node --import tsx scripts/mezo-fund.ts 0xDestinataire 0.005 20
 */
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { createPublicClient, createWalletClient, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "../src/lib/evm/networks";
import { TESTNET_STABLECOIN_ADDRESS } from "../src/lib/evm/stablecoin";

loadEnv({ path: resolve(__dirname, "..", ".env.local"), quiet: true });

const ERC20 = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

async function main() {
  const [to, btc = "0", musd = "0"] = process.argv.slice(2);
  if (!/^0x[0-9a-fA-F]{40}$/.test(to ?? "")) throw new Error("Usage : mezo-fund.ts <adresse> <BTC> <MUSD>");
  const key = process.env.MEZO_DEPLOYER_KEY?.trim();
  if (!key) throw new Error("MEZO_DEPLOYER_KEY manquante dans .env.local");
  const account = privateKeyToAccount(key as Hex);
  const transport = http(process.env.EVM_RPC_URL || mezoTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: mezoTestnet, transport });
  if (await publicClient.getChainId() !== mezoTestnet.id) throw new Error("RPC sur une autre chaîne");
  const wallet = createWalletClient({ account, chain: mezoTestnet, transport });
  const wait = async (label: string, hash: Hex) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, retryCount: 30, retryDelay: 2_000 });
    if (receipt.status !== "success") throw new Error(`${label} rejeté (${hash})`);
    console.log(`✓ ${label} → ${to} · tx ${hash}`);
  };
  if (Number(btc) > 0) await wait(`${btc} BTC`, await wallet.sendTransaction({ to: to as Hex, value: parseEther(btc) }));
  if (Number(musd) > 0) {
    await wait(`${musd} MUSD`, await wallet.writeContract({
      address: TESTNET_STABLECOIN_ADDRESS as Hex, abi: ERC20, functionName: "transfer", args: [to as Hex, parseEther(musd)], gas: BigInt(120_000),
    }));
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
