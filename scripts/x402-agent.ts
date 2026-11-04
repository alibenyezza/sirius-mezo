/**
 * Agent de démonstration x402 : paie une prédiction Sirius en MUSD sur le testnet Mezo.
 *
 *   X402_BUYER_KEY=0x… node --import tsx scripts/x402-agent.ts [url] ['{"hour":18,…}']
 *
 * La clé vient de TON environnement et n'est jamais affichée. L'agent lit le prix sur l'API,
 * vérifie son solde MUSD, signe une autorisation Permit2 + EIP-2612 (aucune transaction, aucun
 * gas : le facilitateur Mezo règle et paie le gas en BTC), puis affiche la prédiction et le hash
 * du règlement. Il faut au moins 0,001 MUSD sur le wallet ; aucun BTC n'est nécessaire.
 */
import { createPublicClient, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";
import { EVM_CHAINS } from "../src/lib/evm/networks";

const DEFAULT_URL = "https://sirius-mezo.vercel.app/api/x402/predict";
const DEFAULT_FEATURES = {
  hour: 18, temperature_c: 4.5, humidity_pct: 70, wind_kmh: 12, cloud_cover_pct: 60,
  is_weekend: 0, is_holiday: 0, solar_kw: 0, morning_peak: 0, evening_peak: 1,
};
const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

async function main() {
  const key = process.env.X402_BUYER_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Définis X402_BUYER_KEY (clé de TON wallet de test, 0x + 64 caractères hex).");
  const url = process.argv[2] ?? DEFAULT_URL;
  const features = process.argv[3] ? JSON.parse(process.argv[3]) as Record<string, number> : DEFAULT_FEATURES;

  const chain = EVM_CHAINS.testnet;
  const publicClient = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
  const account = privateKeyToAccount(key as Hex);

  const info = await fetch(url, { headers: { accept: "application/json" } });
  if (!info.ok) throw new Error(`L'API x402 répond ${info.status} : est-elle ouverte (SIRIUS_X402=true) ?`);
  const description = await info.json() as { price: string; payTo: string; asset: { address: Hex }; model: { name: string; target: string } };
  const balance = await publicClient.readContract({ address: description.asset.address, abi: erc20, functionName: "balanceOf", args: [account.address] });
  console.log(`agent     : ${account.address}`);
  console.log(`modèle    : ${description.model.name} → ${description.model.target}`);
  console.log(`prix      : ${description.price} en MUSD, payé à ${description.payTo}`);
  console.log(`solde     : ${formatEther(balance)} MUSD`);

  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account, publicClient)));
  const paidFetch = wrapFetchWithPayment(fetch, client);

  const response = await paidFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ features }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Paiement ou prédiction refusé (${response.status}) : ${body.slice(0, 500)}`);
  console.log(`réponse   : ${body}`);

  const settle = new x402HTTPClient(client).getPaymentSettleResponse((name) => response.headers.get(name));
  console.log(`règlement : ${settle.success ? "réussi" : "échoué"} · tx ${settle.transaction}`);
  if (settle.transaction) console.log(`explorer  : ${chain.blockExplorers?.default.url}/tx/${settle.transaction}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
