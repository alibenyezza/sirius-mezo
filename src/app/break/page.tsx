import Link from "next/link";
import type { Metadata } from "next";
import { LegalLinks } from "@/components/layout/LegalLinks";
import { runAttacks, ATTACKER, type AttackReport, type AttackResult } from "@/lib/proof/attacks";

/**
 * « Try to break it » : attaques rejouées en direct contre les contrats Sirius déployés.
 *
 * Chaque requête refait toutes les simulations sur le dernier bloc de Mezo testnet, depuis
 * une adresse d'attaquant sans clé : rien n'est signé ni envoyé. La page montre l'erreur que
 * le contrat a renvoyée, mot pour mot, avec le lien vers son code vérifié. Publique, sans
 * compte. Textes en anglais, comme `/proof` et `/status`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Try to break it · Sirius",
  description:
    "Live attacks replayed against the Sirius contracts on Mezo testnet: forged signatures, early refunds, double releases, rogue escrows. Each one is refused by the contract itself.",
};

const EXPLORER = "https://explorer.test.mezo.org";

function Outcome({ result }: { result: AttackResult }) {
  const { outcome } = result;
  if (outcome.status === "refused") {
    return (
      <span className="inline-flex items-center gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-400">
        Refused · <code className="font-mono">{outcome.error}</code>
      </span>
    );
  }
  if (outcome.status === "accepted") {
    return (
      <span className="inline-flex items-center rounded-md border border-red-400/40 bg-red-400/10 px-2 py-0.5 text-xs text-red-400">
        Accepted: the contract did not refuse this call
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted">
      Not run · {outcome.reason}
    </span>
  );
}

async function report(): Promise<AttackReport | null> {
  try {
    return await runAttacks();
  } catch {
    return null;
  }
}

export default async function BreakPage() {
  const result = await report();
  const refused = result?.results.filter((r) => r.outcome.status === "refused").length ?? 0;
  const ran = result?.results.filter((r) => r.outcome.status !== "unavailable").length ?? 0;

  return (
    <main className="relative z-10 mx-auto w-full max-w-2xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.11em] text-muted">Try to break it</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Every attack, replayed live on Mezo testnet</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">
        Each row below is a real call to the deployed contracts, simulated on the latest block from an attacker address
        that has no key (<code className="font-mono">{ATTACKER}</code>). Nothing is signed or sent, no gas is spent. What
        you read is the error the contract returned. Reload the page to run them again.
      </p>

      {result ? (
        <>
          <p className="mt-6 rounded-xl border border-border bg-surface px-5 py-3 text-sm">
            <span className="font-semibold">{refused} of {ran}</span> attacks refused by the contracts · block{" "}
            <a href={`${EXPLORER}/block/${result.block}`} target="_blank" rel="noreferrer" className="font-mono text-accent hover:text-accent/80">
              {result.block} ↗
            </a>{" "}
            · {result.checkedAt.replace("T", " ").slice(0, 19)} UTC
          </p>
          <ol className="mt-6 space-y-3">
            {result.results.map((attack) => (
              <li key={attack.id} className="rounded-xl border border-border bg-surface px-5 py-4">
                <p className="text-sm font-medium">{attack.title}</p>
                <p className="mt-1 text-xs text-muted">{attack.attempt}</p>
                <p className="mt-2 text-xs">
                  <a href={`${EXPLORER}/address/${attack.address}?tab=contract`} target="_blank" rel="noreferrer" className="text-accent hover:text-accent/80">
                    {attack.contract} ↗
                  </a>{" "}
                  <code className="font-mono text-muted">{attack.call}</code>
                </p>
                <div className="mt-2"><Outcome result={attack} /></div>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="mt-6 rounded-xl border border-border bg-surface px-5 py-3 text-sm text-muted">
          The Mezo RPC did not answer. Reload the page in a moment.
        </p>
      )}

      <p className="mt-8 text-xs text-muted">
        The same checks run in the contract test suite on every change. See the deployment and its verified sources on{" "}
        <Link href="/proof" className="text-accent hover:text-accent/80">/proof</Link>, or try a real purchase on{" "}
        <Link href="/try" className="text-accent hover:text-accent/80">/try</Link>.
      </p>
      <LegalLinks />
    </main>
  );
}
