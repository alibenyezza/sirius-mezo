import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createPublicClient, formatUnits, http, parseAbi, type Address, type PublicClient } from "viem";
import { siriusescrowAbi } from "@/lib/evm/abi/siriusescrow";
import { getPublicClient } from "@/lib/evm/client";
import { EVM_CHAINS, resolveServerNetwork } from "@/lib/evm/networks";
import {
  contractSourceUrl,
  demoTransactions,
  explorerApiBase,
  readDeploymentManifest,
  type DemoTransactionKey,
  type DeploymentManifest,
  type ManifestContractKey,
} from "@/lib/sirius/deployment-manifest";
import { LegalLinks } from "@/components/layout/LegalLinks";

/**
 * Preuve on-chain du protocole, publique et sans session.
 *
 * Un juge ou un partenaire doit pouvoir, en deux minutes, rapprocher ce que Sirius affirme
 * de ce qui est réellement sur Mezo testnet : contrats déployés et vérifiés, comptabilité
 * de l'escrow lue en direct, cycle de règlement rejoué avec ses transactions, adresses des
 * trois rôles. Chaque affirmation renvoie vers l'explorateur ; rien ici ne demande un compte
 * ni la base de données.
 *
 * Sources : le manifeste `deployments/mezo-testnet.json` (adresses, transactions, preuves
 * ajoutées au fil des vagues) et la chaîne elle-même (`accounting()`, `MIN_AMOUNT()`,
 * symbole et décimales du jeton). Si le RPC ne répond pas, la page se rend quand même et
 * dit « unavailable » : l'explorateur reste la source que le lecteur peut ouvrir.
 *
 * Textes en anglais, comme `/status` et `/proof/[id]`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "On-chain proof · Sirius",
  description:
    "Verified contracts, live escrow accounting and the settlement cycle replayed on Mezo testnet, every claim linked to the explorer. No account required.",
};

const tokenAbi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);

interface LiveEscrow {
  locked: bigint;
  owed: bigint;
  balance: bigint;
  seq: bigint;
  minAmount: bigint;
  token: Address;
  lockAuthorizer: Address;
  version: string;
}

interface LiveToken {
  symbol: string;
  decimals: number;
}

/**
 * Client du réseau décrit par le manifeste. Le client partagé suit `EVM_NETWORK` ; si
 * l'instance tourne sur un autre réseau, la page lit quand même le testnet du manifeste
 * avec un client dédié plutôt que d'interroger de mauvaises adresses.
 */
function manifestClient(manifest: DeploymentManifest): PublicClient | null {
  const { chain } = resolveServerNetwork();
  if (chain.id === manifest.chainId) return getPublicClient();
  const target = Object.values(EVM_CHAINS).find((candidate) => candidate.id === manifest.chainId);
  if (!target) return null;
  return createPublicClient({ chain: target, transport: http(undefined, { timeout: 10_000 }) }) as PublicClient;
}

async function readLiveEscrow(manifest: DeploymentManifest): Promise<LiveEscrow | null> {
  try {
    const client = manifestClient(manifest);
    if (!client) return null;
    const escrow = { address: manifest.contracts.escrow as Address, abi: siriusescrowAbi } as const;
    const [accounting, minAmount, token, lockAuthorizer, version] = await Promise.all([
      client.readContract({ ...escrow, functionName: "accounting" }),
      client.readContract({ ...escrow, functionName: "MIN_AMOUNT" }),
      client.readContract({ ...escrow, functionName: "usdc" }),
      client.readContract({ ...escrow, functionName: "lockAuthorizer" }),
      client.readContract({ ...escrow, functionName: "VERSION" }),
    ]);
    const [locked, owed, balance, seq] = accounting;
    return { locked, owed, balance, seq, minAmount, token, lockAuthorizer, version };
  } catch {
    return null;
  }
}

