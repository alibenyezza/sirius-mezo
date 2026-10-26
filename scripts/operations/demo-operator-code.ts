import { randomBytes } from "node:crypto";
import { hashOperatorCode } from "../../src/lib/phala-demo/operator-code";

// Sans entrée redirigée, le code est tiré au hasard ; un code choisi arrive par l'entrée
// standard pour ne jamais apparaître dans l'historique du shell.
async function main() {
  let input = "";
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) input += chunk;
  const code = input.trim() || randomBytes(18).toString("base64url");
  const hash = hashOperatorCode(code);
  if (!input.trim()) console.log(`Code à transmettre aux opérateurs : ${code}`);
  console.log(`SIRIUS_DEMO_OPERATOR_CODE_HASH=${hash}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
