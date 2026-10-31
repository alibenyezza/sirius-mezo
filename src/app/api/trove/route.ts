import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { AppError, errorResponse } from "@/lib/errors";
import { normalizeAddress } from "@/lib/evm/address";
import { EVM_CHAIN_IDS, resolveServerNetwork } from "@/lib/evm/networks";
import { enforceRateLimit, FixedWindowRateLimiter } from "@/lib/http/rate-limit";
import { musdProtocol } from "@/lib/mezo/protocol";
import { readDrawQuote } from "@/lib/mezo/trove";

/**
 * Position MUSD du wallet connecté et devis d'un tirage (`?amount=<MUSD en 1e18>`),
 * plus le domaine EIP-712 à signer. Lecture seule : rien n'est émis on-chain ici.
 * Fonction « emprunter et acheter » derrière `SIRIUS_BORROW_AND_BUY=true` : 404 sinon,
 * pour ne pas révéler la route tant qu'elle n'est pas activée.
 */
export const runtime = "nodejs";
const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, maxPerKey: 30, maxGlobal: 600 });
const MAX_AMOUNT_DIGITS = 36;

function parseAmount(raw: string | null): bigint {
  if (raw === null || raw === "") return BigInt(0);
  if (!/^\d+$/.test(raw) || raw.length > MAX_AMOUNT_DIGITS) throw new AppError("Montant invalide : entier atomique attendu", 400);
  return BigInt(raw);
}

export async function GET(req: Request) {
  try {
    if (process.env.SIRIUS_BORROW_AND_BUY !== "true") throw new AppError("Introuvable", 404);
    const session = requireAuth(req);
    enforceRateLimit(limiter, session.address);
    const account = normalizeAddress(session.address);
    const amount = parseAmount(new URL(req.url).searchParams.get("amount"));

    const { network } = resolveServerNetwork();
    const { position, quote, hints } = await readDrawQuote(account, amount, network);
    return NextResponse.json(
      {
        account,
        network,
        position,
        quote,
        hints,
        typedData: { chainId: EVM_CHAIN_IDS[network], verifyingContract: musdProtocol(network).borrowerOperationsSignatures },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
