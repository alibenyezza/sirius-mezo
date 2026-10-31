"use client";

import { useWalletStore } from "@/stores/wallet";
import { signTypedDataWithActiveWallet } from "@/lib/wallet/transaction-client";

/**
 * Emprunt payé en une signature, sans gas pour l'acheteur.
 *
 * Même préparation que `borrowDataset` (`POST /api/loans`), puis le serveur rend deux charges
 * EIP-712 : un `permit` MUSD (omis si l'allowance suffit déjà) et la `LockRequest` reprenant
 * les termes du prêt. Le wallet les signe sans envoyer de transaction ; le compte de
 * règlement de Sirius soumet `lockWithSignature` et paie le gas en BTC. Le prix affiché est
 * recoupé avec le montant signé : une fiche périmée ne fait jamais signer un autre montant.
 */
interface SignatureBorrowInput {
  datasetId: string;
  priceUsdcAtomic: string;
}

interface PreparedSignatureLock {
  request: Record<string, string | number>;
  lockRequest: unknown;
  permit: unknown;
  permitRequired: boolean;
  expiresAt: number;
  error?: string;
}

export async function borrowDatasetWithSignature(input: SignatureBorrowInput): Promise<boolean> {
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
  if (body.billingQuote) throw new Error("Paiement par signature indisponible avec un devis compute");
  assertCurrent();

  const prepared = await fetch(`/api/loans/${body.loanId}/lock-with-signature`, { cache: "no-store" });
  const payload = await prepared.json() as PreparedSignatureLock;
  if (!prepared.ok || !payload.lockRequest || !payload.request) throw new Error(payload.error ?? "Charges de signature indisponibles");
  if (String(payload.request.amount) !== input.priceUsdcAtomic) throw new Error("Prix du dataset modifié. Recharge le catalogue.");
  if (payload.expiresAt * 1_000 <= Date.now()) throw new Error("Préparation du prêt expirée. Relance l’emprunt.");
  assertCurrent();

  // Le permit d'abord : s'il est refusé, aucune demande de lock n'a été signée pour rien.
  const permitSignature = payload.permitRequired ? await signTypedDataWithActiveWallet(payload.permit) : undefined;
  assertCurrent();
  const borrowerSignature = await signTypedDataWithActiveWallet(payload.lockRequest);
  assertCurrent();

  const relay = await fetch(`/api/loans/${body.loanId}/lock-with-signature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request: payload.request, borrowerSignature, ...(permitSignature ? { permitSignature } : {}) }),
  });
  const result = await relay.json() as { txHash?: string; error?: string };
  if (!relay.ok || !result.txHash) throw new Error(result.error ?? "Relais du lock par signature refusé");
  return true;
}
