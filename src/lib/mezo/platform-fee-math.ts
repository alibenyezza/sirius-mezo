/**
 * Calculs purs des frais de plateforme, identiques à ceux de `SiriusEscrow.release` :
 * frais = montant × bps / 10 000 arrondi vers le bas, le fournisseur reçoit le reste.
 * Partagés par le serveur et l'écran de prix.
 */

export interface PlatformFee {
  /** Taux de base de l'escrow, en points de base. */
  baseBps: number;
  /** Taux pour un fournisseur qui détient assez de veMEZO, `null` sans politique. */
  discountedBps: number | null;
  /** Pouvoir de vote veMEZO requis pour la remise (18 décimales), `null` sans politique. */
  minVeMezoPower: string | null;
}

export function feeAtomic(amountAtomic: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new RangeError("bps hors bornes");
  return (amountAtomic * BigInt(bps)) / BigInt(10_000);
}

export function providerNetAtomic(amountAtomic: bigint, bps: number): bigint {
  return amountAtomic - feeAtomic(amountAtomic, bps);
}

/** « 2 % », « 0,5 % » : pourcentage lisible d'un taux en points de base. */
export function formatBps(bps: number, locale = "fr-FR"): string {
  return `${(bps / 100).toLocaleString(locale, { maximumFractionDigits: 2 })} %`;
}
