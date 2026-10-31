"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { useComputeQuoteConfirmation } from "@/components/loans/ComputeQuoteDialog";
import { useDuplicateLoanConfirmation } from "@/components/loans/DuplicateLoanDialog";
import { ensureVerifiedFor, requestVerification, useOnboardingStore } from "@/components/onboarding/onboarding-store";
import { connectWallet } from "@/components/wallet/WalletConnector";
import { signInWithWallet } from "@/lib/auth/client";
import { messageOf } from "@/lib/errors-client";
import { borrowDataset } from "@/lib/loans/client";
import { borrowDatasetWithSignature } from "@/lib/loans/signature-client";
import { BorrowAndBuyCard } from "@/components/loans/BorrowAndBuyCard";
import { modelSelection } from "@/lib/models/registry";
import { createInFlightGuard } from "@/lib/onboarding/steps";
import { activeLoanOnDataset, type LoanDisplayInput } from "@/lib/train/loan-display";
import { useWalletStore } from "@/stores/wallet";

/** Au-delà du cache de 30 s de `/api/account/status`, pour relire un statut frais. */
const KYB_RECHECK_MS = 31_000;

/** Compte signé à l'instant présent (lu dans le store, pas dans une fermeture périmée). */
function currentSession(): string | null {
  const { authenticated, address } = useWalletStore.getState();
  return authenticated && address ? address : null;
}

/**
 * Bouton « Emprunter » de la fiche publique.
 *
 * Le parcours d'emprunt est celui d'avant, inchangé : `borrowDataset` (préparation du prêt,
 * devis signé confirmé par l'emprunteur, approbation puis lock). Seule nouveauté : la fiche se lit
 * sans wallet, et c'est ici, au clic, que la connexion puis la signature sont demandées. Après la
 * signature, l'emprunteur clique à nouveau : l'emprunt ne part jamais tout seul.
 */
