import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/session";
import { AppError, errorResponse } from "@/lib/errors";
import { enforceRateLimit, FixedWindowRateLimiter } from "@/lib/http/rate-limit";
import { quoteBtcCheckout } from "@/lib/sirius/btc-checkout";

export const runtime = "nodejs";

/**
 * Devis du paiement en BTC pour un prix en MUSD (unités atomiques) : BTC à envoyer au cours du
 * pool BTC/MUSD de Mezo Pools, plancher de l'oracle, et solde BTC du compte connecté s'il y en a
 * un. Lectures seules, aucune transaction.
 */
const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, maxPerKey: 30, maxGlobal: 1_200 });

export async function GET(req: Request) {
  try {
    const amount = new URL(req.url).searchParams.get("amount") ?? "";
    if (!/^[1-9][0-9]{0,30}$/.test(amount)) throw new AppError("Montant invalide", 400);
    const session = readSession(req);
    enforceRateLimit(limiter, session ? `subject:${session.address}` : "anonymous");
    return NextResponse.json(await quoteBtcCheckout(BigInt(amount), session?.address ?? null), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
