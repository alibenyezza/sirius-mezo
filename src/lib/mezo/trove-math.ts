/**
 * Arithmétique pure d'un trove MUSD (conventions Liquity), en bigint uniquement.
 *
 * Toutes les quantités sont des entiers « atomiques » : collatéral BTC et dette MUSD en
 * 1e18, prix en USD × 1e18 (celui de `PriceFeed.fetchPrice()`), ratios en 1e18
 * (1,10 = 1100000000000000000). Aucun flottant : une erreur d'arrondi ici déciderait
 * à tort qu'un tirage est sûr ou non.
 */

export const ONE = BigInt("1000000000000000000");
/** Échelle du ratio nominal (Liquity : `coll * 1e20 / debt`). */
export const NICR_PRECISION = BigInt("100000000000000000000");
const BPS = BigInt(10_000);
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);

export const REASON_NO_TROVE = "No active trove";
export const REASON_BELOW_THRESHOLD = "Collateral ratio would fall below the safe threshold";
export const REASON_RECOVERY_MODE = "Mezo is in Recovery Mode: a draw must keep the ratio above 150 %";
export const REASON_CAPACITY = "Draw exceeds this trove's maximum borrowing capacity";

function assertNonNegative(value: bigint, name: string): void {
  if (value < BigInt(0)) throw new RangeError(`${name} must be non-negative`);
}

/**
 * Ratio de collatéralisation individuel (`coll * price / debt`), en 1e18.
 * Sans dette, le trove est infiniment couvert : on rend `uint256.max` comme le contrat.
 */
export function icr(coll: bigint, debt: bigint, price: bigint): bigint {
  assertNonNegative(coll, "coll");
  assertNonNegative(debt, "debt");
  assertNonNegative(price, "price");
  if (debt === BigInt(0)) return UINT256_MAX;
  return (coll * price) / debt;
}

/** Ratio nominal, indépendant du prix (`coll * 1e20 / debt`) : clé de tri de SortedTroves. */
export function nominalIcr(coll: bigint, debt: bigint): bigint {
  assertNonNegative(coll, "coll");
  assertNonNegative(debt, "debt");
  if (debt === BigInt(0)) return UINT256_MAX;
  return (coll * NICR_PRECISION) / debt;
}

/** Frais d'emprunt `amount * rateBps / 10 000`, arrondis vers le bas comme on-chain. */
export function borrowingFee(amount: bigint, rateBps: number | bigint): bigint {
  assertNonNegative(amount, "amount");
  const rate = BigInt(rateBps);
  assertNonNegative(rate, "rateBps");
  return (amount * rate) / BPS;
}

export interface DrawQuoteInput {
  /** Collatéral courant du trove (1e18). */
  coll: bigint;
  /** Dette courante du trove, intérêts compris (1e18). Zéro = pas de trove actif. */
  debt: bigint;
  /** Prix BTC/USD (1e18). */
  price: bigint;
  /** MUSD à tirer (1e18). */
  amount: bigint;
  /** Taux des frais d'emprunt en points de base (10 = 0,1 %). */
  feeRateBps: number | bigint;
  /** Frais exacts rendus par `getBorrowingFee` ; s'ils sont fournis, ils priment sur le taux. */
  fee?: bigint;
  /** Ratio minimal du protocole (1e18). */
  mcr: bigint;
  /** Marge de sécurité au-dessus du MCR, en points de base (1 000 = +10 %). */
  safetyMarginBps: number | bigint;
  /**
   * Système en Recovery Mode (TCR sous le CCR) : le protocole n'accepte alors une hausse de
   * dette que si le ratio du trove reste au-dessus du CCR.
   */
  recoveryMode?: boolean;
  /** Ratio critique du système (1e18), 150 % sur MUSD. */
  ccr?: bigint;
  /** Plafond de dette du trove fixé par MUSD (`getTroveMaxBorrowingCapacity`), 0 = inconnu. */
  maxBorrowingCapacity?: bigint;
}

export interface DrawQuote {
  /** Frais ajoutés à la dette. */
  fee: bigint;
  /** Dette après tirage : `debt + amount + fee`. */
  newDebt: bigint;
  /** Ratio après tirage, au prix fourni (1e18). */
  newIcr: bigint;
  /** Seuil appliqué : `mcr * (1 + marge)` (1e18). */
  threshold: bigint;
  allowed: boolean;
  /** Motif du refus, en anglais, ou `null` si le tirage est permis. */
  reason: string | null;
}

/**
 * Devis d'un tirage de MUSD sur un trove existant. Le tirage est permis si le trove est
 * actif (dette non nulle) et si le ratio après tirage reste au-dessus du MCR majoré de
 * la marge. Le contrat, lui, n'exige que le MCR : la marge protège l'utilisateur d'une
 * liquidation à la première baisse du BTC.
 */
export function drawQuote(input: DrawQuoteInput): DrawQuote {
  const { coll, debt, price, amount, mcr } = input;
  assertNonNegative(amount, "amount");
  assertNonNegative(mcr, "mcr");
  const margin = BigInt(input.safetyMarginBps);
  assertNonNegative(margin, "safetyMarginBps");

  if (input.fee !== undefined) assertNonNegative(input.fee, "fee");
  const fee = input.fee ?? borrowingFee(amount, input.feeRateBps);
  const newDebt = debt + amount + fee;
  const newIcr = icr(coll, newDebt, price);
  const threshold = (mcr * (BPS + margin)) / BPS;

  if (debt === BigInt(0)) {
    return { fee, newDebt, newIcr, threshold, allowed: false, reason: REASON_NO_TROVE };
  }
  if (newIcr < threshold) {
    return { fee, newDebt, newIcr, threshold, allowed: false, reason: REASON_BELOW_THRESHOLD };
  }
  if (input.recoveryMode && input.ccr !== undefined && newIcr < input.ccr) {
    return { fee, newDebt, newIcr, threshold: input.ccr, allowed: false, reason: REASON_RECOVERY_MODE };
  }
  if (input.maxBorrowingCapacity !== undefined && input.maxBorrowingCapacity > BigInt(0) && newDebt > input.maxBorrowingCapacity) {
    return { fee, newDebt, newIcr, threshold, allowed: false, reason: REASON_CAPACITY };
  }
  return { fee, newDebt, newIcr, threshold, allowed: true, reason: null };
}
