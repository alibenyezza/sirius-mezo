"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { messageOf } from "@/lib/errors-client";
import { borrowDatasetWithBtc, fetchBtcQuote, type BtcQuote } from "@/lib/loans/btc-client";
import { useWalletStore } from "@/stores/wallet";

/**
 * Carte « Payer en BTC » de la fiche d'un dataset.
 *
 * Une transaction, depuis le wallet de l'acheteur : le BTC envoyé est échangé en MUSD sur le
 * pool BTC/MUSD de Mezo Pools, recoupé avec l'oracle BTC/USD de Mezo, et le prix est verrouillé
 * dans l'escrow dans la même transaction. Avant, deux signatures (permit MUSD et demande de
 * lock). Le devis est relu toutes les 30 secondes.
 */

const EXPLORER = "https://explorer.test.mezo.org";

function btc(value: string): string {
  return Number(formatUnits(BigInt(value), 18)).toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

function musd(value: string): string {
  return Number(formatUnits(BigInt(value), 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function PayWithBtcCard({
  datasetId,
  priceUsdcAtomic,
  disabled,
  onPaid,
}: {
  datasetId: string;
  priceUsdcAtomic: string;
  disabled: boolean;
  onPaid: () => void;
}) {
  const { t } = useLocale();
  const authenticated = useWalletStore((s) => s.authenticated);
  const address = useWalletStore((s) => s.address);
  const [quote, setQuote] = useState<{ owner: string | null; value: BtcQuote | null }>({ owner: null, value: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    const owner = authenticated ? address : null;
    const load = () => fetchBtcQuote(priceUsdcAtomic)
      .then((value) => { if (actif) setQuote({ owner, value }); })
      .catch(() => { if (actif) setQuote({ owner, value: null }); });
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => { actif = false; clearInterval(timer); };
  }, [authenticated, address, priceUsdcAtomic, txHash]);

  const current = quote.owner === (authenticated ? address : null) ? quote.value : null;
  if (!current) return null;
  const notEnoughBtc = current.btcBalance !== null && BigInt(current.btcBalance) <= BigInt(current.btcIn);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      setTxHash(await borrowDatasetWithBtc({ datasetId, priceUsdcAtomic }));
      onPaid();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-accent/40 bg-surface p-4">
      <p className="text-sm font-medium">{t("Payer en BTC")}</p>
      <p className="mt-1 text-xs text-muted">
        {t("Environ {btc} BTC, échangés en MUSD sur le pool BTC/MUSD de Mezo Pools et verrouillés dans l’escrow, en une seule transaction.", { btc: btc(current.btcIn) })}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <dt className="text-muted">{t("Cours de l’oracle")}</dt><dd className="font-mono">{musd(current.oraclePrice)} MUSD/BTC</dd>
        <dt className="text-muted">{t("Reste dans ton wallet")}</dt><dd className="font-mono">≈ {musd(current.leftoverMusd)} MUSD</dd>
      </dl>
      <button
        type="button"
        onClick={() => void pay()}
        disabled={busy || disabled || !authenticated || notEnoughBtc}
        className="mt-3 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-accent/90 disabled:opacity-50"
      >
        {busy ? t("Paiement en cours…") : t("Payer {btc} BTC", { btc: btc(current.btcIn) })}
      </button>
      {!authenticated && <p className="mt-2 text-xs text-muted">{t("Connecte ton wallet pour payer en BTC.")}</p>}
      {notEnoughBtc && <p className="mt-2 text-xs text-negative">{t("Solde BTC insuffisant pour ce paiement et son gas.")}</p>}
      <p className="mt-2 text-xs text-muted">
        {t("Deux signatures puis une transaction. Le swap est refusé s’il rend moins que le prix, ou plus de 3 % sous l’oracle BTC/USD de Mezo.")}
      </p>
      {txHash && (
        <p role="status" className="mt-2 text-xs">
          {t("Payé en BTC :")}{" "}
          <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" className="font-mono text-accent underline underline-offset-2">
            {txHash.slice(0, 10)}…
          </a>
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-negative">{t(error)}</p>}
    </div>
  );
}
