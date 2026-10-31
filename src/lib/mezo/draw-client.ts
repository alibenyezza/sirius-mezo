"use client";

import { useWalletStore } from "@/stores/wallet";
import { signTypedDataWithActiveWallet } from "@/lib/wallet/transaction-client";
import { withdrawMusdTypedData } from "./draw-typed-data";
import type { TrovePosition, DrawQuoteView } from "./trove";

/**
 * Côté navigateur du tirage sur trove : lire le devis, faire signer le message `WithdrawMUSD`
 * au wallet, confier la soumission au relayeur. Aucune transaction n'est envoyée par le wallet.
 */

export interface TroveQuoteResponse {
  account: string;
  network: string;
  position: TrovePosition;
  quote: DrawQuoteView;
  typedData: { chainId: number; verifyingContract: `0x${string}` };
  error?: string;
}

/** Fenêtre de validité de la signature de tirage : cinq minutes, sous le plafond du relayeur. */
const DRAW_TTL_SECONDS = 5 * 60;

export async function fetchTroveQuote(amountAtomic: string): Promise<TroveQuoteResponse | null> {
  const response = await fetch(`/api/trove?amount=${encodeURIComponent(amountAtomic)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  const body = await response.json() as TroveQuoteResponse;
  if (!response.ok) throw new Error(body.error ?? "Position MUSD indisponible");
  return body;
}

export async function drawMusdFromTrove(amountAtomic: string): Promise<{ txHash: string }> {
  const { address, authenticated } = useWalletStore.getState();
  if (!address || !authenticated) throw new Error("Authentifie-toi avant de signer.");
  const quote = await fetchTroveQuote(amountAtomic);
  if (!quote) throw new Error("Tirage sur trove indisponible sur cette instance");
  if (!quote.quote.allowed) throw new Error(quote.quote.reason ?? "Tirage refusé");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DRAW_TTL_SECONDS);
  const nonce = BigInt(quote.position.nonce);
  const payload = withdrawMusdTypedData({
    chainId: quote.typedData.chainId,
    verifyingContract: quote.typedData.verifyingContract,
    amount: BigInt(amountAtomic),
    borrower: address as `0x${string}`,
    recipient: address as `0x${string}`,
    nonce,
    deadline,
  });
  // Les wallets attendent les entiers en chaînes décimales dans un `eth_signTypedData_v4`.
  const signature = await signTypedDataWithActiveWallet({
    ...payload,
    message: { ...payload.message, amount: amountAtomic, nonce: nonce.toString(), deadline: deadline.toString() },
  });
  const relay = await fetch("/api/trove/draw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: amountAtomic, nonce: nonce.toString(), deadline: deadline.toString(), signature }),
  });
  const result = await relay.json() as { txHash?: string; error?: string };
  if (!relay.ok || !result.txHash) throw new Error(result.error ?? "Relais du tirage refusé");
  return { txHash: result.txHash };
}
