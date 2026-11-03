"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { messageOf } from "@/lib/errors-client";
import { drawMusdFromTrove, fetchTroveQuote, type TroveQuoteResponse } from "@/lib/mezo/draw-client";
import { useWalletStore } from "@/stores/wallet";

/**
 * Carte « Payer depuis mon Bitcoin » de la fiche d'un dataset.
 *
 * Affichée quand l'acheteur connecté a un trove MUSD actif et que son solde MUSD ne couvre
 * pas le prix : il signe un tirage du seul montant manquant sur son trove (relayé, sans gas),
 * puis l'emprunt reprend (en une signature quand l'instance le permet). Sans trove, une ligne discrète renvoie vers l'ouverture d'un trove sur Mezo.
 */

function ratio(value: string): string {
  const icr = Number(formatUnits(BigInt(value), 18));
  if (!Number.isFinite(icr) || icr > 1_000) return "∞";
  return `${Math.round(icr * 100)} %`;
}

function musd(value: string): string {
  const amount = Number(formatUnits(BigInt(value), 18));
  return amount.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function BorrowAndBuyCard({
  priceUsdcAtomic,
  onDrawn,
  disabled,
}: {
  priceUsdcAtomic: string;
  /** Appelé après un tirage confirmé : la fiche relance alors l'emprunt classique. */
  onDrawn: () => Promise<void>;
  disabled: boolean;
}) {
  const { t } = useLocale();
  const authenticated = useWalletStore((s) => s.authenticated);
  const address = useWalletStore((s) => s.address);
  const [quote, setQuote] = useState<TroveQuoteResponse | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Le devis est rangé avec le compte qui l'a demandé : un changement de wallet ne réutilise
  // jamais la position d'un autre compte.
  const [quoteOwner, setQuoteOwner] = useState<string | null>(null);
  useEffect(() => {
    if (!authenticated || !address || !priceUsdcAtomic) return;
    let actif = true;
    // Premier devis au prix pour lire le solde, puis devis du seul manque.
    fetchTroveQuote(priceUsdcAtomic)
      .then(async (q) => {
        if (!q) return q;
        const shortfall = BigInt(priceUsdcAtomic) - BigInt(q.position.musdBalance);
        return shortfall > BigInt(0) && shortfall < BigInt(priceUsdcAtomic) ? fetchTroveQuote(shortfall.toString()) : q;
      })
      .then((q) => { if (actif) { setQuote(q); setQuoteOwner(address); } })
      .catch(() => { if (actif) { setQuote(null); setQuoteOwner(address); } });
    return () => { actif = false; };
  }, [authenticated, address, priceUsdcAtomic, txHash]);

  // Rien à proposer : instance sans la fonction, acheteur déjà pourvu en MUSD, ou devis d'un autre compte.
  if (!authenticated || !address || quoteOwner !== address || !quote) return null;
  const { position, quote: draw } = quote;
  const price = BigInt(priceUsdcAtomic);
  if (BigInt(position.musdBalance) >= price) return null;

  if (!position.hasTrove) {
    return (
      <p className="text-xs text-muted">
        {t("Pas assez de MUSD ? Ouvre un trove sur")}{" "}
        <a href="https://testnet.mezo.org" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">testnet.mezo.org</a>{" "}
        {t("et paie directement depuis ton Bitcoin.")}
      </p>
    );
  }

  async function drawThenBorrow() {
    setBusy(true);
    setError(null);
    try {
      const result = await drawMusdFromTrove(draw.amount);
      setTxHash(result.txHash);
      await onDrawn();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-accent/40 bg-surface p-4">
      <p className="text-sm font-medium">{t("Payer depuis ton Bitcoin")}</p>
      <p className="mt-1 text-xs text-muted">
        {t("Tire {amount} MUSD sur ton trove Mezo : ta dette augmente de {amount} MUSD plus {fee} MUSD de frais, ton BTC reste en collatéral.", { amount: musd(draw.amount), fee: musd(draw.fee) })}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <dt className="text-muted">{t("Dette actuelle")}</dt><dd className="font-mono">{musd(position.debt)} MUSD</dd>
        <dt className="text-muted">{t("Dette après")}</dt><dd className="font-mono">{musd(draw.newDebt)} MUSD</dd>
        <dt className="text-muted">{t("Ratio actuel")}</dt><dd className="font-mono">{ratio(position.icr)}</dd>
        <dt className="text-muted">{t("Ratio après")}</dt><dd className="font-mono">{ratio(draw.newIcr)}</dd>
      </dl>
      {draw.allowed ? (
        <button
          type="button"
          onClick={() => void drawThenBorrow()}
          disabled={busy || disabled}
          className="mt-3 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {busy ? t("Tirage en cours…") : t("Tirer le MUSD et acheter")}
        </button>
      ) : (
        <p className="mt-3 text-xs text-negative">{t(draw.reason ?? "Tirage refusé")}</p>
      )}
      <p className="mt-2 text-xs text-muted">{t("Une signature, aucune transaction : Sirius soumet le tirage et paie le gas. Le MUSD arrive directement sur ton wallet.")}</p>
      {error && <p role="alert" className="mt-2 text-xs text-negative">{t(error)}</p>}
    </div>
  );
}
