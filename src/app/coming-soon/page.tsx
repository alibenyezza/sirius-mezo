import type { Metadata } from "next";
import { LegalLinks } from "@/components/layout/LegalLinks";

/**
 * Page d'attente du passage mainnet.
 *
 * Servie au public par réécriture tant que la porte d'aperçu est fermée
 * (src/lib/preview-gate/gate.ts, src/proxy.ts). Composant serveur sans aucun script de
 * portefeuille : le proxy signale la page à la mise en page racine, qui la rend nue. Texte en
 * anglais, fond sombre du site, lisible à 360 px. Noindex : elle ne doit laisser aucune trace
 * dans les moteurs de recherche une fois le site ouvert.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Something's cooking · Sirius",
  description: "Sirius is going live on Mezo mainnet very soon.",
  robots: { index: false, follow: false, nocache: true },
};

export default function ComingSoonPage() {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-xs uppercase tracking-[0.18em] text-muted">Sirius</p>
      <h1 className="mt-5 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        Something&apos;s cooking{" "}
        <span role="img" aria-label="eyes">
          👀
        </span>
      </h1>
      <p className="mt-5 max-w-md text-base leading-relaxed text-muted sm:text-lg">
        Sirius is going live on Mezo mainnet very soon.
      </p>
      <p className="mt-16 text-xs text-muted-foreground">Rent private data for one training run, paid in MUSD on Mezo.</p>
      {/* Pages légales : en liste blanche de la porte, lisibles avant l'ouverture. */}
      <LegalLinks className="mt-4" />
    </main>
  );
}
