import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { AppError, errorResponse } from "@/lib/errors";
import { readJson } from "@/lib/http/body";
import { enforceRateLimit, FixedWindowRateLimiter } from "@/lib/http/rate-limit";
import { relayWithdrawMusd } from "@/lib/mezo/draw-relay";

export const runtime = "nodejs";
// Le relais attend le reçu du tirage.
export const maxDuration = 60;

/**
 * Relais d'un tirage de MUSD signé par l'acheteur (`withdrawMUSDWithSignature`), gas payé par
 * Sirius. Chaque relais coûte du gas : cinq par heure et par compte, et un plafond global.
 */
const limiter = new FixedWindowRateLimiter({ windowMs: 60 * 60_000, maxPerKey: 5, maxGlobal: 120 });

export async function POST(req: Request) {
  try {
    if (process.env.SIRIUS_BORROW_AND_BUY?.trim() !== "true") throw new AppError("Introuvable", 404);
    const session = requireAuth(req);
    enforceRateLimit(limiter, `subject:${session.address}`);
    const body = await readJson(req);
    return NextResponse.json(await relayWithdrawMusd(session.address, body), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
