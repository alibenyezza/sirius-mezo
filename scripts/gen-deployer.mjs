// Génère une clé de déploiement jetable pour Mezo testnet dans .env.local (jamais affichée)
// et n'imprime que l'adresse à alimenter. Refuse d'écraser un .env.local existant.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { writeFileSync } from "node:fs";

const key = generatePrivateKey();
const account = privateKeyToAccount(key);
writeFileSync(".env.local", `MEZO_DEPLOYER_KEY=${key}\n`, { flag: "wx" });
console.log(`Clé écrite dans .env.local (ignoré par git). Adresse du déployeur : ${account.address}`);
