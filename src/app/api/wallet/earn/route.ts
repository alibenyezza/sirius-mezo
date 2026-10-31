import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { AppError, errorResponse } from "@/lib/errors";
import { normalizeAddress } from "@/lib/evm/address";
import { resolveServerNetwork } from "@/lib/evm/networks";
import { enforceRateLimit, FixedWindowRateLimiter } from "@/lib/http/rate-limit";
import { readEarnPosition } from "@/lib/mezo/earn";
import { earnActionTransactions, parseEarnAction } from "@/lib/mezo/earn-actions";
import { musdProtocol } from "@/lib/mezo/protocol";

export const runtime = "nodejs";
const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, maxPerKey: 30, maxGlobal: 600 });

/**
 * Position du wallet connecté dans les deux lieux de rendement MUSD de Mezo (Stability Pool,
 * coffre sMUSD) et, sur demande (`?action=&amount=`), les transactions à signer pour y entrer
 * ou en sortir. Lecture seule côté serveur : c'est le wallet de l'utilisateur qui signe.
 * Derrière `SIRIUS_MEZO_EARN=true` ; 404 sinon.
 */
export async function GET(req: Request) {
  try {
    if (process.env.SIRIUS_MEZO_EARN?.trim() !== "true") throw new AppError("Introuvable", 404);
    const session = requireAuth(req);
    enforceRateLimit(limiter, session.address);
    const account = normalizeAddress(session.address);
    const { network } = resolveServerNetwork();
    const params = new URL(req.url).searchParams;
    const position = await readEarnPosition(account, network);
    const action = parseEarnAction(params.get("action"), params.get("amount"));
    const transactions = action ? earnActionTransactions(action, position, network) : [];
    return NextResponse.json(
      { position, venues: { stabilityPool: musdProtocol(network).stabilityPool, savingsVault: musdProtocol(network).savingsVault }, transactions },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