export function BorrowPanel({
  datasetId,
  priceUsdcAtomic,
  modelId,
  modelVersion,
  providerVerified,
}: {
  datasetId: string;
  /**
   * Statut KYB du fournisseur lu par la fiche. `false` : l'emprunt serait refusé par le serveur
   * et le contrat (`requireCounterpartyKyb`), le bouton est donc désactivé avant toute signature.
   * `null` (illisible) laisse essayer : le serveur tranche.
   */
  providerVerified: boolean | null;
  priceUsdcAtomic: string;
  modelId: string | null;
  modelVersion: string | null;
}) {
  const { t } = useLocale();
  const address = useWalletStore((s) => s.address);
  const authenticated = useWalletStore((s) => s.authenticated);
  const { confirmQuote, quoteDialog } = useComputeQuoteConfirmation();
  const { confirmDuplicate, duplicateDialog } = useDuplicateLoanConfirmation();
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [gaslessLock, setGaslessLock] = useState(false);
  const [borrowGuard] = useState(createInFlightGuard);
  const [signingIn, setSigningIn] = useState(false);
  // Message d'erreur et emprunt réussi sont, eux aussi, rangés avec le compte : après un
  // changement de wallet ou une déconnexion, rien du compte précédent ne reste affiché.
  const [errorState, setErrorState] = useState<{ session: string | null; message: string } | null>(null);
  const [borrowed, setBorrowed] = useState<{ session: string | null; count: number }>({ session: null, count: 0 });
  const setError = (message: string | null) =>
    setErrorState(message === null ? null : { session: currentSession(), message });
  // Chaque lecture est rangée avec le compte qui l'a faite : après un changement de wallet, la
  // valeur d'un autre compte n'est jamais réutilisée. Le panneau n'est pas remonté à chaque
  // révision du wallet, sinon une connexion en cours perdrait son état et ses erreurs.
  const [kyb, setKyb] = useState<{ session: string; missing: boolean } | null>(null);
  const [loans, setLoans] = useState<{ session: string; active: LoanDisplayInput | null } | null>(null);
  const [rechecked, setRechecked] = useState<string | null>(null);
  const model = modelSelection(modelId, modelVersion);
  const sessionKey = authenticated && address ? address : null;
  // `null` tant qu'on ne sait pas : rien n'est affiché plutôt qu'un bouton qui clignote.
  const kybManquant = kyb && kyb.session === sessionKey ? kyb.missing : null;
  const dejaEmprunte = loans && loans.session === sessionKey ? loans.active : null;
  const error = errorState && errorState.session === sessionKey ? errorState.message : null;

  // Prêt déjà payé sur ce dataset pour ce compte : emprunter deux fois est légitime, mais on
  // demande confirmation pour distinguer l'intention d'un emprunt cru perdu (attente de finalité).
  useEffect(() => {
    if (!sessionKey) return;
    let actif = true;
    void fetch("/api/loans")
      .then((r) => (r.ok ? (r.json() as Promise<LoanDisplayInput[]>) : null))
      .then((prets) => {
        if (!actif || !Array.isArray(prets)) return;
        setLoans({ session: sessionKey, active: activeLoanOnDataset(prets, datasetId, sessionKey) });
      })
      .catch(() => {});
    return () => {
      actif = false;
    };
  }, [sessionKey, datasetId, borrowed.count]);

  // L'attestation KYB est posée juste après la signature ; ce formulaire n'est qu'un secours.
  // Une première lecture « absente » peut précéder la fin de cette attestation automatique :
  // une seule relecture, quelques secondes plus tard, évite d'afficher le secours à tort.
  useEffect(() => {
    if (!sessionKey) return;
    let actif = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void fetch(`/api/account/status?address=${encodeURIComponent(sessionKey)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ known?: unknown }>) : null))
      .then((corps) => {
        if (!actif) return;
        // Statut illisible (503, 429) ou « absent » : une relecture plus tard, puis on s'en tient là.
        const missing = corps ? corps.known !== true : null;
        if (missing !== false && rechecked !== sessionKey) {
          timer = setTimeout(() => setRechecked(sessionKey), KYB_RECHECK_MS);
          return;
        }
        if (missing !== null) setKyb({ session: sessionKey, missing });
      })
      .catch(() => {
        if (actif && rechecked !== sessionKey) timer = setTimeout(() => setRechecked(sessionKey), KYB_RECHECK_MS);
      });
    return () => {
      actif = false;
      if (timer) clearTimeout(timer);
    };
  }, [sessionKey, rechecked]);

  // Lock par signature : affiché seulement si l'instance relaie `lockWithSignature`.
  useEffect(() => {
    let actif = true;
    void fetch("/api/mezo/features", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ gaslessLock?: unknown }>) : null))
      .then((features) => { if (actif && features) setGaslessLock(features.gaslessLock === true); })
      .catch(() => {});
    return () => { actif = false; };
  }, []);

  async function signIn() {
    setSigningIn(true);
    try {
      if (!useWalletStore.getState().connected) await connectWallet();
      const { connected, authenticated: signed } = useWalletStore.getState();
      if (connected && !signed) await signInWithWallet();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSigningIn(false);
    }
  }

  // Un seul emprunt en vol : la garde KYB lit le réseau avant `setBusy`, et un double clic
  // préparerait sinon deux réservations.
  async function borrow() {
    await borrowGuard.run(borrowOnce);
  }

  async function borrowOnce() {
    setError(null);
    if (!useWalletStore.getState().authenticated) {
      await signIn();
      return;
    }
    if (providerVerified === false) return;
    // Wallet non vérifié : la fenêtre de vérification s'ouvre, puis l'emprunt reprend ici.
    if (!(await ensureVerifiedFor("borrow"))) return;
    if (sessionKey && useOnboardingStore.getState().kyb === "valid") setKyb({ session: sessionKey, missing: false });
    if (!model || !priceUsdcAtomic) {
      setError("Profil d’entraînement du dataset absent ou invalide");
      return;
    }
    if (dejaEmprunte && !(await confirmDuplicate(dejaEmprunte))) return;
    setBusy(true);
    try {
      if (await borrowDataset({ datasetId, priceUsdcAtomic, confirmQuote })) {
        setBorrowed((current) => ({ session: currentSession(), count: current.count + 1 }));
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  // Même garde que l'emprunt classique ; seul le mode de paiement change (deux signatures,
  // aucune transaction, gas payé par Sirius). Le prix affiché est recoupé côté client.
  async function borrowWithSignature() {
    await borrowGuard.run(async () => {
      setError(null);
      if (!useWalletStore.getState().authenticated) {
        await signIn();
        return;
      }
      if (providerVerified === false) return;
      if (!(await ensureVerifiedFor("borrow"))) return;
      if (sessionKey && useOnboardingStore.getState().kyb === "valid") setKyb({ session: sessionKey, missing: false });
      if (!model || !priceUsdcAtomic) {
        setError("Profil d’entraînement du dataset absent ou invalide");
        return;
      }
      if (dejaEmprunte && !(await confirmDuplicate(dejaEmprunte))) return;
      setSigning(true);
      try {
        if (await borrowDatasetWithSignature({ datasetId, priceUsdcAtomic })) {
          setBorrowed((current) => ({ session: currentSession(), count: current.count + 1 }));
        }
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setSigning(false);
      }
    });
  }

  // Vérification dans la fenêtre partagée (accès instantané, ou invitation si coupé), sans quitter la fiche.
  async function handleOnboard() {
    setError(null);
    const session = sessionKey;
    if (await requestVerification("checklist", "borrower") && session) setKyb({ session, missing: false });
  }

  const showKyb = sessionKey !== null && kybManquant === true;

  return (
    <div className="space-y-3">
      {quoteDialog}
      {duplicateDialog}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void borrow()}
          disabled={busy || signing || signingIn || !model || !priceUsdcAtomic || providerVerified === false}
          title={!model ? t("Réimporte ce dataset avec un profil d’entraînement") : undefined}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {busy ? t("Escrow…") : signingIn ? t("Connexion…") : t("Emprunter")}
        </button>
        {gaslessLock && (
          <button
            type="button"
            onClick={() => void borrowWithSignature()}
            disabled={busy || signing || signingIn || !model || !priceUsdcAtomic || providerVerified === false}
            title={t("Deux signatures dans ton wallet, aucune transaction : Sirius soumet le lock et paie le gas en BTC. Le MUSD part de ton compte au moment du lock.")}
            className="rounded-xl border border-accent/60 bg-surface px-5 py-2.5 text-sm font-medium text-accent transition-colors hover:border-accent disabled:opacity-50"
          >
            {signing ? t("Signature…") : t("Payer en une signature (sans gas)")}
          </button>
        )}
        {showKyb && (
          <button
            type="button"
            onClick={() => void handleOnboard()}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-white/20"
          >
            {t("Vérifier mon wallet")}
          </button>
        )}
      </div>
      {authenticated && model && priceUsdcAtomic && providerVerified !== false && (
        <BorrowAndBuyCard priceUsdcAtomic={priceUsdcAtomic} disabled={busy || signing || signingIn} onDrawn={borrow} />
      )}
      {!authenticated && (
        <p className="text-xs text-muted">
          {t("La consultation est ouverte à tous. Pour emprunter, connectez votre wallet et signez : la connexion est demandée au clic.")}
        </p>
      )}
      {!model && <p className="text-xs text-negative">{t("Profil d’entraînement manquant")}</p>}
      {providerVerified === false && (
        <p className="text-xs text-negative">
          {t("Emprunt indisponible : l’attestation de vérification du fournisseur est absente ou expirée.")}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
          {t(error)}
        </p>
      )}
      {borrowed.count > 0 && borrowed.session === sessionKey && !error && (
        <p role="status" className="rounded-lg border border-positive/40 bg-positive/10 px-3 py-2 text-sm">
          {t("Emprunt enregistré. Lancez l’entraînement depuis la page")}{" "}
          <Link href="/train" className="font-medium underline underline-offset-2">{t("Entraîner")}</Link>.
        </p>
      )}
    </div>
  );
}
