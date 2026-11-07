import { z } from "zod";
import { AppError } from "@/lib/app-error";
import type { LockRequest } from "@/lib/evm/lock-request";

/**
 * Forme sur le fil de la `LockRequest` signée par l'acheteur (entiers en chaînes décimales :
 * JSON ne transporte pas de bigint) et validation du corps que le relayeur accepte.
 * Module pur, partagé par le serveur et les tests.
 */

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "adresse invalide");
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "bytes32 invalide");
const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/, "entier invalide");
const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/, "signature invalide");

export const lockRequestWire = z.object({
  borrower: address,
  provider: address,
  amount: uint,
  hashlock: bytes32,
  challengeDays: z.number().int().min(1).max(30),
  loanIdHash: bytes32,
  datasetId: bytes32,
  trainingProfile: bytes32,
  nonce: uint,
  deadline: uint,
});

export const lockRelayBody = z.object({
  request: lockRequestWire,
  borrowerSignature: signature,
  permitSignature: signature.optional(),
});

export type LockRequestWire = z.infer<typeof lockRequestWire>;

export interface LockRelayBody {
  request: LockRequest & { hashlock: `0x${string}`; loanIdHash: `0x${string}`; datasetId: `0x${string}`; trainingProfile: `0x${string}` };
  borrowerSignature: `0x${string}`;
  permitSignature?: `0x${string}`;
}

export function serializeLockRequest(request: LockRequest): LockRequestWire {
  return {
    borrower: request.borrower,
    provider: request.provider,
    amount: request.amount.toString(),
    hashlock: request.hashlock,
    challengeDays: request.challengeDays,
    loanIdHash: request.loanIdHash,
    datasetId: request.datasetId,
    trainingProfile: request.trainingProfile,
    nonce: request.nonce.toString(),
    deadline: request.deadline.toString(),
  };
}

export function parseLockRelayBody(body: unknown): LockRelayBody {
  const parsed = lockRelayBody.safeParse(body);
  if (!parsed.success) throw new AppError("Corps de relais de lock invalide", 400);
  const { request, borrowerSignature, permitSignature } = parsed.data;
  return {
    request: {
      borrower: request.borrower,
      provider: request.provider,
      amount: BigInt(request.amount),
      hashlock: request.hashlock as `0x${string}`,
      challengeDays: request.challengeDays,
      loanIdHash: request.loanIdHash as `0x${string}`,
      datasetId: request.datasetId as `0x${string}`,
      trainingProfile: request.trainingProfile as `0x${string}`,
      nonce: BigInt(request.nonce),
      deadline: BigInt(request.deadline),
    },
    borrowerSignature: borrowerSignature as `0x${string}`,
    permitSignature: permitSignature as `0x${string}` | undefined,
  };
}

/**
 * Données typées EIP-712 prêtes pour une réponse JSON : les entiers du message en chaînes
 * décimales. `JSON.stringify` refuse les bigint (la route rendait un 500 « TypeError ») et
 * les wallets attendent de toute façon des chaînes dans `eth_signTypedData_v4`.
 */
export function typedDataForWallet<T extends { message: Record<string, unknown> }>(typedData: T) {
  const message = Object.fromEntries(
    Object.entries(typedData.message).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]),
  );
  return { ...typedData, message };
}
