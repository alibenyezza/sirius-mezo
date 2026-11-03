import type { Metadata } from "next";

// Le page.tsx docs est un client component (useBlobStore) → métadonnées portées ici.
export const metadata: Metadata = {
  title: "Documentation — Sirius",
  description:
    "How Sirius works: rent private data for one training run on a testnet runner, settled in MUSD on Mezo, with a signed, verifiable certificate for every run.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
