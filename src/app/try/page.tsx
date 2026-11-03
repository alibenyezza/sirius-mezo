import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { readDeploymentManifest } from "@/lib/sirius/deployment-manifest";
import { mezoFeatures } from "@/lib/mezo/features";
import { mezoPassportEnabled } from "@/lib/wallet/passport-flag";
import { LegalLinks } from "@/components/layout/LegalLinks";

/**
 * Parcours d'essai pour un juge ou un premier visiteur.
 *
 * Les juges du Buildathon notent d'abord ce qu'ils peuvent tester eux-mêmes. Cette page
 * enchaîne, dans l'ordre où ils dépendent les uns des autres, les gestes qui couvrent
 * l'intégration Mezo : réseau, fonds de test, paiement en une signature, paiement tiré
 * d'un trove, gains placés dans le Stability Pool ou sMUSD, preuve on-chain. Chaque étape
 * renvoie vers la page de l'application qui la réalise ; rien ici n'envoie de transaction.
 *
 * Les étapes suivent les interrupteurs de l'instance (`mezoFeatures`) : la page ne renvoie
 * jamais vers un bouton absent. Lit le manifeste (adresses du déploiement courant). Textes en anglais,
 * comme `/status` et `/proof`.
 */

export const metadata: Metadata = {
  title: "Try Sirius · Mezo testnet",
  description:
    "A five-minute path through Sirius on Mezo testnet: test funds, one-signature MUSD payment, paying from a Mezo trove, putting earnings to work, and the on-chain proof.",
};

const MEZO_TESTNET = {
  name: "Mezo Testnet",
  chainId: 31611,
  rpc: "https://rpc.test.mezo.org",
  explorer: "https://explorer.test.mezo.org",
  currency: "BTC",
};

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:text-accent/80">
      {children}
    </a>
  );
}

function Go({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="mt-3 inline-flex items-center rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:border-accent hover:text-accent"
    >
      {children} →
    </Link>
  );
}

function Step({ n, title, time, children }: { n: number; title: string; time: string; children: ReactNode }) {
  return (
    <li className="rounded-xl border border-border bg-surface px-5 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm font-medium">
          <span className="text-muted">{n}.</span> {title}
        </p>
        <span className="shrink-0 text-xs text-muted">{time}</span>
      </div>
      <div className="mt-1 max-w-prose text-sm text-muted">{children}</div>
    </li>
  );
}

export const dynamic = "force-dynamic";

type StepDef = { title: string; time: string; body: ReactNode };

