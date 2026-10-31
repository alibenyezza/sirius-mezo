import type { NextConfig } from "next";

const development = process.env.NODE_ENV !== "production";

const securityHeaders = [
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=()" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(development
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  // Indicateur dev en bas-droite (par défaut bas-gauche : chevauche le logo/bouton de la sidebar).
  devIndicators: { position: "bottom-right" },
  // SDK dstack (socket natif) + dcap-qvl (vérif de quote) → laissés externes (pas de bundling serveur).
  serverExternalPackages: ["@phala/dstack-sdk", "@phala/dcap-qvl"],
  // Mezo Passport (OrangeKit) publie du TypeScript non compilé : `orangekit-contracts` a pour
  // point d'entrée `index.ts`, et `orangekit` réexporte `orangekit-smart-account/src/…`. Sans
  // transpilation de ces paquets, Turbopack et webpack refusent de les résoudre.
  transpilePackages: ["@mezo-org/orangekit", "@mezo-org/orangekit-smart-account", "@mezo-org/orangekit-contracts"],
  experimental: {
    proxyClientMaxBodySize: "24mb",
  },
  // La page publique `/proof` lit le manifeste de déploiement sur le disque : le traçage
  // des fichiers doit l'embarquer dans la fonction serveur, sinon la page échoue sur Vercel.
  outputFileTracingIncludes: { "/proof": ["./deployments/mezo-testnet.json"] },
  // La page « Audit » est devenue « Explorer » : l'ancienne adresse renvoie en 308 vers la nouvelle,
  // pour ne casser ni favori ni lien déjà publié. Source et destination sont des chemins fixes :
  // aucun paramètre n'est recopié dans la cible, donc aucune redirection ouverte.
  async redirects() {
    return [{ source: "/audit", destination: "/explorer", permanent: true }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
