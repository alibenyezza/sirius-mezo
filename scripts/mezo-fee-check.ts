import { createPublicClient, http } from "viem";
import { EVM_CHAINS } from "../src/lib/evm/networks";
import { mezoFeeChecks } from "./mezo-fee-checks";

/**
 * Vérifie en lecture seule, sur la chaîne, les contrats Mezo dont dépendent les frais Sirius.
 * Aucune transaction.
 *
 *   node --import tsx scripts/mezo-fee-check.ts [testnet|mainnet]
 */
async function main() {
  const network = process.argv[2] === "mainnet" ? "mainnet" : "testnet";
  const client = createPublicClient({ chain: EVM_CHAINS[network], transport: http() });
  const checks = await mezoFeeChecks(client, network);
  let failed = 0;
  for (const { label, ok, detail } of checks) {
    if (!ok) failed += 1;
    console.log(`${ok ? "ok  " : "ÉCHEC"} ${label.padEnd(32)} ${detail}`);
  }
  if (failed) {
    process.exitCode = 1;
    console.log(`\n${failed} vérification(s) en échec sur ${network}`);
  } else {
    console.log(`\nToutes les dépendances Mezo des frais Sirius répondent sur ${network}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
