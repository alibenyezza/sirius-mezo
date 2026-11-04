import assert from "node:assert/strict";
import { test } from "node:test";
import { predictModel } from "@/lib/models/predict";
import {
  DEFAULT_X402_FACILITATOR,
  parseFeatureValues,
  readX402Config,
  X402ConfigError,
  X402InputError,
  x402DemoModel,
  x402Description,
} from "./config";

const PAY_TO = "0xf1b3c80ff7ffa2d6f609d51dc5483e8e8da036c1";
const base = { SIRIUS_X402: "true", EVM_NETWORK: "testnet", SIRIUS_X402_PAY_TO: PAY_TO };

test("x402 : fermé sans le drapeau exact", () => {
  assert.equal(readX402Config({}), null);
  assert.equal(readX402Config({ ...base, SIRIUS_X402: "1" }), null);
  assert.equal(readX402Config({ ...base, SIRIUS_X402: "TRUE" }), null);
});

test("x402 : configuration par défaut sur le testnet Mezo", () => {
  const config = readX402Config(base);
  assert.deepEqual(config, {
    network: "eip155:31611",
    price: "$0.001",
    payTo: "0xF1b3C80fF7ffa2D6f609D51dC5483e8e8da036c1",
    facilitatorUrl: DEFAULT_X402_FACILITATOR,
  });
});

test("x402 : refuse le mainnet, une adresse absente ou nulle, un prix hors bornes, un facilitateur non https", () => {
  for (const env of [
    { ...base, EVM_NETWORK: "mainnet" },
    { ...base, EVM_NETWORK: undefined },
    { ...base, SIRIUS_X402_PAY_TO: "" },
    { ...base, SIRIUS_X402_PAY_TO: "0x0000000000000000000000000000000000000000" },
    { ...base, SIRIUS_X402_PAY_TO: "pas-une-adresse" },
    { ...base, SIRIUS_X402_PRICE: "0.001" },
    { ...base, SIRIUS_X402_PRICE: "$0" },
    { ...base, SIRIUS_X402_PRICE: "$1" },
    { ...base, SIRIUS_X402_PRICE: "$0.0000001" },
    { ...base, SIRIUS_X402_FACILITATOR: "http://facilitator.vativ.io" },
    { ...base, SIRIUS_X402_FACILITATOR: "https://user:pw@facilitator.vativ.io" },
  ]) {
    assert.throws(() => readX402Config(env), X402ConfigError, JSON.stringify(env));
  }
  assert.equal(readX402Config({ ...base, SIRIUS_X402_PRICE: "$0.05" })?.price, "$0.05");
});

test("x402 : le modèle de démonstration est un modèle livré valide, avec ses métriques", () => {
  const model = x402DemoModel();
  assert.equal(model.algo, "linear_regression");
  assert.equal(model.target, "energy_mwh");
  assert.equal(model.features.length, 10);
  assert.equal(model.coefficients.length, model.features.length + 1);
  assert.ok("r2" in model.metrics && model.metrics.r2 > 0.9);
});

test("x402 : entrées exactes, sinon 400 (jamais facturé)", () => {
  const model = x402DemoModel();
  const features = Object.fromEntries(model.features.map((f) => [f, 1]));
  assert.deepEqual(parseFeatureValues({ features }, model), features);
  const { hour: _hour, ...missing } = features;
  for (const body of [null, {}, { features: [] }, { features: missing }, { features: { ...features, extra: 1 } },
    { features: { ...features, hour: "18" } }, { features: { ...features, hour: Number.NaN } }, { features: { ...features, hour: 1e12 } }]) {
    assert.throws(() => parseFeatureValues(body, model), X402InputError, JSON.stringify(body));
  }
});

test("x402 : une prédiction plausible pour une soirée d'hiver en semaine", () => {
  const model = x402DemoModel();
  const prediction = predictModel(model, parseFeatureValues({ features: {
    hour: 18, temperature_c: 4.5, humidity_pct: 70, wind_kmh: 12, cloud_cover_pct: 60,
    is_weekend: 0, is_holiday: 0, solar_kw: 0, morning_peak: 0, evening_peak: 1,
  } }, model));
  assert.equal(prediction.algo, "linear_regression");
  assert.ok(prediction.algo === "linear_regression" && prediction.value > 0 && prediction.value < 1_000);
});

test("x402 : la description publique donne le prix, l'actif, le réseau et un exemple complet", () => {
  const config = readX402Config(base)!;
  const description = x402Description(config, x402DemoModel());
  assert.equal(description.price, "$0.001");
  assert.equal(description.asset.address, "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503");
  assert.equal(description.network, "eip155:31611");
  assert.deepEqual(Object.keys(description.example.features), x402DemoModel().features);
});