export default function TryPage() {
  const manifest = readDeploymentManifest();
  const escrow = manifest.contracts.escrow;
  const features = mezoFeatures();
  const passport = mezoPassportEnabled();
  const signed = (manifest.evidence ?? []).find((entry) => /certificate/i.test(entry.label) && entry.kind === "tx");

  const steps: StepDef[] = [
    {
      title: "Add Mezo testnet to your wallet",
      time: "1 min",
      body: (
        <>
          <p>
            MetaMask or any EVM wallet.
            {passport
              ? " Bitcoin wallets (Unisat, OKX, Xverse) also connect through Mezo Passport, but the signature-based payments below need a wallet that signs typed data, so use MetaMask for those."
              : ""}
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
            <dt className="text-muted">Network</dt>
            <dd>{MEZO_TESTNET.name}</dd>
            <dt className="text-muted">Chain ID</dt>
            <dd>{MEZO_TESTNET.chainId}</dd>
            <dt className="text-muted">RPC</dt>
            <dd className="wrap-anywhere">{MEZO_TESTNET.rpc}</dd>
            <dt className="text-muted">Gas token</dt>
            <dd>{MEZO_TESTNET.currency}</dd>
          </dl>
        </>
      ),
    },
    {
      title: "Get test MUSD and BTC",
      time: "30 s",
      body: (
        <>
          <p>
            Connect, open the wallet page and press Add funds. The app sends 10 test MUSD and a little BTC for gas from
            its own reserve. For a Mezo trove, use the official faucet and open one on testnet.mezo.org.
          </p>
          <Go href="/wallet">Open the wallet</Go>
        </>
      ),
    },
    features.gaslessLock
      ? {
          title: "Buy a training run with one signature",
          time: "1 min",
          body: (
            <>
              <p>
                Pick a dataset and choose Pay with one signature. You sign a MUSD permit and the lock request; Sirius
                submits the escrow transaction and pays the BTC gas. No approve, no BTC needed on your side. The MUSD
                stays in the escrow until the model is delivered, and comes back to you after the deadline otherwise.
              </p>
              <Go href="/marketplace">Open the marketplace</Go>
            </>
          ),
        }
      : {
          title: "Buy a training run in MUSD",
          time: "1 min",
          body: (
            <>
              <p>
                Pick a dataset and press Borrow: approve MUSD, then lock it in the escrow. The MUSD stays there until
                the model is delivered, and comes back to you after the deadline otherwise.
              </p>
              <Go href="/marketplace">Open the marketplace</Go>
            </>
          ),
        },
  ];
  if (features.payWithBtc) {
    steps.push({
      title: "Or pay with BTC in one transaction",
      time: "1 min",
      body: (
        <>
          <p>
            The dataset page quotes the price in BTC. Pay with BTC swaps it to MUSD on the Mezo Pools BTC/MUSD pool,
            checks the rate against Mezo&apos;s BTC/USD oracle (at most 3 % below it), and locks the MUSD in the escrow,
            all in the same transaction. Any MUSD left over stays in your wallet.
          </p>
          <Go href="/marketplace">Pick a dataset</Go>
        </>
      ),
    });
  }
  if (features.borrowAndBuy) {
    steps.push({
      title: "Or pay from your Bitcoin trove",
      time: "2 min",
      body: (
        <>
          <p>
            With a Mezo trove and not enough MUSD, the dataset page offers to draw only the missing MUSD from your
            trove, through Mezo&apos;s BorrowerOperationsSignatures. It shows your debt and collateral ratio before and
            after, and refuses a draw that would leave the trove under 121 %, exceed its borrowing capacity, or break
            the Recovery Mode rules. Your BTC stays where it is.
          </p>
          <Go href="/marketplace">Pick a dataset</Go>
        </>
      ),
    });
  }
  steps.push({
    title: "Run the training and get the certificate",
    time: "1 min",
    body: (
      <>
        <p>
          On the Train page, press Run training on your loan. When the run completes, the escrow releases the MUSD to
          the provider, minus the platform fee (half of it goes to veBTC voters as a Mezo gauge incentive), and you get
          the model with a public certificate. The certificate checks, against the chain, that the result was signed by
          the key the escrow trusts.
        </p>
        <Go href="/train">Open the Train page</Go>
        {signed ? (
          <p className="mt-2 text-xs">
            Example: <External href={`${MEZO_TESTNET.explorer}/tx/${signed.value}`}>{signed.label} ↗</External>
          </p>
        ) : null}
      </>
    ),
  });
  if (features.earn) {
    steps.push({
      title: "Put provider earnings to work",
      time: "1 min",
      body: (
        <>
          <p>
            On the wallet page, earned MUSD can go into Mezo&apos;s Stability Pool or the sMUSD savings vault, and come
            back. Positions are read live from the Mezo contracts.
          </p>
          <Go href="/wallet">Earnings on the wallet page</Go>
        </>
      ),
    });
  }
  steps.push(
    {
      title: "Check it on-chain",
      time: "1 min",
      body: (
        <>
          <p>
            Every contract is source-verified, the escrow accounting is read live, and each transaction links to the
            explorer. Current escrow: <span className="wrap-anywhere font-mono text-xs">{escrow}</span>
          </p>
          <Go href="/proof">See the on-chain proof</Go>
        </>
      ),
    },
    {
      title: "Try to break it",
      time: "30 s",
      body: (
        <>
          <p>
            Forged signatures, early refunds, double releases, a rogue escrow: each attack is replayed live against the
            deployed contracts, and the page shows the error each contract returned.
          </p>
          <Go href="/break">Run the attacks</Go>
        </>
      ),
    },
  );

  return (
    <main className="relative z-10 mx-auto w-full max-w-2xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.11em] text-muted">Try it</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Sirius in five minutes</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">
        Sirius is a data marketplace where buyers pay in MUSD for a training run on a private dataset. This path walks
        through every place Mezo is part of the flow. Everything runs on Mezo testnet: the tokens have no value, and the
        app gives you what you need to start.
      </p>
      <p className="mt-3 text-xs text-muted">Mezo Buildathon · Track 1 (DeFi) and Track 2 (Access and Distribution)</p>

      <ol className="mt-8 flex flex-col gap-3">
        {steps.map((step, index) => (
          <Step key={step.title} n={index + 1} title={step.title} time={step.time}>
            {step.body}
          </Step>
        ))}
      </ol>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Something did not work?</h2>
        <p className="mt-2 max-w-prose text-sm text-muted">
          The protocol status page says what this instance runs with. The code and the procedures are public.
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          <li>
            <Link href="/status" className="text-accent hover:text-accent/80">Protocol status</Link>
          </li>
          <li>
            <External href="https://github.com/alibenyezza/sirius-mezo">Source code on GitHub ↗</External>
          </li>
          <li>
            <External href={`${MEZO_TESTNET.explorer}/address/${escrow}`}>Escrow on the Mezo explorer ↗</External>
          </li>
        </ul>
      </section>

      <footer className="mt-12 border-t border-border pt-4">
        <LegalLinks />
      </footer>
    </main>
  );
}
