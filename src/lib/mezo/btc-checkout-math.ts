/**
 * Devis du paiement en BTC, sans réseau : combien de BTC envoyer pour obtenir au moins le
 * prix en MUSD sur le pool BTC/MUSD, et le plancher que l'oracle impose au swap.
 *
 * Le pool n'expose que `getAmountsOut` : on part du prix de l'oracle, on demande au pool ce
 * qu'il rendrait, et on ajuste jusqu'à couvrir le prix (un petit surplus de MUSD reste à
 * l'acheteur). Le contrat refuse de toute façon un swap sous `minMusdOut` ou sous le plancher.
 */

const ONE = BigInt(10) ** BigInt(18);
const BPS = BigInt(10_000);
/** Marge ajoutée à chaque estimation, pour absorber le mouvement du pool avant l'envoi. */
const BUFFER_BPS = BigInt(50);
const MAX_ROUNDS = 5;

export interface BtcCheckoutQuote {
  /** BTC à envoyer avec la transaction, en wei (18 décimales). */
  btcIn: string;
  /** MUSD que le pool rendrait au moment du devis. */
  expectedMusd: string;
  /** Minimum exigé du swap : le prix du prêt. */
  minMusdOut: string;
  /** MUSD restant à l'acheteur après le verrouillage, au cours du devis. */
  leftoverMusd: string;
  /** Prix BTC/USD de l'oracle, 18 décimales. */
  oraclePrice: string;
  /** Plancher de l'oracle pour `btcIn`, sous lequel le contrat refuse le swap. */
  oracleFloor: string;
}

export class BtcQuoteError extends Error {}

function withBuffer(value: bigint): bigint {
  return value * (BPS + BUFFER_BPS) / BPS + BigInt(1);
}

export async function btcCheckoutQuote(input: {
  amount: bigint;
  oraclePrice: bigint;
  maxSlippageBps: bigint;
  quoteOut: (btcIn: bigint) => Promise<bigint>;
}): Promise<BtcCheckoutQuote> {
  const { amount, oraclePrice, maxSlippageBps, quoteOut } = input;
  if (amount <= BigInt(0)) throw new BtcQuoteError("Prix invalide");
  if (oraclePrice <= BigInt(0)) throw new BtcQuoteError("Prix de l’oracle indisponible");

  let btcIn = withBuffer((amount * ONE + oraclePrice - BigInt(1)) / oraclePrice);
  let out = await quoteOut(btcIn);
  for (let round = 0; out < amount && round < MAX_ROUNDS; round += 1) {
    if (out <= BigInt(0)) throw new BtcQuoteError("Le pool BTC/MUSD ne rend rien pour ce montant");
    btcIn = withBuffer((btcIn * amount + out - BigInt(1)) / out);
    out = await quoteOut(btcIn);
  }
  if (out < amount) throw new BtcQuoteError("Le pool BTC/MUSD n’a pas assez de liquidité pour ce prix");

  const floor = btcIn * oraclePrice / ONE * (BPS - maxSlippageBps) / BPS;
  if (out < floor) throw new BtcQuoteError("Le pool BTC/MUSD s’écarte trop de l’oracle : paiement en BTC suspendu");

  return {
    btcIn: btcIn.toString(),
    expectedMusd: out.toString(),
    minMusdOut: amount.toString(),
    leftoverMusd: (out - amount).toString(),
    oraclePrice: oraclePrice.toString(),
    oracleFloor: floor.toString(),
  };
}
