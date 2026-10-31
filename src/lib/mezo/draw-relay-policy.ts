import { z } from "zod";
import { AppError } from "@/lib/app-error";

/** Validation pure du corps d'un tirage relayé et de sa fenêtre temporelle. */

/** Une signature de tirage ne vaut que quelques minutes : au-delà, elle est à refaire. */
export const DRAW_MAX_TTL_SECONDS = 10 * 60;

const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/, "entier invalide");
const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/, "signature invalide");

export const drawRelayBody = z.object({
  amount: uint,
  nonce: uint,
  deadline: uint,
  signature,
});

export interface DrawRelayBody {
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  signature: `0x${string}`;
}

export function parseDrawRelayBody(body: unknown): DrawRelayBody {
  const parsed = drawRelayBody.safeParse(body);
  if (!parsed.success) throw new AppError("Corps de tirage invalide", 400);
  const amount = BigInt(parsed.data.amount);
  if (amount <= BigInt(0)) throw new AppError("Montant de tirage nul", 400);
  return { amount, nonce: BigInt(parsed.data.nonce), deadline: BigInt(parsed.data.deadline), signature: parsed.data.signature as `0x${string}` };
}

/** Échéance dans le futur, mais pas au-delà de ce que le relayeur accepte de garder valide. */
export function validateDrawTiming(deadline: bigint, nowSeconds: number): void {
  const now = BigInt(nowSeconds);
  if (deadline <= now) throw new AppError("Signature de tirage expirée : recommence", 409);
  if (deadline > now + BigInt(DRAW_MAX_TTL_SECONDS)) throw new AppError("Échéance de tirage trop lointaine", 400);
}
