import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { errorResponse } from "@/lib/errors";
import { readJson } from "@/lib/http/body";
import { enforceRateLimit, FixedWindowRateLimiter } from "@/lib/http/rate-limit";
import { prepareBtcCheckout } from "@/lib/sirius/btc-checkout";

export const runtime = "nodejs";

/**
 * Paiement en BTC (`SiriusCheckout.buyWithBtc`) : `POST` recoupe la requête signée et rend la
 * transaction que le wallet de l'acheteur envoie lui-même. Le devis vient de `/api/mezo/btc-quote`.
 * Sirius ne paie ni ne soumet rien ici : seulement des lectures et une simulation.
 */
const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, maxPerKey: 10, maxGlobal: 600 });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireAuth(req);
    const { id } = await params;
    enforceRateLimit(limiter, `subject:${session.address}`);
    const body = await readJson(req);
    return NextResponse.json(await prepareBtcCheckout(id, session.address, body), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
