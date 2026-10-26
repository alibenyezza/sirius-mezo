import type { EvmNetwork } from "./networks";

/**
 * Jeton de règlement de chaque réseau : **MUSD**, le stablecoin de Mezo adossé à
 * 100 % à des réserves Bitcoin et conçu pour tenir 1:1 avec le dollar.
 *
 * Mainnet (31612) : `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186`, `symbol()` = « MUSD »,
 * `decimals()` = 18, vérifié sur le RPC public de Mezo le 26 octobre 2026.
 * Testnet (31611) : `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`, `name()` = « Mezo USD »,
 * `symbol()` = « MUSD », `decimals()` = 18, vérifié le même jour. On l'obtient en
 * empruntant contre du BTC de test sur https://testnet.mezo.org.
 *
 * Les variables d'environnement et les identifiants internes gardent leur nom
 * historique (`SIRIUS_USDC_ADDRESS`, `usdc`, `formatUsdcAtomic`…) : seul le
 * libellé affiché et le jeton imposé changent.
 */

/** Adresse MUSD sur Mezo mainnet, en minuscules pour les comparaisons. */
export const MAINNET_STABLECOIN_ADDRESS = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186";
export const MAINNET_STABLECOIN_SYMBOL = "MUSD";
export const MAINNET_STABLECOIN_NAME = "Mezo USD";
/** Confirmé on-chain : identique à `USDC_DECIMALS_BY_NETWORK.mainnet`, que `deploy.ts` revérifie. */
export const MAINNET_STABLECOIN_DECIMALS = 18;

/** Adresse MUSD sur Mezo testnet, en minuscules pour les comparaisons. */
export const TESTNET_STABLECOIN_ADDRESS = "0x118917a40faf1cd7a13db0ef56c86de7973ac503";
/** Libellé du jeton d'essai affiché à côté des montants sur testnet. */
export const TESTNET_STABLECOIN_LABEL = "test MUSD";

const SYMBOL_BY_NETWORK: Record<EvmNetwork, string> = {
  mainnet: MAINNET_STABLECOIN_SYMBOL,
  testnet: TESTNET_STABLECOIN_LABEL,
};

/** Ticker court pour les libellés techniques (« Lock MUSD », crédits à retirer), jamais traduit. */
export function stablecoinTicker(network: EvmNetwork): "MUSD" {
  void network;
  return "MUSD";
}

/**
 * Libellé du jeton à afficher à côté d'un montant. Un réseau inconnu lève une
 * erreur plutôt que d'afficher un libellé faux à côté d'un solde.
 */
export function stablecoinSymbol(network: EvmNetwork): string {
  const symbol = SYMBOL_BY_NETWORK[network];
  if (!symbol) throw new Error(`Réseau inconnu pour le jeton de règlement : ${String(network)}`);
  return symbol;
}
