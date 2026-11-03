/**
 * Mise en service complète sur Mezo testnet, en une commande :
 *
 *   node --import tsx scripts/mezo-testnet.ts            # déploie, publie un dataset, joue un prêt MUSD
 *   node --import tsx scripts/mezo-testnet.ts --smoke    # rejoue seulement le prêt sur les contrats déjà déployés
 *
 * Lit `.env.local` (MEZO_DEPLOYER_KEY, jamais affichée). Après déploiement, les adresses
 * sont ajoutées à `.env.local` et écrites dans `deployments/mezo-testnet.json`.
 *
 * Redéploiement (nouvel escrow, ex. ajout de `lockWithSignature`) : le registre KYB ouvert
 * déjà en place est réutilisé par défaut (`contracts.kyb` du manifeste, ou
 * `SIRIUS_REUSE_KYB_ADDRESS` ; `SIRIUS_FRESH_KYB=true` pour en déployer un neuf). Le
 * registre de datasets est toujours redéployé, `bindEscrow` n'acceptant qu'une liaison :
 * le titre de démonstration est republié, les autres titres doivent l'être par leurs
 * fournisseurs. Le trio remplacé passe dans `previous` (tableau, le plus récent en premier)
 * et son escrow rejoint `SIRIUS_LEGACY_ESCROW_ADDRESSES` pour que les crédits qui y
 * restent soient encore retirables. Le bloc `verification` disparaît (nouvelles adresses
 * non vérifiées, voir docs/MEZO-TESTNET.md), `evidence` est conservé. Règles pures dans
 * `scripts/mezo-manifest.ts`.
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
import { SIRIUS_FEE_DEFAULTS } from "../src/lib/mezo/governance";
import {
  DEFAULT_ESCROW_VERSION,
  escrowFeatures,
  legacyEscrowAddresses,
  nextManifest,
  reuseKybAddress,
  type DeploymentManifestFile,
} from "./mezo-manifest";

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

/** Valeur facultative imprimée par le déploiement (adresse ou entier), `null` si absente. */
function optionalEnvValue(output: string, name: string): string | null {
  const match = output.match(new RegExp(`${name}="([0-9a-zA-Z]+)"`));
  return match ? match[1] : null;
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

  const saved: DeploymentManifestFile | null = existsSync(DEPLOYMENT_FILE)
    ? (JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8")) as DeploymentManifestFile)
    : null;

  let addresses: { escrow: Hex; kyb: Hex; datasets: Hex };
  if (smokeOnly) {
    if (!saved) throw new Error("deployments/mezo-testnet.json absent : déploie d'abord (sans --smoke)");
    addresses = { escrow: saved.contracts.escrow as Hex, kyb: saved.contracts.kyb as Hex, datasets: saved.contracts.datasets as Hex };
  } else {
    const reusedKyb = reuseKybAddress(process.env, saved);
    console.log(`\n── Déploiement des contrats${reusedKyb ? ` (registre KYB réutilisé : ${reusedKyb})` : ""} ──`);
    const output = run("contracts/scripts/deploy.ts", {
      SIRIUS_DEPLOY_NETWORK: "testnet",
      SIRIUS_KYB_MODE: "open",
      SIRIUS_ALLOW_SHARED_ROLES: "true",
      SIRIUS_USDC_ADDRESS: musd,
      SIRIUS_USDC_CODE_HASH: musdCodeHash,
      SIRIUS_LOCK_AUTHORIZER: lockAuthorizer,
      // Frais de plateforme : 2 % par défaut, trésorerie = déployeur sauf configuration.
      SIRIUS_FEE_BPS: process.env.SIRIUS_FEE_BPS?.trim() || String(SIRIUS_FEE_DEFAULTS.feeBps),
      SIRIUS_FEE_TREASURY: process.env.SIRIUS_FEE_TREASURY?.trim() || deployer.address,
      ...(reusedKyb ? { SIRIUS_REUSE_KYB_ADDRESS: reusedKyb } : {}),
    });
    const feeRouter = optionalEnvValue(output, "SIRIUS_FEE_ROUTER_ADDRESS");
    const feePolicy = optionalEnvValue(output, "SIRIUS_FEE_POLICY_ADDRESS");
    const feeBps = optionalEnvValue(output, "SIRIUS_FEE_BPS");
    const checkout = optionalEnvValue(output, "SIRIUS_CHECKOUT_ADDRESS");
    const feeContracts = {
      ...(feeRouter && feePolicy && feeBps ? { feeRouter, feePolicy, feeBps: Number(feeBps) } : {}),
      ...(checkout ? { checkout } : {}),
    };
    addresses = {
      escrow: envValue(output, "SIRIUS_ESCROW_ADDRESS"),
      kyb: envValue(output, "SIRIUS_KYB_ADDRESS"),
      datasets: envValue(output, "SIRIUS_DATASET_ADDRESS"),
    };

    // Version et fonctionnalités de l'escrow : la version est lue sur le contrat (constante
    // `VERSION`), les fonctionnalités dans l'ABI compilée qui vient d'être déployée.
    const escrowAbi = artifactAbi("SiriusEscrow");
    const escrowVersion = await publicClient
      .readContract({ address: addresses.escrow, abi: escrowAbi, functionName: "VERSION" })
      .then((value) => (typeof value === "string" && value ? value : DEFAULT_ESCROW_VERSION), () => DEFAULT_ESCROW_VERSION);
    const features = escrowFeatures(escrowAbi);

    // L'escrow remplacé reste autorisé en lecture et en retrait (crédits, remboursements).
    const retiredEscrows = saved && saved.contracts.escrow.toLowerCase() !== addresses.escrow.toLowerCase() ? [saved.contracts.escrow] : [];
    upsertEnv({
      EVM_NETWORK: "testnet", NEXT_PUBLIC_EVM_NETWORK: "testnet", SIRIUS_BILLING_VERSION: "6",
      NEXT_PUBLIC_SIRIUS_ESCROW_ADDRESS: addresses.escrow, NEXT_PUBLIC_SIRIUS_USDC_ADDRESS: musd,
      NEXT_PUBLIC_SIRIUS_KYB_ADDRESS: addresses.kyb, NEXT_PUBLIC_SIRIUS_DATASET_ADDRESS: addresses.datasets,
      SIRIUS_ESCROW_ADDRESS: addresses.escrow, SIRIUS_USDC_ADDRESS: musd, SIRIUS_USDC_CODE_HASH: musdCodeHash,
      SIRIUS_KYB_ADDRESS: addresses.kyb, SIRIUS_DATASET_ADDRESS: addresses.datasets, SIRIUS_LOCK_AUTHORIZER: lockAuthorizer,
      SIRIUS_LEGACY_ESCROW_ADDRESSES: legacyEscrowAddresses(process.env.SIRIUS_LEGACY_ESCROW_ADDRESSES, retiredEscrows, addresses.escrow),
      ...(feeRouter && feePolicy ? { SIRIUS_FEE_ROUTER_ADDRESS: feeRouter, SIRIUS_FEE_POLICY_ADDRESS: feePolicy } : {}),
      ...(checkout ? { SIRIUS_CHECKOUT_ADDRESS: checkout, NEXT_PUBLIC_SIRIUS_CHECKOUT_ADDRESS: checkout } : {}),
    });
    mkdirSync(resolve(ROOT, "deployments"), { recursive: true });
    const manifest = nextManifest(saved, {
      chainId: chain.id, explorer: chain.blockExplorers?.default.url,
      deployedAt: new Date().toISOString(), deployer: deployer.address, lockAuthorizer,
      settlementToken: { symbol: "MUSD", address: musd, decimals: 18, codeHash: musdCodeHash },
      contracts: { ...addresses, kybMode: "open", escrowVersion, ...(features.length ? { escrowFeatures: features } : {}), ...feeContracts },
    });
    writeFileSync(DEPLOYMENT_FILE, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`\nAdresses écrites dans deployments/mezo-testnet.json et .env.local (escrow ${escrowVersion}${features.length ? `, ${features.join(", ")}` : ""})`);
    if (retiredEscrows.length) {
      console.log(`Ancien escrow ${retiredEscrows[0]} ajouté à SIRIUS_LEGACY_ESCROW_ADDRESSES ; les titres de datasets de l'ancien registre doivent être republiés.`);
    }
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
