/**
 * Prépare les secrets applicatifs d'une instance de démonstration (testnet) dans `.env.local` :
 * SIRIUS_MASTER_KEY, SIRIUS_SESSION_SECRET et RUNNER_TRANSPORT_SECRET, générés s'ils manquent,
 * jamais affichés. Imprime seulement l'adresse du compte de règlement dérivé de la master key :
 * c'est elle qu'il faut donner comme SIRIUS_LOCK_AUTHORIZER au déploiement de l'escrow.
 *
 *   NODE_OPTIONS=--conditions=react-server node --import tsx scripts/mezo-app-secrets.ts
 */
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const ENV_FILE = resolve(__dirname, "..", ".env.local");
loadEnv({ path: ENV_FILE, quiet: true });

const generated: string[] = [];
for (const name of ["SIRIUS_MASTER_KEY", "SIRIUS_SESSION_SECRET", "RUNNER_TRANSPORT_SECRET"]) {
  if (process.env[name]?.trim()) continue;
  const value = randomBytes(32).toString("base64");
  process.env[name] = value;
  generated.push(`${name}=${value}`);
}
// Comptes de démonstration (clés hex) : faucet et vérificateur KYB, exigés par le mode démo.
for (const name of ["SIRIUS_FAUCET_KEY", "SIRIUS_KYB_VERIFIER_KEY"]) {
  if (process.env[name]?.trim()) continue;
  const value = `0x${randomBytes(32).toString("hex")}`;
  process.env[name] = value;
  generated.push(`${name}=${value}`);
}
if (generated.length) appendFileSync(ENV_FILE, `\n# Secrets applicatifs de démonstration (générés par scripts/mezo-app-secrets.ts)\n${generated.join("\n")}\n`);

async function main() {
  const { settlementAccount } = await import("../src/lib/evm/runner-account");
  const { deriveKey, getMasterKey } = await import("../src/lib/crypto/encryption");
  const { privateKeyToAccount } = await import("viem/accounts");
  // Clé du compte de règlement, exportée pour le smoke test de l'escrow (testnet uniquement).
  if (!process.env.SIRIUS_SETTLEMENT_KEY?.trim()) {
    appendFileSync(ENV_FILE, `SIRIUS_SETTLEMENT_KEY=0x${deriveKey(getMasterKey(), "settlement:evm:v1").toString("hex")}\n`);
  }
  const settlement = settlementAccount().address;
  if (!process.env.SIRIUS_LOCK_AUTHORIZER?.trim()) appendFileSync(ENV_FILE, `SIRIUS_LOCK_AUTHORIZER="${settlement}"\n`);
  console.log(`secrets générés : ${generated.length} (les autres existaient déjà)`);
  console.log(`compte de règlement de l'application (SIRIUS_LOCK_AUTHORIZER) : ${settlement}`);
  console.log(`faucet de démonstration : ${privateKeyToAccount(process.env.SIRIUS_FAUCET_KEY as `0x${string}`).address}`);
  console.log(`vérificateur KYB de démonstration : ${privateKeyToAccount(process.env.SIRIUS_KYB_VERIFIER_KEY as `0x${string}`).address}`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
