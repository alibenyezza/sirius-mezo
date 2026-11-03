import Link from "next/link";
import type { Metadata } from "next";
import { MAINNET_STABLECOIN_NAME } from "@/lib/evm/stablecoin";
import { addressExplorerUrl } from "@/lib/evm/explorer";
import { readProtocolStatus } from "@/lib/sirius/protocol-status";
import { mezoFeatures } from "@/lib/mezo/features";
import { readPlatformFee } from "@/lib/mezo/platform-fee";
import { readDeploymentManifest, type DeploymentManifest } from "@/lib/sirius/deployment-manifest";
import { LegalLinks } from "@/components/layout/LegalLinks";

/**
 * État du protocole, public et sans session.
 *
 * Ce que Sirius promet doit pouvoir être comparé à ce qui tourne réellement : réseau,
 * contrats, mode de calcul, plafonds et statut de l'audit. La page lit la configuration du
 * serveur à chaque requête (`readProtocolStatus`, partagé avec l'outil de l'assistant) ; elle
 * n'affiche que des données publiques (adresses, plafonds), jamais une valeur secrète. Textes
 * en anglais, comme les autres pages serveur publiques.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Protocol status · Sirius",
  description: "What is live on Sirius: network, contracts, training runner, limits and audit status.",
};

function Row({ label, value, href, mono = false }: { label: string; value: string; href?: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="shrink-0 text-xs uppercase tracking-wider text-muted sm:w-52">{label}</dt>
      <dd className={`min-w-0 wrap-anywhere text-sm ${mono ? "font-mono" : ""}`}>
        {href ? <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:text-accent/80">{value}</a> : value}
      </dd>
    </div>
  );
}

function manifestOrNull(): DeploymentManifest | null {
  try {
    return readDeploymentManifest();
  } catch {
    return null;
  }
}

const pct = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} %`;

export default async function StatusPage() {
  // « MUSD » sur mainnet, « test MUSD » sur testnet : la page est en anglais, sans t().
  const { network, chain, mainnet, symbol, confidentialCompute, settlement, externalAudit, limits, contracts, mezo } = readProtocolStatus();
  const features = mezoFeatures();
  const fee = await readPlatformFee().catch(() => null);
  const manifest = manifestOrNull();
  const onOff = (on: boolean) => (on ? "On" : "Off on this instance");

  return (
    <main className="relative z-10 mx-auto w-full max-w-2xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.11em] text-muted">Protocol status</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{mainnet ? "Mainnet beta" : "Testnet"}</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">
        {mainnet
          ? `Sirius runs on Mezo mainnet with real ${symbol} (${MAINNET_STABLECOIN_NAME}, issued by the Mezo protocol), in a limited beta: loans are capped, access requires an instant on-chain verification of your wallet, and the contracts have not been externally audited yet.`
          : "This instance runs on Mezo testnet. Tokens have no value; use it to try the full flow."}
      </p>

      <dl className="mt-8 rounded-xl border border-border bg-surface px-5 py-1">
        <Row label="Network" value={`${chain.name} (chain ${chain.id})`} />
        <Row label="Training" value={confidentialCompute} />
        <Row label="Settlement" value={settlement} />
        <Row label="External audit" value={externalAudit} />
        {mainnet && <Row label="Per-loan limit" value={limits.perLoan ?? "Not configured"} />}
        {mainnet && <Row label="Total exposure limit" value={limits.totalExposure ?? "Not configured"} />}
        {mainnet && <Row label="Access" value="Open, with instant on-chain wallet verification" />}
      </dl>

      <h2 className="mt-10 text-lg font-semibold">Contracts</h2>
      <dl className="mt-3 rounded-xl border border-border bg-surface px-5 py-1">
        {contracts.map(({ label, address }) => address
          ? <Row key={label} label={label} value={address} href={addressExplorerUrl(network, address)} mono />
          : <Row key={label} label={label} value="Not configured" />)}
      </dl>

      <h2 className="mt-10 text-lg font-semibold">Mezo integrations</h2>
      <dl className="mt-3 rounded-xl border border-border bg-surface px-5 py-1">
        <Row label="One-signature payment" value={onOff(features.gaslessLock)} />
        <Row label="Pay with BTC (Mezo Pools)" value={onOff(features.payWithBtc)} />
        <Row label="Borrow & Buy from a trove" value={onOff(features.borrowAndBuy)} />
        <Row label="Earnings to Stability Pool / sMUSD" value={onOff(features.earn)} />
        <Row
          label="Platform fee"
          value={fee
            ? fee.baseBps === 0
              ? "None on this escrow"
              : `${pct(fee.baseBps)} at release${fee.discountedBps !== null ? `, ${pct(fee.discountedBps)} for veMEZO holders` : ""}; half goes to veBTC voters as a MUSD gauge incentive`
            : "Unavailable (escrow not readable)"}
        />
        {manifest?.contracts.feeRouter && (
          <Row label="Fee router" value={manifest.contracts.feeRouter} href={addressExplorerUrl(network, manifest.contracts.feeRouter)} mono />
        )}
        {manifest?.contracts.checkout && (
          <Row label="BTC checkout" value={manifest.contracts.checkout} href={addressExplorerUrl(network, manifest.contracts.checkout)} mono />
        )}
      </dl>

      <h2 className="mt-10 text-lg font-semibold">MUSD yield venues</h2>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Mezo protocol contracts where idle MUSD can earn: the Stability Pool backs liquidations and pays depositors in BTC;
        the sMUSD savings vault pays yield in MUSD. Neither is operated by Sirius.
      </p>
      <dl className="mt-3 rounded-xl border border-border bg-surface px-5 py-1">
        <Row label="MUSD Stability Pool" value={mezo.stabilityPool} href={addressExplorerUrl(network, mezo.stabilityPool)} mono />
        <Row label="sMUSD savings vault" value={mezo.savingsVault} href={addressExplorerUrl(network, mezo.savingsVault)} mono />
      </dl>

      <p className="mt-3 max-w-prose text-sm text-muted">
        Verified sources, live escrow accounting and the settlement cycle replayed on testnet are on the{" "}
        <Link href="/proof" className="text-accent hover:text-accent/80">on-chain proof</Link> page.
      </p>

      <p className="mt-8 max-w-prose text-sm text-muted">
        Every loan leaves a receipt in the <Link href="/audit" className="text-accent hover:text-accent/80">audit ledger</Link>.
        {mainnet && <> Using the beta means accepting its <Link href="/terms" className="text-accent hover:text-accent/80">terms</Link>.</>}
      </p>

      <footer className="mt-12 border-t border-border pt-4">
        <LegalLinks />
      </footer>
    </main>
  );
}
