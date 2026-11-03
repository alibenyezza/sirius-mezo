import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "../src/lib/evm/networks";
import { siriusescrowAbi } from "../src/lib/evm/abi/siriusescrow";
import { siriusfeerouterAbi } from "../src/lib/evm/abi/siriusfeerouter";

/**
 * Distribue les frais de plateforme de Sirius sur Mezo testnet.
 *
 * `SiriusFeeRouter.distribute(escrow)` est sans permission : n'importe quel compte qui a du
 * BTC pour le gas peut l'appeler, rien ne peut être détourné (la trésorerie et le bribe
 * sont figés dans le routeur). Le script lit le manifeste, n'envoie rien quand il n'y a ni
 * crédit à tirer ni incitation prête, simule avant d'envoyer, et imprime le hash.
 *
 *   node --import tsx scripts/mezo-distribute-fees.ts            # simulation seule
 *   node --import tsx scripts/mezo-distribute-fees.ts --send     # envoie la transaction
 *
 * Clé : SIRIUS_SETTLEMENT_KEY sinon MEZO_DEPLOYER_KEY, lues dans .env.local.
 */

const ROOT = resolve(__dirname, "..");
const DEFERRALS = ["prête", "rien en attente", "gauge mort", "aucun vote sur le gauge", "bord d'époque"];

function loadEnv() {
  try {
    for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
    }
  } catch {
    // .env.local absent : les variables d'environnement suffisent.
  }
}

async function main() {
  loadEnv();
  const send = process.argv.includes("--send");
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "deployments", "mezo-testnet.json"), "utf8")) as {
    contracts: { escrow: Hex; feeRouter?: Hex };
  };
  const router = manifest.contracts.feeRouter;
  if (!router) throw new Error("Aucun routeur de frais dans deployments/mezo-testnet.json : redéploie avec SIRIUS_FEE_BPS");
  const escrow = manifest.contracts.escrow;

  const chain = mezoTestnet;
  const transport = http(process.env.EVM_RPC_URL || chain.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain, transport });

  const [credit, pending, deferral, totalIncentivized] = await Promise.all([
    publicClient.readContract({ address: escrow, abi: siriusescrowAbi, functionName: "creditOf", args: [router] }),
    publicClient.readContract({ address: router, abi: siriusfeerouterAbi, functionName: "pendingIncentive" }),
    publicClient.readContract({ address: router, abi: siriusfeerouterAbi, functionName: "incentiveDeferral" }),
    publicClient.readContract({ address: router, abi: siriusfeerouterAbi, functionName: "totalIncentivized" }),
  ]);
  console.log(`routeur              : ${router}`);
  console.log(`frais dans l'escrow  : ${formatEther(credit)} MUSD`);
  console.log(`incitation en attente: ${formatEther(pending)} MUSD (${DEFERRALS[deferral] ?? deferral})`);
  console.log(`incitations versées  : ${formatEther(totalIncentivized)} MUSD au total`);

  if (credit === BigInt(0) && deferral !== 0) {
    console.log("\nRien à faire : aucun frais à tirer et aucune incitation prête.");
    return;
  }

  const key = (process.env.SIRIUS_SETTLEMENT_KEY?.trim() || process.env.MEZO_DEPLOYER_KEY?.trim()) as Hex | undefined;
  if (!key) throw new Error("SIRIUS_SETTLEMENT_KEY ou MEZO_DEPLOYER_KEY manquante");
  const account = privateKeyToAccount(key);
  const { request } = await publicClient.simulateContract({
    account, address: router, abi: siriusfeerouterAbi, functionName: "distribute", args: [escrow],
  });
  if (!send) {
    console.log("\nSimulation réussie. Relance avec --send pour envoyer la transaction.");
    return;
  }
  const walletClient = createWalletClient({ account, chain, transport });
  const hash = await walletClient.writeContract({ ...request, gas: BigInt(600_000) });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, retryCount: 20, retryDelay: 1_500, timeout: 120_000 });
  console.log(`\ndistribute : ${receipt.status} — ${chain.blockExplorers?.default.url}/tx/${hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
