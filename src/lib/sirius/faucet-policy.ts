import { formatEther, formatUnits, parseEther, parseUnits } from "viem";

/**
 * Règles du distributeur de fonds de test, sans réseau : montants, seuils, et la décision
 * « que verser, à qui, et quand refuser ». `faucet.ts` lit les soldes on-chain, passe le
 * tout ici, puis exécute. Rien d'autre ne décide, ce qui rend ces règles testables sans RPC.
 *
 * Deux réserves, un seul compte : le distributeur détient du MUSD, qu'il transfère, et du
 * BTC natif, qu'il verse pour le gas et qu'il dépense lui-même à chaque écriture. Les deux
 * s'épuisent, les deux se rechargent à la main.
 */

/** MUSD versés par demande : les datasets de la démonstration valent quelques MUSD. */
export const MONTANT_MUSD = "10";
/** BTC natif versé pour le gas, quand le destinataire en manque. */
export const MONTANT_BTC = "0.0002";
/** En dessous de ce solde, le visiteur ne peut plus payer ses transactions. */
export const SEUIL_BTC = parseEther("0.00005");
/** Au-delà de ce solde, le visiteur est déjà pourvu : lui verser encore viderait la réserve pour rien. */
export const PLAFOND_MUSD_DESTINATAIRE = "50";
/** Réserve BTC en dessous de laquelle on refuse plutôt que d'échouer à mi-course. */
export const RESERVE_BTC_MINIMALE = parseEther("0.0005");
/** En dessous, on prévient avant de refuser : le temps de recharger, pas de constater. */
export const RESERVE_BTC_ALERTE = parseEther("0.004");
/** Nombre de demandes encore servables en dessous duquel on prévient. */
export const RESERVE_MUSD_ALERTE_DEMANDES = 5;

export type EtatReserve = "ok" | "basse" | "epuisee";

export interface SoldesDistribution {
  /** MUSD détenus par le distributeur, en unités atomiques. */
  reserveMusd: bigint;
  /** BTC natif du distributeur, en wei. */
  reserveBtc: bigint;
  /** MUSD du destinataire, en unités atomiques. */
  soldeMusd: bigint;
  /** BTC natif du destinataire, en wei. */
  soldeBtc: bigint;
}

export interface DecisionDistribution {
  envoyerMusd: boolean;
  envoyerBtc: boolean;
  /** À journaliser sans interrompre : réserve basse, à recharger. */
  alertes: string[];
  /** Motif du refus (503), ou `null` quand la distribution peut avoir lieu. */
  refus: string | null;
}

export function montantMusdAtomic(decimals: number): bigint {
  return parseUnits(MONTANT_MUSD, decimals);
}

export function montantBtcWei(): bigint {
  return parseEther(MONTANT_BTC);
}

/** Demandes que la réserve MUSD peut encore servir, arrondies vers le bas. */
export function demandesRestantes(reserveMusd: bigint, decimals: number): number {
  if (reserveMusd <= BigInt(0)) return 0;
  return Number(reserveMusd / montantMusdAtomic(decimals));
}

export function etatReserveMusd(reserveMusd: bigint, decimals: number): EtatReserve {
  const restantes = demandesRestantes(reserveMusd, decimals);
  if (restantes < 1) return "epuisee";
  return restantes < RESERVE_MUSD_ALERTE_DEMANDES ? "basse" : "ok";
}

export function etatReserveBtc(reserveBtc: bigint): EtatReserve {
  if (reserveBtc < RESERVE_BTC_MINIMALE) return "epuisee";
  return reserveBtc < RESERVE_BTC_ALERTE ? "basse" : "ok";
}

/** On ne verse du MUSD qu'à qui n'en a pas déjà assez pour emprunter plusieurs fois. */
export function doitEnvoyerMusd(soldeMusd: bigint, decimals: number): boolean {
  return soldeMusd <= parseUnits(PLAFOND_MUSD_DESTINATAIRE, decimals);
}

/** On ne verse du BTC qu'à qui en manque : le renvoyer à chaque appel viderait la réserve. */
export function doitEnvoyerBtc(soldeBtc: bigint): boolean {
  return soldeBtc < SEUIL_BTC;
}

/**
 * Message de refus quand la réserve MUSD est vide. Il dit comment la remplir : le MUSD
 * canonique ne se frappe pas, il s'emprunte contre du BTC de test sur l'application Mezo.
 * L'adresse du distributeur y figure pour qu'on sache où envoyer — jamais sa clé.
 */
export function messageReserveMusdEpuisee(reserveMusd: bigint, decimals: number, distributeur: string): string {
  return `Réserve MUSD du distributeur épuisée (${formatUnits(reserveMusd, decimals)} MUSD) — emprunte du MUSD contre du BTC de test sur https://testnet.mezo.org et envoie-le à ${distributeur}`;
}

export function messageReserveBtcEpuisee(reserveBtc: bigint): string {
  return `Distributeur épuisé (${formatEther(reserveBtc)} BTC) — préviens l'équipe pour qu'elle le recharge`;
}

/**
 * Décision complète, prise avant toute écriture. La réserve BTC conditionne tout : le
 * distributeur paie aussi le gas du transfert MUSD, et un versement interrompu à mi-course
 * laisserait le visiteur avec des jetons qu'il ne peut pas dépenser. La réserve MUSD ne
 * bloque que si l'on comptait en verser : un compte déjà pourvu en MUSD peut recevoir son
 * BTC même quand la réserve de jetons est à sec.
 */
export function deciderDistribution(
  soldes: SoldesDistribution,
  options: { decimals: number; distributeur: string },
): DecisionDistribution {
  const { decimals, distributeur } = options;
  const alertes: string[] = [];

  const btc = etatReserveBtc(soldes.reserveBtc);
  if (btc !== "ok") alertes.push(`réserve BTC basse : ${formatEther(soldes.reserveBtc)} BTC — recharger ${distributeur}`);
  const musd = etatReserveMusd(soldes.reserveMusd, decimals);
  if (musd !== "ok") {
    alertes.push(
      `réserve MUSD basse : ${formatUnits(soldes.reserveMusd, decimals)} MUSD, ${demandesRestantes(soldes.reserveMusd, decimals)} demande(s) encore servable(s) — emprunter du MUSD sur https://testnet.mezo.org et l'envoyer à ${distributeur}`,
    );
  }

  const envoyerMusd = doitEnvoyerMusd(soldes.soldeMusd, decimals);
  const envoyerBtc = doitEnvoyerBtc(soldes.soldeBtc);

  let refus: string | null = null;
  if (btc === "epuisee") refus = messageReserveBtcEpuisee(soldes.reserveBtc);
  else if (envoyerMusd && musd === "epuisee") refus = messageReserveMusdEpuisee(soldes.reserveMusd, decimals, distributeur);

  return { envoyerMusd, envoyerBtc, alertes, refus };
}
