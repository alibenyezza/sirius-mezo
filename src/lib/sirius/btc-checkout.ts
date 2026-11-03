import "server-only";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { AppError } from "@/lib/errors";
import { normalizeAddress } from "@/lib/evm/address";
import { checkoutAddress, escrowAddress, usdcAddress } from "@/lib/evm/addresses";
import { siriuscheckoutAbi } from "@/lib/evm/abi/siriuscheckout";
import { getPublicClient } from "@/lib/evm/client";
import { mezoFeatures } from "@/lib/mezo/features";
import { BTC_TOKEN_ADDRESS, MEZO_CHECKOUT_TESTNET } from "@/lib/mezo/protocol";
import { btcCheckoutQuote, BtcQuoteError, type BtcCheckoutQuote } from "@/lib/mezo/btc-checkout-math";
import { verifySignedLock } from "./gasless-lock";

/**
 * Paiement d'un entraînement en BTC, en une transaction : `SiriusCheckout.buyWithBtc`.
 *
 * L'acheteur signe la même `LockRequest` (et le même permit MUSD) que pour le paiement sans
 * gas, puis envoie lui-même une transaction au checkout avec du BTC : le contrat échange ce
 * BTC en MUSD sur le pool BTC/MUSD de Mezo Pools, le MUSD arrive dans son wallet, et l'escrow
 * le verrouille aussitôt. Le serveur ne fait que deux choses : un devis (combien de BTC pour
 * le prix, au cours du pool, recoupé avec l'oracle) et la préparation de la transaction après
 * avoir recoupé les termes signés. Il ne paie rien et ne soumet rien.
 *
 * Interrupteur `SIRIUS_PAY_WITH_BTC=true` et `SIRIUS_CHECKOUT_ADDRESS`. Testnet seulement.
 */

const routerAbi = parseAbi([
  "struct Route { address from; address to; bool stable; address factory; }",
  "function getAmountsOut(uint256 amountIn, Route[] routes) view returns (uint256[] amounts)",
]);
const erc20Abi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

function requireCheckout(): Address {
  const checkout = checkoutAddress();
  if (!mezoFeatures().payWithBtc || !checkout) throw new AppError("Paiement en BTC désactivé sur cette instance", 404);
  return checkout;
}

async function readCheckoutState(checkout: Address, borrower: Address) {
  const client = getPublicClient();
  const [linkedEscrow, btcBalance, musdBalance] = await Promise.all([
    client.readContract({ address: checkout, abi: siriuscheckoutAbi, functionName: "escrow" }),
    client.getBalance({ address: borrower }),
    client.readContract({ address: usdcAddress(), abi: erc20Abi, functionName: "balanceOf", args: [borrower] }),
  ]);
  if (normalizeAddress(linkedEscrow) !== normalizeAddress(escrowAddress())) {
    throw new AppError("Le checkout BTC ne pointe pas sur l’escrow courant", 409);
  }
  return { btcBalance, musdBalance };
}

/** Combien de BTC envoyer pour `amount` MUSD, au cours du pool et sous le contrôle de l'oracle. */
export async function quoteBtcCheckout(amount: bigint, borrower?: string | null): Promise<BtcCheckoutQuote & { btcBalance: string | null }> {
  const checkout = requireCheckout();
  if (amount <= BigInt(0) || amount > BigInt(10) ** BigInt(30)) throw new AppError("Montant invalide", 400);
  const client = getPublicClient();
  const btcBalance = borrower
    ? (await readCheckoutState(checkout, normalizeAddress(borrower) as Address)).btcBalance.toString()
    : null;
  const route = [{ from: BTC_TOKEN_ADDRESS, to: usdcAddress(), stable: false, factory: MEZO_CHECKOUT_TESTNET.poolFactory as Address }];
  const quoteOut = async (btcIn: bigint) => {
    const amounts = await client.readContract({
      address: MEZO_CHECKOUT_TESTNET.poolsRouter as Address, abi: routerAbi, functionName: "getAmountsOut", args: [btcIn, route],
    });
    return amounts[amounts.length - 1];
  };
  const oracle = await client.readContract({ address: checkout, abi: siriuscheckoutAbi, functionName: "oracleFloor", args: [BigInt(10) ** BigInt(18)] });
  let quote: BtcCheckoutQuote;
  try {
    quote = await btcCheckoutQuote({ amount, oraclePrice: oracle[0], maxSlippageBps: BigInt(MEZO_CHECKOUT_TESTNET.maxSlippageBps), quoteOut });
  } catch (error) {
    if (error instanceof BtcQuoteError) throw new AppError(error.message, 409);
    throw error;
  }
  return { ...quote, btcBalance };
}

/**
 * Recoupe la requête signée, puis rend la transaction `buyWithBtc` que le wallet de
 * l'acheteur enverra, après l'avoir simulée depuis son adresse.
 */
export async function prepareBtcCheckout(loanId: string, borrower: string, body: unknown) {
  const checkout = requireCheckout();
  const borrowerAddress = normalizeAddress(borrower) as `0x${string}`;
  const raw = (body ?? {}) as { btcIn?: unknown; minMusdOut?: unknown };
  if (typeof raw.btcIn !== "string" || !/^[1-9][0-9]{0,30}$/.test(raw.btcIn)) throw new AppError("Montant de BTC invalide", 400);
  if (typeof raw.minMusdOut !== "string" || !/^[0-9]{1,40}$/.test(raw.minMusdOut)) throw new AppError("Minimum de MUSD invalide", 400);
  const btcIn = BigInt(raw.btcIn);
  const minMusdOut = BigInt(raw.minMusdOut);

  const { request, borrowerSignature, permit, authorization } = await verifySignedLock(loanId, borrowerAddress, body);
  if (minMusdOut < request.amount) throw new AppError("Le minimum du swap doit couvrir le prix", 400);
  const { btcBalance } = await readCheckoutState(checkout, borrowerAddress);
  if (btcBalance <= btcIn) throw new AppError("Solde BTC insuffisant pour ce paiement et son gas", 409);

  const args = [minMusdOut, request, borrowerSignature as Hex, permit, authorization] as const;
  try {
    await getPublicClient().simulateContract({
      address: checkout, abi: siriuscheckoutAbi, functionName: "buyWithBtc", args, value: btcIn, account: borrowerAddress,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = ["BelowOracleFloor", "SwapShortfall", "StaleOracle", "BadOraclePrice", "INSUFFICIENT_OUTPUT_AMOUNT", "InvalidBorrowerSignature", "PermitFailed"]
      .find((name) => message.includes(name));
    throw new AppError(known ? `Paiement en BTC refusé par le contrat : ${known}` : "Paiement en BTC refusé par le contrat", 409);
  }
  return {
    transaction: {
      to: checkout,
      data: encodeFunctionData({ abi: siriuscheckoutAbi, functionName: "buyWithBtc", args }),
      value: `0x${btcIn.toString(16)}`,
    },
    expiresAt: Number(request.deadline),
  };
}
