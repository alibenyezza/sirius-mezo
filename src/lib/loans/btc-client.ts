"use client";

import { useWalletStore } from "@/stores/wallet";
import { sendActiveTransaction, signTypedDataWithActiveWallet } from "@/lib/wallet/transaction-client";

/**
 * Emprunt payé en BTC, en une transaction (`SiriusCheckout.buyWithBtc`).
 *
 * Même préparation que le paiement en une signature : le prêt est réservé, l'acheteur signe
 * le permit MUSD et la `LockRequest`. Puis le serveur recoupe ces signatures et rend la
 * transaction au checkout, que le wallet envoie avec le BTC du devis : le BTC est échangé en
 * MUSD sur le pool BTC/MUSD de Mezo Pools et le prix est verrouillé dans l'escrow, dans la
 * même transaction. Le reste du MUSD échangé reste dans le wallet.
 */
export interface BtcQuote {
  btcIn: string;
  expectedMusd: string;
  minMusdOut: string;
  leftoverMusd: string;
  oraclePrice: string;
  oracleFloor: string;
  btcBalance: string | null;
  error?: string;
}

export async function fetchBtcQuote(priceUsdcAtomic: string): Promise<BtcQuote> {
  const response = await fetch(`/api/mezo/btc-quote?amount=${encodeURIComponent(priceUsdcAtomic)}`, { cache: "no-store" });
  const body = await response.json() as BtcQuote;
  if (!response.ok || !body.btcIn) throw new Error(body.error ?? "Devis BTC indisponible");
  return body;
}

interface PreparedSignatureLock {
  request: Record<string, string | number>;
  lockRequest: unknown;
  permit: unknown;
  permitRequired: boolean;
  expiresAt: number;
  error?: string;
}

export async function borrowDatasetWithBtc(input: { datasetId: string; priceUsdcAtomic: string }): Promise<string> {
  const snapshot = useWalletStore.getState();
  const assertCurrent = () => {
    const current = useWalletStore.getState();
    if (current.revision !== snapshot.revision || current.address !== snapshot.address || !current.authenticated) {
      throw new Error("Le wallet a changé. Relance l’opération.");
    }
  };
  const prep = await fetch("/api/loans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ datasetId: input.datasetId }),
  });
  const body = await prep.json() as { loanId?: string; billingQuote?: unknown; error?: string };
  if (!prep.ok || !body.loanId) throw new Error(body.error ?? "Préparation du lock de paiement échouée");
  if (body.billingQuote) throw new Error("Paiement en BTC indisponible avec un devis compute");
  assertCurrent();

  const prepared = await fetch(`/api/loans/${body.loanId}/lock-with-signature`, { cache: "no-store" });
  const payload = await prepared.json() as PreparedSignatureLock;
  if (!prepared.ok || !payload.lockRequest || !payload.request) throw new Error(payload.error ?? "Charges de signature indisponibles");
  if (String(payload.request.amount) !== input.priceUsdcAtomic) throw new Error("Prix du dataset modifié. Recharge le catalogue.");
  if (payload.expiresAt * 1_000 <= Date.now()) throw new Error("Préparation du prêt expirée. Relance l’emprunt.");
  assertCurrent();

  const permitSignature = payload.permitRequired ? await signTypedDataWithActiveWallet(payload.permit) : undefined;
  assertCurrent();
  const borrowerSignature = await signTypedDataWithActiveWallet(payload.lockRequest);
  assertCurrent();

  // Devis frais juste avant l'envoi : le pool a pu bouger pendant les signatures.
  const quote = await fetchBtcQuote(input.priceUsdcAtomic);
  const checkout = await fetch(`/api/loans/${body.loanId}/pay-with-btc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request: payload.request, borrowerSignature, ...(permitSignature ? { permitSignature } : {}),
      btcIn: quote.btcIn, minMusdOut: quote.minMusdOut,
    }),
  });
  const prepared2 = await checkout.json() as { transaction?: Record<string, unknown>; error?: string };
  if (!checkout.ok || !prepared2.transaction) throw new Error(prepared2.error ?? "Paiement en BTC refusé");
  assertCurrent();

  const lockTxHash = await sendActiveTransaction(prepared2.transaction, { assertCurrent });
  window.sessionStorage.setItem(`sirius:loan-lock:${body.loanId}`, lockTxHash);
  const submit = await fetch(`/api/loans/${body.loanId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lockTxHash }),
  });
  const submitted = await submit.json() as { error?: string };
  if (!submit.ok) throw new Error(submitted.error ?? "Lock de paiement non confirmé");
  window.sessionStorage.removeItem(`sirius:loan-lock:${body.loanId}`);
  return lockTxHash;
}
