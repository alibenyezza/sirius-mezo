import "server-only";
import { keccak256, stringToHex, type Hex } from "viem";
import { AppError } from "@/lib/app-error";
import { mezoPassportEnabled } from "@/lib/wallet/passport-flag";
import { tryNormalizeAddress, type CanonicalAddress } from "./address";
import { getPublicClient } from "./client";
import { verifyWalletSignature, type WalletSignatureInput } from "./signature";

/**
 * Vérification d'une signature de wallet, EOA ou smart account.
 *
 * Le chemin historique reste premier : `ecrecover` pur, sans réseau. Il suffit à MetaMask,
 * au portefeuille embarqué et à toute EOA. Un compte Mezo Passport, lui, est un contrat :
 * sa signature n'a pas de signataire à reconstruire, seulement un compte à interroger —
 * ERC-1271, et ERC-6492 tant qu'il n'est pas déployé. viem fait les deux dans
 * `verifyMessage`, en simulant au besoin le déploiement dans un `eth_call`.
 *
 * Ce second chemin ne s'ouvre que derrière le drapeau Passport et seulement pour une
 * signature qui ne peut pas être une EOA (plus de 65 octets) : une instance sans Passport
 * ne fait jamais d'appel RPC pour vérifier une signature, et une signature EOA fausse
 * reste refusée localement, comme avant.
 *
 * La validité d'une signature contractuelle dépend de l'état de la chaîne — donc du RPC
 * interrogé, déjà tenu pour fiable par toutes les lectures d'escrow. Un RPC injoignable
 * vaut 503, pas 401 : l'utilisateur doit réessayer, pas se croire refusé.
 */

/** Au-delà de 65 octets (sinon c'est une EOA), plafonnée pour ne pas transporter n'importe quoi. */
const CONTRACT_SIGNATURE_PATTERN = /^0x(?:[0-9a-fA-F]{2}){66,4096}$/;

/** Hex d'une signature contractuelle plausible, sinon `null`. */
export function contractSignatureShape(signature: unknown): Hex | null {
  return typeof signature === "string" && CONTRACT_SIGNATURE_PATTERN.test(signature) ? (signature as Hex) : null;
}

export interface ContractSignatureCheck {
  address: CanonicalAddress;
  message: string;
  signature: Hex;
}

export type ContractSignatureVerifier = (check: ContractSignatureCheck) => Promise<boolean>;

interface VerificationDependencies {
  enabled?: () => boolean;
  verify?: ContractSignatureVerifier;
}

const verifyOnChain: ContractSignatureVerifier = ({ address, message, signature }) =>
  getPublicClient().verifyMessage({ address, message, signature });

/**
 * Souvenir des vérifications réussies.
 *
 * La même délégation accompagne chaque grant runner, et chaque grant est vérifié : sans
 * mémoire, chaque requête coûterait un `eth_call`. Une signature validée pour un compte,
 * un message et des octets donnés ne redevient pas invalide à l'échelle d'une session ;
 * borné en taille et en durée par prudence.
 */
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 256;
const verified = new Map<string, number>();

function cacheKey({ address, message, signature }: ContractSignatureCheck): string {
  return `${address}:${keccak256(stringToHex(message))}:${keccak256(signature)}`;
}

function remembered(key: string): boolean {
  const expiresAt = verified.get(key);
  if (expiresAt === undefined) return false;
  if (expiresAt > Date.now()) return true;
  verified.delete(key);
  return false;
}

function remember(key: string): void {
  if (verified.size >= CACHE_MAX_ENTRIES) {
    const oldest = verified.keys().next().value;
    if (oldest !== undefined) verified.delete(oldest);
  }
  verified.set(key, Date.now() + CACHE_TTL_MS);
}

/** Pour les tests : oublie les vérifications mémorisées. */
export function resetContractSignatureCache(): void {
  verified.clear();
}

/**
 * Prouve que `address` a signé `message`, par `ecrecover` ou, derrière le drapeau Passport,
 * par le compte lui-même. Lève une 401 sinon, une 503 si la chaîne n'a pas pu répondre.
 */
export async function verifyWalletOrContractSignature(
  input: WalletSignatureInput,
  dependencies: VerificationDependencies = {},
): Promise<CanonicalAddress> {
  let eoaFailure: unknown;
  try {
    return await verifyWalletSignature(input);
  } catch (error) {
    eoaFailure = error;
  }
  const enabled = dependencies.enabled ?? mezoPassportEnabled;
  if (!enabled()) throw eoaFailure;

  const address = tryNormalizeAddress(input.address);
  const signature = contractSignatureShape(input.signature);
  if (!address || !signature) throw new AppError("Signature invalide", 401);

  const check: ContractSignatureCheck = { address, message: input.message, signature };
  const key = cacheKey(check);
  if (remembered(key)) return address;

  let valid: boolean;
  try {
    valid = await (dependencies.verify ?? verifyOnChain)(check);
  } catch {
    throw new AppError("Vérification de la signature indisponible — réessaie.", 503);
  }
  if (!valid) throw new AppError("Signature invalide", 401);
  remember(key);
  return address;
}

/**
 * Connexion : même preuve que la délégation runner. Sans Passport, le message historique
 * explique qu'un compte contractuel n'est pas accepté ; avec, il l'est, et un refus est
 * simplement une signature invalide.
 */
export async function verifyLoginSignature(input: WalletSignatureInput): Promise<CanonicalAddress> {
  try {
    return await verifyWalletOrContractSignature(input);
  } catch (error) {
    if (error instanceof AppError && error.status === 503) throw error;
    if (mezoPassportEnabled()) throw new AppError("Signature invalide", 401);
    throw new AppError("Le wallet doit signer directement avec ce compte. Les comptes contractuels ne sont pas pris en charge.", 401);
  }
}
