import { getAddress, isAddress, type Address } from "viem";
import { parseDownloadedModel, type DownloadedModel } from "@/lib/models/registry";
import demoModel from "./demo-model.json";

/**
 * Prédictions payées à l'appel en MUSD, par le protocole x402 (HTTP 402).
 *
 * Un agent appelle `POST /api/x402/predict`, reçoit 402 avec le prix, signe une autorisation
 * Permit2 + EIP-2612 (aucune transaction, aucun gas), et le facilitateur Mezo règle le
 * transfert en MUSD sur le testnet en payant le gas en BTC. Le paiement n'est réglé que si la
 * prédiction réussit (statut < 400).
 *
 * Paiement direct, sans escrow ni remboursement : réservé à des montants de l'ordre du
 * millième de MUSD. L'entraînement, lui, reste payé par l'escrow.
 *
 * Le modèle servi est un modèle de démonstration entraîné par le même code que le runner sur
 * le dataset public `public/examples/regression/energy-demand-train.csv` : les modèles des
 * acheteurs restent chiffrés pour eux seuls et ne sont jamais servis ici.
 */

export const MEZO_X402_NETWORKS = { testnet: "eip155:31611" } as const;
export const DEFAULT_X402_FACILITATOR = "https://facilitator.vativ.io";
export const DEFAULT_X402_PRICE = "$0.001";
/** Le facilitateur Mezo règle le prix en dollars en MUSD (18 décimales) sur 31611. */
export const X402_MUSD_ASSET = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";

export interface X402Config {
  network: (typeof MEZO_X402_NETWORKS)["testnet"];
  price: string;
  payTo: Address;
  facilitatorUrl: string;
}

export class X402ConfigError extends Error {}

const PRICE_RE = /^\$(0|[1-9]\d*)(\.\d{1,6})?$/;
const MAX_PRICE_USD = 0.1;

/**
 * Configuration lue dans l'environnement. `null` quand le drapeau `SIRIUS_X402` n'est pas
 * exactement `true` : la route répond alors 404. Lève sur une configuration incohérente
 * plutôt que d'encaisser vers une mauvaise adresse.
 */
export function readX402Config(env: Record<string, string | undefined> = process.env): X402Config | null {
  if (env.SIRIUS_X402?.trim() !== "true") return null;
  const network = (env.EVM_NETWORK ?? env.NEXT_PUBLIC_EVM_NETWORK)?.trim();
  if (network !== "testnet") throw new X402ConfigError("x402 n'est ouvert que sur le testnet Mezo");

  const payTo = env.SIRIUS_X402_PAY_TO?.trim() ?? "";
  if (!isAddress(payTo, { strict: false }) || /^0x0{40}$/i.test(payTo)) {
    throw new X402ConfigError("SIRIUS_X402_PAY_TO doit être une adresse EVM");
  }

  const price = env.SIRIUS_X402_PRICE?.trim() || DEFAULT_X402_PRICE;
  if (!PRICE_RE.test(price) || Number(price.slice(1)) <= 0 || Number(price.slice(1)) > MAX_PRICE_USD) {
    throw new X402ConfigError(`SIRIUS_X402_PRICE doit être un montant en dollars entre $0.000001 et $${MAX_PRICE_USD}`);
  }

  const facilitatorUrl = env.SIRIUS_X402_FACILITATOR?.trim() || DEFAULT_X402_FACILITATOR;
  let url: URL;
  try {
    url = new URL(facilitatorUrl);
  } catch {
    throw new X402ConfigError("SIRIUS_X402_FACILITATOR doit être une URL https");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new X402ConfigError("SIRIUS_X402_FACILITATOR doit être une URL https");

  return { network: MEZO_X402_NETWORKS.testnet, price, payTo: getAddress(payTo), facilitatorUrl: url.origin };
}

let cachedModel: DownloadedModel | null = null;

/** Modèle de démonstration servi par l'API, validé comme un modèle livré. */
export function x402DemoModel(): DownloadedModel {
  cachedModel ??= parseDownloadedModel(demoModel);
  return cachedModel;
}

export class X402InputError extends Error {}

const MAX_ABS_FEATURE = 1e9;

/**
 * Valeurs d'entrée d'une prédiction : exactement les colonnes du modèle, des nombres finis.
 * Une entrée refusée répond 400, et un 400 n'est jamais facturé.
 */
export function parseFeatureValues(body: unknown, model: DownloadedModel): Record<string, number> {
  const features = (body as { features?: unknown } | null)?.features;
  if (!features || typeof features !== "object" || Array.isArray(features)) {
    throw new X402InputError(`Corps attendu : { "features": { ${model.features.map((f) => `"${f}": <nombre>`).join(", ")} } }`);
  }
  const record = features as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !model.features.includes(key));
  if (unknownKeys.length > 0) throw new X402InputError(`Colonnes inconnues : ${unknownKeys.slice(0, 5).join(", ")}`);
  const values: Record<string, number> = {};
  for (const feature of model.features) {
    const value = record[feature];
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_ABS_FEATURE) {
      throw new X402InputError(`Valeur numérique attendue pour « ${feature} »`);
    }
    values[feature] = value;
  }
  return values;
}

/** Une heure plausible (18 h, jour ouvré d'hiver, pic du soir) pour l'exemple public. */
const EXAMPLE_HOUR: Record<string, number> = {
  hour: 18, temperature_c: 4.5, humidity_pct: 70, wind_kmh: 12, cloud_cover_pct: 60,
  is_weekend: 0, is_holiday: 0, solar_kw: 0, morning_peak: 0, evening_peak: 1,
};

/** Description publique et gratuite de l'API (GET), pour qu'un agent sache quoi envoyer et combien ça coûte. */
export function x402Description(config: X402Config, model: DownloadedModel) {
  return {
    protocol: "x402",
    version: 2,
    endpoint: "POST /api/x402/predict",
    price: config.price,
    asset: { symbol: "MUSD", address: X402_MUSD_ASSET, decimals: 18 },
    network: config.network,
    payTo: config.payTo,
    facilitator: config.facilitatorUrl,
    settlement: "Paid only when the prediction succeeds. Direct MUSD transfer, no escrow, no refund.",
    model: {
      name: "Hourly energy demand (demo)",
      algo: model.algo,
      target: model.target,
      features: model.features,
      metrics: model.metrics,
      trainedOn: "public/examples/regression/energy-demand-train.csv",
    },
    example: { features: Object.fromEntries(model.features.map((f) => [f, EXAMPLE_HOUR[f] ?? 0])) },
  };
}
