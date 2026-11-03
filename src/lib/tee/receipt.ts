import "server-only";
import { settlementAccount } from "@/lib/evm/runner-account";
import { receiptMessage } from "./receipt-message";

/**
 * Signe le reçu d'exécution d'un entraînement fait hors enclave (`TEE_MODE` différent de
 * « phala »). En mode enclave, la quote TDX joue ce rôle : rien n'est signé ici.
 */
export async function executionReceiptSignature(
  payloadHash: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  if (env.TEE_MODE === "phala") return null;
  return settlementAccount().signMessage({ message: receiptMessage(payloadHash) });
}
