/**
 * Logique pure de `scripts/mezo-testnet.ts` : choix du registre KYB à réutiliser, réécriture
 * du manifeste `deployments/mezo-testnet.json` avec historique, liste des anciens escrows
 * pour `.env.local` et lecture des fonctionnalités de l'escrow dans son ABI.
 *
 * Aucun accès réseau ni disque ici, pour que `scripts/mezo-manifest.test.ts` couvre chaque
 * règle sans clé ni RPC. La page `/proof` lit le résultat via
 * `src/lib/sirius/deployment-manifest.ts` : les deux formes de `previous` (objet historique
 * ou tableau) y sont acceptées, ce script n'écrit plus que le tableau.
 */
import type { Abi } from "viem";

type Env = Record<string, string | undefined>;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const DEFAULT_ESCROW_VERSION = "sirius-escrow-usdc-v6";
/** Fonctions optionnelles de l'escrow dont la présence dans l'ABI vaut déclaration. */
export const ESCROW_FEATURE_FUNCTIONS = ["lockWithSignature", "feeBpsFor"] as const;

export interface ManifestContracts {
  escrow: string;
  kyb: string;
  datasets: string;
  kybMode?: string;
  escrowVersion?: string;
  escrowFeatures?: string[];
  /** Frais de plateforme : routeur qui reçoit les frais, politique veMEZO, taux de base. */
  feeRouter?: string;
  feePolicy?: string;
  feeBps?: number;
  /** Paiement en BTC : swap Mezo Pools puis verrouillage signé, en une transaction. */
  checkout?: string;
}

export interface ManifestTransactions {
  mint?: string;
  approve?: string;
  lock?: string;
  release?: string;
  withdrawFor?: string;
}

/** Un déploiement remplacé : ses trois contrats, son signataire et ses transactions de démonstration. */
export interface PreviousDeployment extends ManifestContracts {
  lockAuthorizer?: string;
  deployedAt?: string;
  deployer?: string;
  transactions?: ManifestTransactions;
}

export interface DeploymentManifestFile {
  network: string;
  chainId: number;
  explorer?: string;
  deployedAt: string;
  deployer: string;
  lockAuthorizer: string;
  settlementToken: { symbol: string; address: string; decimals: number; codeHash?: string };
  contracts: ManifestContracts;
  demo?: { provider: string; borrower: string; datasetId: string; amountMusd: string; transactions?: ManifestTransactions };
  previous?: PreviousDeployment | PreviousDeployment[];
  verification?: unknown;
  evidence?: unknown;
  [extra: string]: unknown;
}

export interface NewDeployment {
  chainId: number;
  explorer?: string;
  deployedAt: string;
  deployer: string;
  lockAuthorizer: string;
  settlementToken: DeploymentManifestFile["settlementToken"];
  contracts: ManifestContracts;
}

/**
 * Registre KYB à réutiliser pour le nouveau trio, ou `undefined` pour en déployer un neuf.
 *
 * Priorité : `SIRIUS_REUSE_KYB_ADDRESS` explicite, puis le registre du manifeste courant
 * (le registre ouvert n'a pas d'état, le redéployer ne sert à rien), sauf si
 * `SIRIUS_FRESH_KYB=true` demande un registre neuf.
 */
export function reuseKybAddress(env: Env, saved: Pick<DeploymentManifestFile, "contracts"> | null): string | undefined {
  const explicit = env.SIRIUS_REUSE_KYB_ADDRESS?.trim();
  if (explicit) {
    if (!ADDRESS.test(explicit)) throw new Error("SIRIUS_REUSE_KYB_ADDRESS doit être une adresse EVM valide");
    return explicit;
  }
  if (env.SIRIUS_FRESH_KYB === "true") return undefined;
  const recorded = saved?.contracts?.kyb?.trim();
  return recorded && ADDRESS.test(recorded) ? recorded : undefined;
}

/** `previous` sous ses deux formes, ramené à un tableau (le plus récent en premier). */
export function previousDeployments(saved: Pick<DeploymentManifestFile, "previous"> | null): PreviousDeployment[] {
  const previous = saved?.previous;
  if (!previous) return [];
  return Array.isArray(previous) ? previous : [previous];
}

/**
 * Nouveau manifeste après un redéploiement. Le déploiement courant du manifeste lu devient
 * la première entrée de `previous` (avec son signataire, sa date et ses transactions de
 * démonstration), les entrées déjà présentes suivent. `verification` disparaît : les
 * nouvelles adresses ne sont pas encore vérifiées. `evidence` et tout bloc inconnu sont
 * conservés tels quels. `demo` n'est pas repris : il décrit le cycle joué sur l'ancien trio.
 */
export function nextManifest(saved: DeploymentManifestFile | null, deployment: NewDeployment): DeploymentManifestFile {
  const replaced = new Set(["verification", "demo", "previous", "contracts", "evidence"]);
  const kept = Object.fromEntries(Object.entries(saved ?? {}).filter(([key]) => !replaced.has(key)));
  const previous: PreviousDeployment[] = [];
  if (saved && saved.contracts.escrow.toLowerCase() !== deployment.contracts.escrow.toLowerCase()) {
    const entry: PreviousDeployment = { ...saved.contracts, lockAuthorizer: saved.lockAuthorizer, deployedAt: saved.deployedAt, deployer: saved.deployer };
    const transactions = saved.demo?.transactions;
    if (transactions && Object.keys(transactions).length > 0) entry.transactions = transactions;
    previous.push(entry);
  }
  previous.push(...previousDeployments(saved));

  const manifest: DeploymentManifestFile = {
    ...kept,
    network: "mezo-testnet",
    chainId: deployment.chainId,
    explorer: deployment.explorer,
    deployedAt: deployment.deployedAt,
    deployer: deployment.deployer,
    lockAuthorizer: deployment.lockAuthorizer,
    settlementToken: deployment.settlementToken,
    contracts: deployment.contracts,
  };
  if (previous.length > 0) manifest.previous = previous;
  if (saved?.evidence !== undefined) manifest.evidence = saved.evidence;
  return manifest;
}

/**
 * Valeur de `SIRIUS_LEGACY_ESCROW_ADDRESSES` après un redéploiement : les anciens escrows
 * déjà déclarés, plus celui que l'on remplace, sans doublon (comparaison insensible à la
 * casse) et sans l'escrow courant. Les crédits restés sur un ancien escrow restent ainsi
 * retirables depuis l'application (`src/lib/evm/history.ts`).
 */
export function legacyEscrowAddresses(current: string | undefined, retired: string[], active: string): string {
  const seen = new Set<string>([active.toLowerCase()]);
  const result: string[] = [];
  for (const address of [...(current ?? "").split(","), ...retired]) {
    const trimmed = address.trim();
    if (!ADDRESS.test(trimmed) || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    result.push(trimmed);
  }
  return result.join(",");
}

/** Fonctionnalités optionnelles effectivement présentes dans l'ABI de l'escrow compilé. */
export function escrowFeatures(abi: Abi): string[] {
  const functions = new Set(abi.flatMap((item) => (item.type === "function" ? [item.name] : [])));
  return ESCROW_FEATURE_FUNCTIONS.filter((name) => functions.has(name));
}
