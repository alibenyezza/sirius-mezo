import type { EvmNetwork } from "@/lib/evm/networks";

/**
 * Parcours d'ajout de fonds selon le réseau (docs/passage-mainnet/05-wallet.md).
 *
 * - testnet : le parcours actuel, le faucet de démonstration (`/api/faucet`).
 * - mainnet : carte (MoonPay, si clés live) et réception par transfert ; le pont a été retiré
 *   de la fenêtre le 4 octobre. Avant : le pont existant (`/api/onramp`, kind « bridge »), et la réception
 *   de MUSD par simple transfert vers l'adresse du compte (adresse + QR code). Le faucet
 *   n'existe pas sur mainnet : le serveur le refuse hors instance de démonstration.
 *
 * Le bouton historique de la page Wallet appelle `addFunds()` dans les deux cas ; ce choix
 * ne décide que de ce qui est affiché autour.
 */
export interface AddFundsOptions {
  /** Distribution de fonds de test : testnet uniquement. */
  faucet: boolean;
  /** Pont vers Mezo : seul chemin existant sur mainnet. */
  bridge: boolean;
  /** Réception par transfert : adresse et QR code. Mainnet uniquement. */
  transfer: boolean;
}

export function addFundsOptions(network: EvmNetwork): AddFundsOptions {
  return network === "mainnet"
    ? { faucet: false, bridge: false, transfer: true }
    : { faucet: true, bridge: false, transfer: false };
}

/** Ce que le faucet a versé : `null` quand le compte en avait déjà assez. */
export interface FaucetReceipt {
  /** MUSD envoyés (nom historique du champ). */
  usdc: string | null;
  /** BTC natif envoyé pour le gas (nom historique du champ). */
  eth: string | null;
}

type Translate = (key: string, variables?: Record<string, string | number>) => string;

/**
 * Confirmation affichée après un appel au faucet. Le distributeur ne ressert pas un compte
 * déjà pourvu ; le message doit le dire plutôt que d'annoncer un versement qui n'a pas eu
 * lieu, sinon l'utilisateur cherche des fonds qui ne viendront pas.
 */
export function faucetReceiptMessage(received: FaucetReceipt, token: string, t: Translate): string {
  const { usdc, eth } = received;
  if (usdc && eth) return t("{usdc} {token} et {eth} BTC envoyés.", { usdc, token, eth });
  if (usdc) return t("{usdc} {token} envoyés.", { usdc, token });
  if (eth) return t("{eth} BTC pour le gas envoyés ; ton solde {token} suffisait déjà.", { eth, token });
  return t("Compte déjà pourvu : rien à envoyer.");
}
