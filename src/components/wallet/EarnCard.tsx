"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { Card } from "@/components/ui/Card";
import { CardTitle } from "@/components/ui/Heading";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { messageOf } from "@/lib/errors-client";
import { addressExplorerUrl } from "@/lib/evm/explorer";
import { resolveClientNetwork } from "@/lib/evm/networks";
import { getExternalWallet } from "@/lib/wallet/manager";
import { sendActiveTransaction } from "@/lib/wallet/transaction-client";
import { useWalletStore } from "@/stores/wallet";

/**
 * « Mets ton MUSD au travail sur Mezo » : dépôt des gains d'un fournisseur (ou de tout
 * MUSD du wallet) dans le Stability Pool MUSD ou le coffre d'épargne sMUSD, et retour.
 *
 * Le serveur ne signe rien : il rend la position et les transactions à envoyer (approbation
 * puis action), que le wallet signe l'une après l'autre. Les montants sont honnêtes : aucun
 * rendement annoncé, seulement ce que les contrats rendent (dépôt, gain BTC, sMUSD,
 * rendement réclamable).
 */

type Venue = { available: true; deposit?: string; collateralGain?: string; shares?: string; claimableYield?: string; totalDeposits?: string; totalSupply?: string }
  | { available: false; reason: string };

interface EarnResponse {
  position: { musdBalance: string; stabilityPool: Venue; savings: Venue };
  venues: { stabilityPool: string; savingsVault: string };
  transactions: { label: string; transaction: Record<string, unknown> }[];
  error?: string;
}

const DECIMALS = 18;
const NETWORK = resolveClientNetwork();

