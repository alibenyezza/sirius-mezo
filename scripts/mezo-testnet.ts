/**
 * Mise en service complète sur Mezo testnet, en une commande :
 *
 *   node --import tsx scripts/mezo-testnet.ts            # déploie, publie un dataset, joue un prêt MUSD
 *   node --import tsx scripts/mezo-testnet.ts --smoke    # rejoue seulement le prêt sur les contrats déjà déployés
 *
 * Lit `.env.local` (MEZO_DEPLOYER_KEY, jamais affichée). Après déploiement, les adresses
 * sont ajoutées à `.env.local` et écrites dans `deployments/mezo-testnet.json`.
 *
 * Le prêt de démonstration fait intervenir deux comptes : le déployeur joue l'acheteur
 * (il verrouille le MUSD) et un second compte jetable joue le fournisseur (il publie le
 * titre du dataset et reçoit le MUSD). L'escrow refuse qu'une adresse se paie elle-même.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { createPublicClient, createWalletClient, formatEther, http, keccak256, parseEther, type Abi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "../src/lib/evm/networks";
import { TESTNET_STABLECOIN_ADDRESS } from "../src/lib/evm/stablecoin";
import { cidHash, datasetIdHash } from "../src/lib/evm/dataset-key";
import { DEFAULT_MODEL_SELECTION, trainingProfileHash } from "../src/lib/models/registry";

const ROOT = resolve(__dirname, "..");
const ENV_FILE = resolve(ROOT, ".env.local");
const DEPLOYMENT_FILE = resolve(ROOT, "deployments", "mezo-testnet.json");
const DATASET_ID = "mezo-demo-energy-consumption";

loadEnv({ path: ENV_FILE, quiet: true });

const chain = mezoTestnet;
const transport = http(process.env.EVM_RPC_URL || chain.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain, transport });

function requireKey(name: string): Hex {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} manquante dans .env.local (lance d'abord : node scripts/gen-deployer.mjs)`);
  return value as Hex;
}

function artifactAbi(name: string): Abi {
  const path = resolve(ROOT, "contracts", "artifacts", "src", `${name}.sol`, `${name}.json`);
  return (JSON.parse(readFileSync(path, "utf8")) as { abi: Abi }).abi;
}

function run(script: string, env: Record<string, string>) {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  process.stdout.write(result.stdout);
  if (result.status !== 0) throw new Error(`${script} a échoué`);
  return result.stdout;
}

/** Écrit ou remplace des variables dans .env.local : un second déploiement remplace les adresses. */
function upsertEnv(entries: Record<string, string>) {
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  for (const [name, value] of Object.entries(entries)) {
    const line = `${name}="${value}"`;
    const re = new RegExp(`^${name}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, "")}\n${line}\n`;
    process.env[name] = value;
  }
  writeFileSync(ENV_FILE, text);
}

function envValue(output: string, name: string): Hex {
  const match = output.match(new RegExp(`${name}="(0x[0-9a-fA-F]{40})"`));
  if (!match) throw new Error(`${name} introuvable dans la sortie du déploiement`);
  return match[1] as Hex;
}

async function waitReceipt(label: string, hash: Hex) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, retryCount: 20, retryDelay: 1_500, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${label} rejeté (${hash})`);
  console.log(`✓ ${label} · tx ${hash}`);
  return receipt;
}

async function main() {
  const smokeOnly = process.argv.includes("--smoke");
  const deployer = privateKeyToAccount(requireKey("MEZO_DEPLOYER_KEY"));
  const musd = TESTNET_STABLECOIN_ADDRESS as Hex;

  const chainId = await publicClient.getChainId();
  if (chainId !== chain.id) throw new Error(`RPC sur la chaîne ${chainId}, attendu ${chain.id}`);
  const balance = await publicClient.getBalance({ address: deployer.address });
  console.log(`réseau     : ${chain.name} (${chain.id})`);
  console.log(`déployeur  : ${deployer.address}`);
  console.log(`solde BTC  : ${formatEther(balance)}`);
  if (balance === BigInt(0)) throw new Error(`Solde nul : envoie du BTC testnet à ${deployer.address} via https://faucet.test.mezo.org`);

  const musdCode = await publicClient.getBytecode({ address: musd });
  if (!musdCode || musdCode === "0x") throw new Error("MUSD introuvable à l'adresse configurée");
  const musdCodeHash = keccak256(musdCode);

  // Signataire des autorisations de lock : le compte de règlement de l'application (dérivé de
  // SIRIUS_MASTER_KEY par scripts/mezo-app-secrets.ts) si SIRIUS_LOCK_AUTHORIZER est défini, sinon le déployeur.
  const lockAuthorizer = (process.env.SIRIUS_LOCK_AUTHORIZER?.trim() || deployer.address) as Hex;
  const settlementKey = process.env.SIRIUS_SETTLEMENT_KEY?.trim();
  const smokeSignerKey = (settlementKey && lockAuthorizer.toLowerCase() !== deployer.address.toLowerCase() ? settlementKey : null) as Hex | null;
  console.log(`signataire : ${lockAuthorizer}${smokeSignerKey ? " (compte de règlement de l'application)" : " (déployeur)"}`);

  let addresses: { escrow: Hex; kyb: Hex; datasets: Hex };
  if (smokeOnly) {
    const saved = JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8")) as { contracts: { escrow: Hex; kyb: Hex; datasets: Hex } };
    addresses = saved.contracts;
  } else {
    console.log("\n── Déploiement des contrats ──");
    const output = run("contracts/scripts/deploy.ts", {
      SIRIUS_DEPLOY_NETWORK: "testnet",
      SIRIUS_KYB_MODE: "open",
      SIRIUS_ALLOW_SHARED_ROLES: "true",
      SIRIUS_USDC_ADDRESS: musd,
      SIRIUS_USDC_CODE_HASH: musdCodeHash,
      SIRIUS_LOCK_AUTHORIZER: lockAuthorizer,
    });
    addresses = {
      escrow: envValue(output, "SIRIUS_ESCROW_ADDRESS"),
      kyb: envValue(output, "SIRIUS_KYB_ADDRESS"),
      datasets: envValue(output, "SIRIUS_DATASET_ADDRESS"),
    };
    upsertEnv({
      EVM_NETWORK: "testnet", NEXT_PUBLIC_EVM_NETWORK: "testnet", SIRIUS_BILLING_VERSION: "6",
      NEXT_PUBLIC_SIRIUS_ESCROW_ADDRESS: addresses.escrow, NEXT_PUBLIC_SIRIUS_USDC_ADDRESS: musd,
      NEXT_PUBLIC_SIRIUS_KYB_ADDRESS: addresses.kyb, NEXT_PUBLIC_SIRIUS_DATASET_ADDRESS: addresses.datasets,
      SIRIUS_ESCROW_ADDRESS: addresses.escrow, SIRIUS_USDC_ADDRESS: musd, SIRIUS_USDC_CODE_HASH: musdCodeHash,
      SIRIUS_KYB_ADDRESS: addresses.kyb, SIRIUS_DATASET_ADDRESS: addresses.datasets, SIRIUS_LOCK_AUTHORIZER: lockAuthorizer,
    });
    mkdirSync(resolve(ROOT, "deployments"), { recursive: true });
    writeFileSync(DEPLOYMENT_FILE, JSON.stringify({
      network: "mezo-testnet", chainId: chain.id, explorer: chain.blockExplorers?.default.url,
      deployedAt: new Date().toISOString(), deployer: deployer.address, lockAuthorizer,
      settlementToken: { symbol: "MUSD", address: musd, decimals: 18, codeHash: musdCodeHash },
      contracts: { ...addresses, kybMode: "open", escrowVersion: "sirius-escrow-usdc-v6" },
    }, null, 2) + "\n");
    console.log(`\nAdresses écrites dans deployments/mezo-testnet.json et .env.local`);
  }

  // Fournisseur de démonstration : second compte jetable, financé en BTC par le déployeur.
  let providerKey = process.env.SIRIUS_DEMO_PROVIDER_KEY?.trim() as Hex | undefined;
  if (!providerKey) {
    providerKey = generatePrivateKey();
    appendFileSync(ENV_FILE, `\n# Fournisseur de démonstration (compte jetable, testnet)\nSIRIUS_DEMO_PROVIDER_KEY=${providerKey}\n`);
  }
  const provider = privateKeyToAccount(providerKey);
  const deployerWallet = createWalletClient({ account: deployer, chain, transport });
  const providerWallet = createWalletClient({ account: provider, chain, transport });
  console.log(`\nfournisseur: ${provider.address}`);
  const providerBalance = await publicClient.getBalance({ address: provider.address });
  if (providerBalance < parseEther("0.0002")) {
    await waitReceipt("Financement du fournisseur en BTC", await deployerWallet.sendTransaction({ to: provider.address, value: parseEther("0.0005") }));
  }

  // Titre du dataset, publié par le fournisseur s'il n'existe pas encore.
  const datasetAbi = artifactAbi("SiriusDatasetRegistry");
  const trainingProfile = trainingProfileHash(DEFAULT_MODEL_SELECTION);
  const id = (await publicClient.readContract({ address: addresses.datasets, abi: datasetAbi, functionName: "datasetIdOf", args: [provider.address, datasetIdHash(DATASET_ID)] })) as Hex;
  const existing = (await publicClient.readContract({ address: addresses.datasets, abi: datasetAbi, functionName: "getDataset", args: [id] })) as { provider: Hex };
  if (existing.provider.toLowerCase() !== provider.address.toLowerCase()) {
    await waitReceipt("Publication du titre de dataset", await providerWallet.writeContract({
      address: addresses.datasets, abi: datasetAbi, functionName: "mint",
      args: [datasetIdHash(DATASET_ID), cidHash("bafybeigdyrztvdemo" + randomBytes(8).toString("hex")), `0x${randomBytes(32).toString("hex")}`, BigInt(48_213), trainingProfile],
      // Gas explicite : juste après un financement, l'estimation du RPC Mezo peut passer sous le plancher EIP-7623.
      gas: BigInt(300_000),
    }));
  } else {
    console.log("titre de dataset déjà publié");
  }

  // L'emprunteur du prêt de démonstration est le signataire : le smoke exige que le même
  // compte signe l'autorisation, paie le gas et verrouille le MUSD.
  const borrower = smokeSignerKey ? privateKeyToAccount(smokeSignerKey) : deployer;
  const musdBalance = (await publicClient.readContract({
    address: musd, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const,
    functionName: "balanceOf", args: [borrower.address],
  })) as bigint;
  console.log(`emprunteur : ${borrower.address} · solde MUSD ${formatEther(musdBalance)} (le prêt de démonstration verrouille 2 MUSD)`);
  if (musdBalance < parseEther("2")) throw new Error(`Envoie au moins 2 MUSD de test à ${borrower.address} (node --import tsx scripts/mezo-fund.ts ${borrower.address} 0.005 20)`);

  console.log("\n── Prêt de démonstration : lock MUSD → release → retrait fournisseur ──");
  run("contracts/scripts/smoke.ts", {
    NEXT_PUBLIC_SIRIUS_ESCROW_ADDRESS: addresses.escrow,
    NEXT_PUBLIC_SIRIUS_DATASET_ADDRESS: addresses.datasets,
    NEXT_PUBLIC_SIRIUS_USDC_ADDRESS: musd,
    NEXT_PUBLIC_SIRIUS_KYB_ADDRESS: addresses.kyb,
    SIRIUS_SMOKE_PROVIDER_ADDRESS: provider.address,
    SIRIUS_SMOKE_DATASET_ID: DATASET_ID,
    ...(smokeSignerKey ? { MEZO_DEPLOYER_KEY: smokeSignerKey } : {}),
  });
  console.log(`\nExplorateur : ${chain.blockExplorers?.default.url}/address/${addresses.escrow}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