async function readLiveToken(manifest: DeploymentManifest): Promise<LiveToken | null> {
  try {
    const client = manifestClient(manifest);
    if (!client) return null;
    const token = { address: manifest.settlementToken.address as Address, abi: tokenAbi } as const;
    const [symbol, decimals] = await Promise.all([
      client.readContract({ ...token, functionName: "symbol" }),
      client.readContract({ ...token, functionName: "decimals" }),
    ]);
    return { symbol, decimals };
  } catch {
    return null;
  }
}

/**
 * Statut de vérification des sources : le manifeste fait foi s'il le déclare ; sinon
 * l'API Blockscout est interrogée (mise en cache cinq minutes). Toute erreur vaut
 * « pas encore vérifié » : la page n'affirme une vérification que si elle l'a vue.
 */
async function sourceVerified(manifest: DeploymentManifest, key: ManifestContractKey): Promise<boolean> {
  const declared = manifest.verification?.contracts[key];
  if (declared) return declared.verified;
  try {
    const response = await fetch(`${explorerApiBase(manifest.explorer)}/api/v2/smart-contracts/${manifest.contracts[key]}`, {
      next: { revalidate: 300 },
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { is_verified?: unknown };
    return body.is_verified === true;
  } catch {
    return false;
  }
}

function txUrl(manifest: DeploymentManifest, hash: string): string {
  return `${manifest.explorer}/tx/${encodeURIComponent(hash)}`;
}

function addressUrl(manifest: DeploymentManifest, address: string): string {
  return `${manifest.explorer}/address/${encodeURIComponent(address)}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function formatAmount(value: bigint, decimals: number, symbol: string): string {
  return `${formatUnits(value, decimals)} ${symbol}`;
}

const CONTRACTS: Array<{ key: ManifestContractKey; label: string }> = [
  { key: "escrow", label: "Escrow" },
  { key: "datasets", label: "Dataset registry" },
  { key: "kyb", label: "KYB registry" },
];

/** Une ligne par transaction du cycle : ce qu'elle fait et qui l'envoie. */
const DEMO_STEPS: Record<DemoTransactionKey, { title: string; explain: (amount: string) => string }> = {
  mint: {
    title: "Mint the dataset title",
    explain: () => "The provider mints a soulbound title in the dataset registry: dataset id, Merkle root, row count and locked training profile.",
  },
  approve: {
    title: "Approve the escrow",
    explain: (amount) => `The borrower lets the escrow pull ${amount} from its MUSD balance. No funds move yet.`,
  },
  lock: {
    title: "Lock the payment",
    explain: (amount) =>
      `The borrower locks ${amount} for this dataset and profile, with a lock authorization signed by the settlement account. The escrow now holds the funds.`,
  },
  release: {
    title: "Release on delivery",
    explain: () => "The hashlock preimage is revealed on-chain: the loan settles and the amount becomes owed to the provider.",
  },
  withdrawFor: {
    title: "Withdraw for the provider",
    explain: (amount) => `The owed ${amount} leaves the escrow to the provider's wallet. Locked and owed return to zero for this loan.`,
  },
};

function Row({ label, value, href, mono = false }: { label: string; value: string; href?: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="shrink-0 text-xs uppercase tracking-wider text-muted sm:w-52">{label}</dt>
      <dd className={`min-w-0 wrap-anywhere text-sm ${mono ? "font-mono" : ""}`}>
        {href ? <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:text-accent/80">{value} ↗</a> : value}
      </dd>
    </div>
  );
}

function Badge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-block rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-xs uppercase tracking-wider text-emerald-400">
      Verified source
    </span>
  ) : (
    <span className="inline-block rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-xs uppercase tracking-wider text-amber-400">
      Verification pending
    </span>
  );
}

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:text-accent/80">
      {children}
    </a>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function ProtocolProofPage() {
  const manifest = readDeploymentManifest();
  const chain = Object.values(EVM_CHAINS).find((candidate) => candidate.id === manifest.chainId);
  const rpcUrl = chain?.rpcUrls.default.http[0] ?? "unavailable";

  const [escrow, token, ...verified] = await Promise.all([
    readLiveEscrow(manifest),
    readLiveToken(manifest),
    ...CONTRACTS.map(({ key }) => sourceVerified(manifest, key)),
  ]);

  const symbol = token?.symbol ?? manifest.settlementToken.symbol;
  const decimals = token?.decimals ?? manifest.settlementToken.decimals;
  const amount = (value: bigint) => formatAmount(value, decimals, symbol);
  const solvent = escrow ? escrow.balance >= escrow.locked + escrow.owed : null;

  const demo = manifest.demo;
  const demoAmount = demo ? `${demo.amountMusd} ${manifest.settlementToken.symbol}` : "";
  const steps = demoTransactions(manifest);
  const previous = manifest.previous ?? [];
  const features = manifest.contracts.escrowFeatures ?? [];
  const evidence = manifest.evidence ?? [];

  return (
    <main className="relative z-10 mx-auto w-full max-w-2xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.11em] text-muted">On-chain proof</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Sirius on Mezo testnet</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">
        Everything Sirius claims about its deployment is listed here against what is on-chain. Every address and
        transaction links to the Mezo explorer; the accounting figures are read from the escrow contract at the time
        of this request. Nothing on this page needs an account.
      </p>

      <Section title="Network">
        <dl className="mt-3 rounded-xl border border-border bg-surface px-5 py-1">
          <Row label="Network" value={`${chain?.name ?? manifest.network} (chain ${manifest.chainId})`} />
          <Row label="RPC" value={rpcUrl} mono />
          <Row label="Explorer" value={manifest.explorer} href={manifest.explorer} mono />
          <Row label="Gas asset" value="BTC (native)" />
          <Row
            label="Settlement token"
            value={manifest.settlementToken.address}
            href={addressUrl(manifest, manifest.settlementToken.address)}
            mono
          />
          <Row
            label="Symbol / decimals"
            value={token ? `${token.symbol} / ${token.decimals} (read live)` : `${manifest.settlementToken.symbol} / ${manifest.settlementToken.decimals} (manifest; live read unavailable)`}
          />
        </dl>
      </Section>

      <Section title="Contracts (current deployment)">
        <p className="mt-2 max-w-prose text-sm text-muted">
          Deployed on {formatDate(manifest.deployedAt)} by{" "}
          <External href={addressUrl(manifest, manifest.deployer)}>
            <span className="font-mono">{manifest.deployer}</span>
          </External>
          . Escrow version {escrow?.version ?? manifest.contracts.escrowVersion ?? "unknown"}
          {escrow && manifest.contracts.escrowVersion && escrow.version !== manifest.contracts.escrowVersion
            ? ` (manifest says ${manifest.contracts.escrowVersion})`
            : ""}
          . KYB mode: {manifest.contracts.kybMode ?? "unknown"}.
          {manifest.verification?.verifiedAt ? ` Sources verified on ${formatDate(manifest.verification.verifiedAt)}.` : ""}
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {CONTRACTS.map(({ key, label }, index) => (
            <dl key={key} className="rounded-xl border border-border bg-surface px-5 py-1">
              <Row label="Contract" value={label} />
              <Row label="Address" value={manifest.contracts[key]} href={addressUrl(manifest, manifest.contracts[key])} mono />
              {key === "escrow" && features.length > 0 && <Row label="Features" value={features.join(", ")} mono />}
              <div className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-6">
                <dt className="shrink-0 text-xs uppercase tracking-wider text-muted sm:w-52">Source</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-3 text-sm">
                  <Badge verified={verified[index] === true} />
                  <External href={contractSourceUrl(manifest, key)}>Source on explorer ↗</External>
                </dd>
              </div>
            </dl>
          ))}
        </div>
      </Section>

      <Section title="Live escrow accounting">
        <p className="mt-2 max-w-prose text-sm text-muted">
          Read from <code className="font-mono">accounting()</code> and <code className="font-mono">MIN_AMOUNT()</code> on
          the escrow at request time. The solvency invariant is balance ≥ locked + owed: the token the escrow actually
          holds must always cover what it owes.
        </p>
        <dl className="mt-3 rounded-xl border border-border bg-surface px-5 py-1">
          {escrow ? (
            <>
              <Row label="Locked" value={amount(escrow.locked)} mono />
              <Row label="Owed" value={amount(escrow.owed)} mono />
              <Row label="Token balance held" value={amount(escrow.balance)} mono />
              <Row label="Event sequence" value={escrow.seq.toString()} mono />
              <Row label="Minimum amount" value={amount(escrow.minAmount)} mono />
              <Row
                label="Solvency invariant"
                value={solvent ? "Holds: balance ≥ locked + owed" : "Broken: balance < locked + owed"}
              />
              <Row label="Token (on-chain)" value={escrow.token} href={addressUrl(manifest, escrow.token)} mono />
              <Row label="Lock authorizer (on-chain)" value={escrow.lockAuthorizer} href={addressUrl(manifest, escrow.lockAuthorizer)} mono />
            </>
          ) : (
            <Row label="Status" value="unavailable — the RPC did not answer; the explorer links above still hold" />
          )}
        </dl>
      </Section>

      {demo && (
        <Section title="Settlement cycle replayed on testnet">
          <p className="mt-2 max-w-prose text-sm text-muted">
            One complete loan of {demoAmount} on the dataset <span className="font-mono">{demo.datasetId}</span>, played by
            the smoke script against the contracts above. Three roles, three wallets:
          </p>
          <dl className="mt-3 rounded-xl border border-border bg-surface px-5 py-1">
            <Row label="Borrower" value={demo.borrower} href={addressUrl(manifest, demo.borrower)} mono />
            <Row label="Provider" value={demo.provider} href={addressUrl(manifest, demo.provider)} mono />
            <Row label="Deployer" value={manifest.deployer} href={addressUrl(manifest, manifest.deployer)} mono />
            <Row label="Lock authorizer" value={manifest.lockAuthorizer} href={addressUrl(manifest, manifest.lockAuthorizer)} mono />
          </dl>
          <p className="mt-2 max-w-prose text-xs text-muted">
            The borrower is the application settlement account, which is also the lock authorizer: it signs the lock
            authorization, pays the gas and locks the {manifest.settlementToken.symbol}. The provider is a throwaway demo
            account that owns the dataset title and receives the payment. The deployer published the contracts and funded
            both.
          </p>
          <ol className="mt-4 flex flex-col gap-3">
            {steps.map(({ key, hash }, index) => (
              <li key={key} className="rounded-xl border border-border bg-surface px-5 py-4">
                <p className="text-sm font-medium">
                  <span className="text-muted">{index + 1}.</span> {DEMO_STEPS[key].title}
                </p>
                <p className="mt-1 max-w-prose text-sm text-muted">{DEMO_STEPS[key].explain(demoAmount)}</p>
                <p className="mt-2 wrap-anywhere font-mono text-xs">
                  <External href={txUrl(manifest, hash)}>{hash} ↗</External>
                </p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {previous.length > 0 && (
        <Section title={previous.length === 1 ? "Previous deployment" : "Previous deployments"}>
          <p className="mt-2 max-w-prose text-sm text-muted">
            Earlier trios of contracts ran the same cycle. Each was replaced when the escrow gained a feature or the lock
            authorizer changed; the escrow is immutable and the dataset registry binds one escrow only. Their transactions
            remain valid proof of the flow, and credits left on an old escrow stay withdrawable.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {previous.map((entry, index) => {
              // L'entrée i a été remplacée par l'entrée i-1, la première par le déploiement courant.
              const supersededOn = index === 0 ? manifest.deployedAt : previous[index - 1].deployedAt;
              const transactions = entry.transactions ?? {};
              const txRows: Array<{ key: DemoTransactionKey; label: string }> = [
                { key: "mint", label: "Mint" },
                { key: "approve", label: "Approve" },
                { key: "lock", label: "Lock" },
                { key: "release", label: "Release" },
                { key: "withdrawFor", label: "Withdraw" },
              ];
              return (
                <details key={entry.escrow} className="rounded-xl border border-border bg-surface px-5 py-3">
                  <summary className="cursor-pointer text-sm text-muted">
                    {entry.deployedAt ? `Deployed on ${formatDate(entry.deployedAt)}, ` : ""}
                    {supersededOn ? `superseded on ${formatDate(supersededOn)}` : "superseded"}
                    {entry.escrowVersion ? ` — escrow ${entry.escrowVersion}` : ""} — shown so older addresses can be recognised
                  </summary>
                  <dl className="mt-3 px-0 py-1">
                    <Row label="Escrow" value={entry.escrow} href={addressUrl(manifest, entry.escrow)} mono />
                    {entry.escrowFeatures && entry.escrowFeatures.length > 0 && <Row label="Features" value={entry.escrowFeatures.join(", ")} mono />}
                    <Row label="Dataset registry" value={entry.datasets} href={addressUrl(manifest, entry.datasets)} mono />
                    <Row label="KYB registry" value={entry.kyb} href={addressUrl(manifest, entry.kyb)} mono />
                    {entry.lockAuthorizer && (
                      <Row label="Lock authorizer" value={entry.lockAuthorizer} href={addressUrl(manifest, entry.lockAuthorizer)} mono />
                    )}
                    {txRows.map(({ key, label }) => {
                      const hash = transactions[key];
                      return hash ? <Row key={key} label={label} value={hash} href={txUrl(manifest, hash)} mono /> : null;
                    })}
                  </dl>
                </details>
              );
            })}
          </div>
        </Section>
      )}

      {evidence.length > 0 && (
        <Section title="Evidence">
          <dl className="mt-3 rounded-xl border border-border bg-surface px-5 py-1">
            {evidence.map((item, index) => (
              <div key={`${item.kind}-${item.value}-${index}`} className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-6">
                <dt className="shrink-0 text-xs uppercase tracking-wider text-muted sm:w-52">
                  {item.label}
                  {item.date ? <span className="block normal-case tracking-normal">{formatDate(item.date)}</span> : null}
                </dt>
                <dd className="min-w-0 wrap-anywhere text-sm">
                  <External href={item.kind === "tx" ? txUrl(manifest, item.value) : addressUrl(manifest, item.value)}>
                    <span className="font-mono">{item.value}</span> ↗
                  </External>
                  {item.note ? <span className="mt-1 block text-muted">{item.note}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      <Section title="Reproduce it">
        <p className="mt-2 max-w-prose text-sm text-muted">
          With a funded testnet key in <span className="font-mono">.env.local</span>, one command replays the whole cycle
          on the contracts above and prints each transaction hash:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface px-5 py-3 font-mono text-xs">
          node --import tsx scripts/mezo-testnet.ts --smoke
        </pre>
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          <li>
            <External href="https://github.com/alibenyezza/sirius-mezo">Source code on GitHub ↗</External>
          </li>
          <li>
            <Link href="/status" className="text-accent hover:text-accent/80">Protocol status</Link>
            <span className="text-muted"> — the configuration this instance is running with.</span>
          </li>
          <li>
            <Link href="/docs/mcp" className="text-accent hover:text-accent/80">MCP documentation</Link>
            <span className="text-muted"> — the assistant endpoint at </span>
            <Link href="/api/mcp" className="font-mono text-accent hover:text-accent/80">/api/mcp</Link>
            <span className="text-muted"> exposes the same protocol status to agents.</span>
          </li>
        </ul>
      </Section>

      <footer className="mt-12 border-t border-border pt-4">
        <LegalLinks />
      </footer>
    </main>
  );
}