function fmt(value: string | undefined, digits = 4): string {
  if (value === undefined) return "—";
  const amount = Number(formatUnits(BigInt(value), DECIMALS));
  return amount.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function EarnCard({ guideAnchor }: { guideAnchor?: string }) {
  const { t } = useLocale();
  const authenticated = useWalletStore((s) => s.authenticated);
  const [identity] = useState(() => ({ revision: useWalletStore.getState().revision, provider: getExternalWallet() }));
  const [data, setData] = useState<EarnResponse | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [amounts, setAmounts] = useState({ sp: "", savings: "" });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (!authenticated) { setData(undefined); return; }
    try {
      const response = await fetch("/api/wallet/earn", { cache: "no-store" });
      if (response.status === 404) { if (mounted.current) setData(null); return; }
      const body = await response.json() as EarnResponse;
      if (!response.ok) throw new Error(body.error ?? "Position MUSD indisponible");
      if (mounted.current) setData(body);
    } catch (err) {
      if (mounted.current) setError(messageOf(err));
    }
  }, [authenticated]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  async function run(action: string, amount?: string) {
    if (busy) return;
    const assertCurrent = () => {
      if (!mounted.current || identity.provider !== getExternalWallet() || identity.revision !== useWalletStore.getState().revision) {
        throw new Error("Le wallet a changé. Relance l’opération.");
      }
    };
    setBusy(action);
    setError(null);
    try {
      const atomic = amount ? parseUnits(amount, DECIMALS).toString() : "";
      const query = `/api/wallet/earn?action=${encodeURIComponent(action)}${atomic ? `&amount=${atomic}` : ""}`;
      const response = await fetch(query, { cache: "no-store" });
      const body = await response.json() as EarnResponse;
      if (!response.ok) throw new Error(body.error ?? "Transaction indisponible");
      for (const step of body.transactions) {
        await sendActiveTransaction({ ...step.transaction, value: "0x0" }, { waitForConfirmation: true, assertCurrent });
      }
      setAmounts({ sp: "", savings: "" });
      await refresh();
    } catch (err) {
      if (mounted.current) setError(messageOf(err));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  if (!authenticated || data === null || data === undefined) return null;
  const { position, venues } = data;
  const sp = position.stabilityPool;
  const savings = position.savings;
  const input = "w-36 rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-sm";
  const primary = "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-background disabled:opacity-40";
  const secondary = "rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40";

  return (
    <Card data-guide={guideAnchor}>
      <div className="flex items-center justify-between gap-4">
        <CardTitle>{t("Mets ton MUSD au travail sur Mezo")}</CardTitle>
        <button onClick={() => void refresh()} disabled={Boolean(busy)} className="text-xs text-accent disabled:opacity-50">{t("Actualiser")}</button>
      </div>
      <p className="mt-2 text-xs text-muted">{t("Solde disponible : {amount} MUSD. Les gains réglés par l’escrow sont retirables ci-dessus, puis déposables ici.", { amount: fmt(position.musdBalance) })}</p>
      {error && <p role="alert" className="mt-3 text-sm text-negative">{t(error)}</p>}

      <div className="mt-4 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">{t("Stability Pool MUSD")}</p>
          <a href={addressExplorerUrl(NETWORK, venues.stabilityPool)} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent">{venues.stabilityPool.slice(0, 10)}…</a>
        </div>
        <p className="mt-1 text-xs text-muted">{t("Les dépôts absorbent les liquidations et reçoivent le BTC saisi en collatéral. Pas de récompense MEZO.")}</p>
        {sp.available ? (
          <>
            <p className="mt-2 text-xs">{t("Ton dépôt : {deposit} MUSD · gain BTC : {gain} BTC · total du pool : {total} MUSD", { deposit: fmt(sp.deposit), gain: fmt(sp.collateralGain, 6), total: fmt(sp.totalDeposits, 0) })}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input className={input} inputMode="decimal" placeholder="MUSD" value={amounts.sp} onChange={(e) => setAmounts((a) => ({ ...a, sp: e.target.value }))} />
              <button className={primary} disabled={Boolean(busy) || !amounts.sp} onClick={() => void run("provide", amounts.sp)}>{busy === "provide" ? t("Dépôt…") : t("Déposer")}</button>
              <button className={secondary} disabled={Boolean(busy) || !amounts.sp} onClick={() => void run("withdraw-sp", amounts.sp)}>{busy === "withdraw-sp" ? t("Retrait en cours…") : t("Retirer")}</button>
            </div>
          </>
        ) : <p className="mt-2 text-xs text-negative">{t(sp.reason)}</p>}
      </div>

      <div className="mt-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">{t("Épargne sMUSD")}</p>
          <a href={addressExplorerUrl(NETWORK, venues.savingsVault)} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent">{venues.savingsVault.slice(0, 10)}…</a>
        </div>
        <p className="mt-1 text-xs text-muted">{t("Reçu d’épargne 1:1 en sMUSD ; le rendement vient des frais du protocole MUSD.")}</p>
        {savings.available ? (
          <>
            <p className="mt-2 text-xs">{t("Ton solde : {shares} sMUSD · rendement réclamable : {yield} MUSD", { shares: fmt(savings.shares), yield: fmt(savings.claimableYield, 6) })}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input className={input} inputMode="decimal" placeholder="MUSD" value={amounts.savings} onChange={(e) => setAmounts((a) => ({ ...a, savings: e.target.value }))} />
              <button className={primary} disabled={Boolean(busy) || !amounts.savings} onClick={() => void run("deposit-savings", amounts.savings)}>{busy === "deposit-savings" ? t("Dépôt…") : t("Déposer")}</button>
              <button className={secondary} disabled={Boolean(busy) || !amounts.savings} onClick={() => void run("withdraw-savings", amounts.savings)}>{busy === "withdraw-savings" ? t("Retrait en cours…") : t("Retirer")}</button>
              <button className={secondary} disabled={Boolean(busy)} onClick={() => void run("claim-yield")}>{busy === "claim-yield" ? t("Réclamation…") : t("Réclamer le rendement")}</button>
            </div>
          </>
        ) : <p className="mt-2 text-xs text-negative">{t(savings.reason)}</p>}
      </div>
    </Card>
  );
}
