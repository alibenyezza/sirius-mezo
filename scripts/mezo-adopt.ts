/**
 * Adopte un trio de contrats déjà déployé sur Mezo testnet (ex. après un reçu RPC expiré) :
 * vérifie les liaisons on-chain, puis écrit deployments/mezo-testnet.json et .env.local.
 *
 *   node --import tsx scripts/mezo-adopt.ts <kyb> <datasets> <escrow>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { createPublicClient, http, keccak256, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "../src/lib/evm/networks";
import { TESTNET_STABLECOIN_ADDRESS } from "../src/lib/evm/stablecoin";

const ROOT = resolve(__dirname, "..");
const ENV_FILE = resolve(ROOT, ".env.local");
loadEnv({ path: ENV_FILE, quiet: true });

function abiOf(name: string): Abi {
  return (JSON.parse(readFileSync(resolve(ROOT, "contracts/artifacts/src", `${name}.sol`, `${name}.json`), "utf8")) as { abi: Abi }).abi;
}

function upsertEnv(entries: Record<string, string>) {
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  for (const [name, value] of Object.entries(entries)) {
    const line = `${name}="${value}"`;
    const re = new RegExp(`^${name}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, "")}\n${line}\n`;
  }
  writeFileSync(ENV_FILE, text);
}

async function main() {
  const [kyb, datasets, escrow] = process.argv.slice(2) as Hex[];
  for (const a of [kyb, datasets, escrow]) if (!/^0x[0-9a-fA-F]{40}$/.test(a ?? "")) throw new Error("Usage : mezo-adopt.ts <kyb> <datasets> <escrow>");
  const musd = TESTNET_STABLECOIN_ADDRESS as Hex;
  const client = createPublicClient({ chain: mezoTestnet, transport: http(process.env.EVM_RPC_URL || mezoTestnet.rpcUrls.default.http[0]) });
  const deployer = privateKeyToAccount(process.env.MEZO_DEPLOYER_KEY as Hex);
  const escrowAbi = abiOf("SiriusEscrow");
  const datasetAbi = abiOf("SiriusDatasetRegistry");
  const [authorizer, escrowUsdc, escrowKyb, escrowDatasets, linkedEscrow, linkedKyb, version] = await Promise.all([
    client.readContract({ address: escrow, abi: escrowAbi, functionName: "lockAuthorizer" }),
    client.readContract({ address: escrow, abi: escrowAbi, functionName: "usdc" }),
    client.readContract({ address: escrow, abi: escrowAbi, functionName: "kyb" }),
    client.readContract({ address: escrow, abi: escrowAbi, functionName: "datasets" }),
    client.readContract({ address: datasets, abi: datasetAbi, functionName: "escrow" }),
    client.readContract({ address: datasets, abi: datasetAbi, functionName: "kyb" }),
    client.readContract({ address: escrow, abi: escrowAbi, functionName: "VERSION" }),
  ]) as [Hex, Hex, Hex, Hex, Hex, Hex, string];
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!same(escrowUsdc, musd)) throw new Error("L'escrow ne règle pas en MUSD");
  if (!same(escrowKyb, kyb) || !same(escrowDatasets, datasets) || !same(linkedEscrow, escrow) || !same(linkedKyb, kyb)) throw new Error("Liaisons escrow / registres incohérentes");
  const code = await client.getBytecode({ address: musd });
  const musdCodeHash = keccak256(code!);
  console.log(`escrow ${version} · signataire de lock ${authorizer}`);
  upsertEnv({
    EVM_NETWORK: "testnet", NEXT_PUBLIC_EVM_NETWORK: "testnet", SIRIUS_BILLING_VERSION: "6",
    NEXT_PUBLIC_SIRIUS_ESCROW_ADDRESS: escrow, NEXT_PUBLIC_SIRIUS_USDC_ADDRESS: musd,
    NEXT_PUBLIC_SIRIUS_KYB_ADDRESS: kyb, NEXT_PUBLIC_SIRIUS_DATASET_ADDRESS: datasets,
    SIRIUS_ESCROW_ADDRESS: escrow, SIRIUS_USDC_ADDRESS: musd, SIRIUS_USDC_CODE_HASH: musdCodeHash,
    SIRIUS_KYB_ADDRESS: kyb, SIRIUS_DATASET_ADDRESS: datasets, SIRIUS_LOCK_AUTHORIZER: authorizer,
  });
  mkdirSync(resolve(ROOT, "deployments"), { recursive: true });
  writeFileSync(resolve(ROOT, "deployments", "mezo-testnet.json"), JSON.stringify({
    network: "mezo-testnet", chainId: mezoTestnet.id, explorer: mezoTestnet.blockExplorers?.default.url,
    deployedAt: new Date().toISOString(), deployer: deployer.address, lockAuthorizer: authorizer,
    settlementToken: { symbol: "MUSD", address: musd, decimals: 18, codeHash: musdCodeHash },
    contracts: { escrow, kyb, datasets, kybMode: "open", escrowVersion: version },
  }, null, 2) + "\n");
  console.log("deployments/mezo-testnet.json et .env.local mis à jour");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
