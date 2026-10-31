import { NextResponse } from "next/server";
import { prepareLockWithSignature, relayLockWithSignature } from "@/lib/sirius/gasless-lock";
import { requireAuth } from "@/lib/auth/require-auth";
import { errorResponse } from "@/lib/errors";
import { readJson } from "@/lib/http/body";
import { enforceRateLimit, FixedWindowRateLimiter } from "@/lib/http/rate-limit";

export const runtime = "nodejs";
// Le relais attend le reçu du lock : comme `/submit`, bien sous la minute en pratique.
export const maxDuration = 60;

/**
 * Lock par signature (`SiriusEscrow.lockWithSignature`) : `GET` rend les deux charges EIP-712
 * à signer (permit MUSD, demande de lock), `POST` relaie les signatures depuis le compte de
 * règlement, qui paie le gas. Session de l'acheteur requise dans les deux cas.
 *
 * Chaque relais coûte du gas à Sirius : trois par heure et par compte suffisent au parcours
 * normal (une préparation, une reprise), et le plafond global borne ce qu'une instance peut
 * dépenser en une heure.
 */
const prepareLimiter = new FixedWindowRateLimiter({ windowMs: 60_000, maxPerKey: 6, maxGlobal: 600 });
const relayLimiter = new FixedWindowRateLimiter({ windowMs: 60 * 60_000, maxPerKey: 3, maxGlobal: 120 });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireAuth(req);
    const { id } = await params;
    enforceRateLimit(prepareLimiter, `subject:${session.address}`);
    return NextResponse.json(await prepareLockWithSignature(id, session.address), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireAuth(req);
    const { id } = await params;
    enforceRateLimit(relayLimiter, `subject:${session.address}`);
    const body = await readJson(req);
    return NextResponse.json(await relayLockWithSignature(id, session.address, body));
  } catch (error) {
    return errorResponse(error);
  }
}
