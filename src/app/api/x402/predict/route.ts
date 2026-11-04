import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareEip2612GasSponsoringExtension } from "@x402/extensions";
import { errorResponse } from "@/lib/errors";
import { enforceRateLimit, FixedWindowRateLimiter } from "@/lib/http/rate-limit";
import { predictModel } from "@/lib/models/predict";
import {
  parseFeatureValues,
  readX402Config,
  X402InputError,
  x402DemoModel,
  x402Description,
  type X402Config,
} from "@/lib/x402/config";

export const runtime = "nodejs";

/**
 * Prédiction payée à l'appel en MUSD (x402). `GET` décrit l'API gratuitement ; `POST` sans
 * paiement répond 402 avec le prix, avec paiement il répond la prédiction et l'en-tête de
 * règlement. Voir `src/lib/x402/config.ts`. Fermée (404) tant que `SIRIUS_X402` n'est pas `true`.
 */
const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, maxPerKey: 120, maxGlobal: 1_200 });

async function predict(request: NextRequest): Promise<NextResponse> {
  const model = x402DemoModel();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON attendu" }, { status: 400 });
  }
  try {
    const prediction = predictModel(model, parseFeatureValues(body, model));
    return NextResponse.json({ model: { target: model.target, algo: model.algo }, prediction }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // Un statut ≥ 400 n'est jamais réglé : une entrée invalide ne coûte rien.
    const message = error instanceof X402InputError || error instanceof Error ? error.message : "Prédiction impossible";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

let paid: { key: string; handler: (request: NextRequest) => Promise<NextResponse> } | null = null;

/** Gestionnaire payant, construit une fois par configuration (le facilitateur est lu au premier appel). */
function paidHandler(config: X402Config) {
  const key = `${config.network}|${config.price}|${config.payTo}|${config.facilitatorUrl}`;
  if (paid?.key === key) return paid.handler;
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: config.facilitatorUrl }))
    .register(config.network, new ExactEvmScheme());
  const handler = withX402(
    predict,
    {
      accepts: { scheme: "exact", price: config.price, network: config.network, payTo: config.payTo },
      description: "Sirius demo model: hourly energy demand prediction, paid per call in MUSD on Mezo testnet",
      mimeType: "application/json",
      extensions: { ...declareEip2612GasSponsoringExtension() },
    },
    server,
  );
  paid = { key, handler };
  return handler;
}

const closed = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET() {
  try {
    const config = readX402Config();
    if (!config) return closed();
    return NextResponse.json(x402Description(config, x402DemoModel()), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const config = readX402Config();
    if (!config) return closed();
    enforceRateLimit(limiter, "x402:predict");
    return await paidHandler(config)(request);
  } catch (error) {
    return errorResponse(error);
  }
}
