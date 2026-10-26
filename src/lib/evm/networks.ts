import { defineChain, type Chain } from "viem";

/**
 * Réseaux EVM cibles de Sirius : Mezo, la chaîne Bitcoin EVM-compatible de Thesis.
 *
 * Valeurs vérifiées en direct le 26/10/2026 par sondes RPC :
 *   testnet 31611 (0x7b7b) · mainnet 31612 (0x7b7c)
 *   gas payé en BTC natif (18 décimales) · Multicall3 déployé à l'adresse canonique.
 *
 * Le jeton de règlement est MUSD, le stablecoin de Mezo adossé à 100 % à du Bitcoin.
 * Les deux environnements partagent les mêmes conventions de résolution réseau.
 */

export type EvmNetwork = "mainnet" | "testnet";

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const mezoMainnet: Chain = defineChain({
  id: 31612,
  name: "Mezo",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://mainnet.mezo.public.validationcloud.io"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.mezo.org" },
  },
  contracts: {
    multicall3: { address: MULTICALL3 },
  },
});

export const mezoTestnet: Chain = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.test.mezo.org"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.test.mezo.org" },
  },
  contracts: {
    multicall3: { address: MULTICALL3 },
  },
  testnet: true,
});

export const EVM_CHAINS: Record<EvmNetwork, Chain> = {
  mainnet: mezoMainnet,
  testnet: mezoTestnet,
};

export const EVM_CHAIN_IDS: Record<EvmNetwork, number> = {
  mainnet: mezoMainnet.id,
  testnet: mezoTestnet.id,
};

/**
 * Précision du jeton de règlement de chaque réseau (nom historique du code : « USDC »).
 *
 * MUSD expose 18 décimales sur le testnet comme sur le mainnet Mezo (lu on-chain
 * le 26 octobre 2026). Une valeur fausse ici ne lève aucune erreur — elle décale
 * silencieusement tous les montants d'un facteur de puissance de dix.
 *
 * `contracts/scripts/deploy.ts` lit `decimals()` on-chain et refuse de déployer
 * si la valeur ne correspond pas à celle déclarée ici ; ce contrôle fait autorité.
 */
export const USDC_DECIMALS_BY_NETWORK: Record<EvmNetwork, number> = {
  mainnet: 18,
  testnet: 18,
};

function parseNetwork(raw: string, variable: string): EvmNetwork {
  if (raw !== "mainnet" && raw !== "testnet") {
    throw new Error(`${variable} invalide: "${raw}" (attendu: mainnet, testnet)`);
  }
  return raw;
}

/** Réseau + RPC côté serveur (API routes et runner), pilotés par l'environnement. */
export function resolveServerNetwork(): { network: EvmNetwork; chain: Chain; rpcUrl: string } {
  const network = parseNetwork(process.env.EVM_NETWORK || "testnet", "EVM_NETWORK");
  const chain = EVM_CHAINS[network];
  const rpcUrl = process.env.EVM_RPC_URL || chain.rpcUrls.default.http[0];
  return { network, chain, rpcUrl };
}

/** Réseau attendu côté navigateur. Doit correspondre au serveur, sinon les signatures sont rejetées. */
export function resolveClientNetwork(): EvmNetwork {
  return parseNetwork(process.env.NEXT_PUBLIC_EVM_NETWORK || "testnet", "NEXT_PUBLIC_EVM_NETWORK");
}

export function chainForNetwork(network: EvmNetwork): Chain {
  return EVM_CHAINS[network];
}

/**
 * Précision du jeton de règlement, résolue dans les deux contextes d'exécution.
 *
 * `usdc.ts` est importé aussi bien par les écrans que par le runner : il ne peut
 * donc dépendre d'aucun des deux résolveurs ci-dessus. `EVM_NETWORK` n'est pas
 * inlinée dans le bundle navigateur, où la valeur publique prend le relais ;
 * côté serveur la variable privée l'emporte, pour qu'une valeur publique oubliée
 * ne puisse pas contredire la configuration serveur.
 */
export function resolveUsdcDecimals(): number {
  const server = process.env.EVM_NETWORK?.trim();
  const client = process.env.NEXT_PUBLIC_EVM_NETWORK?.trim();
  const network = server
    ? parseNetwork(server, "EVM_NETWORK")
    : client
      ? parseNetwork(client, "NEXT_PUBLIC_EVM_NETWORK")
      : "testnet";
  return USDC_DECIMALS_BY_NETWORK[network];
}
