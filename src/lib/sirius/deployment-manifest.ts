import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Manifeste de déploiement Mezo testnet (`deployments/mezo-testnet.json`).
 *
 * Écrit par `scripts/mezo-testnet.ts` au déploiement, puis complété à la main ou par
 * d'autres scripts (vérification des sources, transactions de démonstration, preuves
 * supplémentaires). La page publique `/proof` le lit à chaque requête ; elle doit survivre
 * à un champ manquant, pas à un champ malformé : les blocs optionnels (`verification`,
 * `evidence`, `previous`) sont tolérés absents, mais une adresse ou un hash mal formé est
 * refusé plutôt qu'affiché comme preuve. `previous` est accepté sous forme d'objet (forme
 * historique) ou de tableau, et toujours exposé en tableau, le plus récent en premier.
 */

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "adresse EVM attendue");
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "hash de transaction attendu");

const contractVerificationSchema = z.object({
  verified: z.boolean(),
  url: z.url().optional(),
});

const verificationSchema = z.object({
  explorer: z.url().optional(),
  verifiedAt: z.string().optional(),
  contracts: z.object({
    escrow: contractVerificationSchema.optional(),
    datasets: contractVerificationSchema.optional(),
    kyb: contractVerificationSchema.optional(),
    feeRouter: contractVerificationSchema.optional(),
    feePolicy: contractVerificationSchema.optional(),
    checkout: contractVerificationSchema.optional(),
  }),
});

const evidenceSchema = z.object({
  label: z.string().min(1),
  kind: z.enum(["tx", "address"]),
  value: z.string().min(1),
  note: z.string().optional(),
  date: z.string().optional(),
  /** Qui est derrière la transaction : un wallet de l'équipe (défaut) ou un utilisateur externe. */
  party: z.enum(["team", "external"]).optional(),
});

/**
 * Un déploiement remplacé. `scripts/mezo-testnet.ts` a d'abord écrit un objet unique, puis
 * un tableau (le plus récent en premier) ; les deux formes sont lues et ramenées à un
 * tableau dans la sortie, pour que `/proof` n'ait qu'un cas à afficher.
 */
const previousDeploymentSchema = z.object({
  escrow: hexAddress,
  kyb: hexAddress,
  datasets: hexAddress,
  kybMode: z.string().optional(),
  escrowVersion: z.string().optional(),
  escrowFeatures: z.array(z.string()).optional(),
  feeRouter: hexAddress.optional(),
  feePolicy: hexAddress.optional(),
  feeBps: z.number().int().nonnegative().optional(),
  checkout: hexAddress.optional(),
  lockAuthorizer: hexAddress.optional(),
  deployedAt: z.string().optional(),
  deployer: hexAddress.optional(),
  transactions: z
    .object({
      mint: txHash.optional(),
      approve: txHash.optional(),
      lock: txHash.optional(),
      release: txHash.optional(),
      withdrawFor: txHash.optional(),
    })
    .optional(),
});

export const deploymentManifestSchema = z.object({
  network: z.string(),
  chainId: z.number().int().positive(),
  explorer: z.url(),
  deployedAt: z.string(),
  deployer: hexAddress,
  lockAuthorizer: hexAddress,
  settlementToken: z.object({
    symbol: z.string(),
    address: hexAddress,
    decimals: z.number().int().nonnegative(),
    codeHash: z.string().optional(),
  }),
  contracts: z.object({
    escrow: hexAddress,
    kyb: hexAddress,
    datasets: hexAddress,
    kybMode: z.string().optional(),
    escrowVersion: z.string().optional(),
    /** Fonctions optionnelles présentes dans l'escrow déployé (ex. `lockWithSignature`). */
    escrowFeatures: z.array(z.string()).optional(),
    /** Routeur qui reçoit les frais de plateforme et les verse en bribe MUSD sur Mezo. */
    feeRouter: hexAddress.optional(),
    /** Politique de remise veMEZO lue par l'escrow à la libération. */
    feePolicy: hexAddress.optional(),
    /** Taux de base des frais, en points de base. */
    feeBps: z.number().int().nonnegative().optional(),
    /** Paiement en BTC : swap Mezo Pools puis verrouillage signé, en une transaction. */
    checkout: hexAddress.optional(),
  }),
  demo: z
    .object({
      provider: hexAddress,
      borrower: hexAddress,
      datasetId: z.string(),
      amountMusd: z.string(),
      transactions: z.object({
        mint: txHash.optional(),
        approve: txHash.optional(),
        lock: txHash.optional(),
        release: txHash.optional(),
        withdrawFor: txHash.optional(),
      }),
    })
    .optional(),
  previous: z
    .union([previousDeploymentSchema, z.array(previousDeploymentSchema)])
    .optional()
    .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value])),
  verification: verificationSchema.optional(),
  evidence: z.array(evidenceSchema).optional(),
});

export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;
export type ManifestEvidence = z.infer<typeof evidenceSchema>;
export type PreviousDeployment = z.infer<typeof previousDeploymentSchema>;
export type ManifestContractKey = "escrow" | "datasets" | "kyb" | "feeRouter" | "feePolicy" | "checkout";

export const DEPLOYMENT_MANIFEST_PATH = "deployments/mezo-testnet.json";

/** Valide un manifeste déjà parsé (tests, autres chargeurs). Lève sur un champ malformé. */
export function parseDeploymentManifest(raw: unknown): DeploymentManifest {
  return deploymentManifestSchema.parse(raw);
}

/** Lit et valide le manifeste depuis le disque, relatif à la racine du projet par défaut. */
export function readDeploymentManifest(path: string = resolve(process.cwd(), DEPLOYMENT_MANIFEST_PATH)): DeploymentManifest {
  return parseDeploymentManifest(JSON.parse(readFileSync(path, "utf8")));
}

/** Les cinq transactions du cycle de règlement, dans l'ordre où le script les envoie. */
export const DEMO_TRANSACTION_ORDER = ["mint", "approve", "lock", "release", "withdrawFor"] as const;
export type DemoTransactionKey = (typeof DEMO_TRANSACTION_ORDER)[number];

/** Transactions de démonstration présentes dans le manifeste, dans l'ordre du cycle. */
export function demoTransactions(manifest: DeploymentManifest): Array<{ key: DemoTransactionKey; hash: string }> {
  const transactions = manifest.demo?.transactions;
  if (!transactions) return [];
  return DEMO_TRANSACTION_ORDER.flatMap((key) => {
    const hash = transactions[key];
    return hash ? [{ key, hash }] : [];
  });
}

/**
 * Hôte de l'API Blockscout dérivé de l'explorateur (`https://explorer.test.mezo.org` →
 * `https://api.explorer.test.mezo.org`), le même que celui déclaré dans la configuration
 * Hardhat pour la vérification des sources.
 */
export function explorerApiBase(explorer: string): string {
  const url = new URL(explorer);
  url.hostname = `api.${url.hostname}`;
  return url.origin;
}

/** Lien de vérification d'un contrat, fourni par le manifeste ou reconstruit depuis l'explorateur. */
export function contractSourceUrl(manifest: DeploymentManifest, key: ManifestContractKey): string {
  const declared = manifest.verification?.contracts?.[key]?.url;
  if (declared) return declared;
  return `${manifest.explorer}/address/${manifest.contracts[key]}?tab=contract`;
}
