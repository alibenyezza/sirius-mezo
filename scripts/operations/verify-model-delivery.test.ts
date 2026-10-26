import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDelegationMessage } from "../../src/lib/runner/authorization-contract";
import { ownedHistoricalModels, validateDeliveryChallenge } from "./verify-model-delivery";

const address = `0x${"12".repeat(20)}`;
const origin = "https://sirius.example";
const sessionPublicKey = "synthetic-session-public-key";

test("la récupération ne signe qu'un challenge d'authentification du compte, domaine, réseau et session attendus", () => {
  const now = Date.now();
  const fields = { origin, address, sessionPublicKey, network: "testnet", issuedAt: now, expiresAt: now + 60000, challengeToken: "body.signature" };
  assert.deepEqual(validateDeliveryChallenge(buildDelegationMessage(fields), origin, address, sessionPublicKey, now), fields);
  for (const change of [{ origin: "https://other.example" }, { address: `0x${"34".repeat(20)}` },
    { network: "mainnet" }, { sessionPublicKey: "other-session" }, { expiresAt: now - 1 },
    { expiresAt: now + 8 * 86400000 }, { issuedAt: now + 60000 }]) {
    assert.throws(() => validateDeliveryChallenge(buildDelegationMessage({ ...fields, ...change }), origin, address, sessionPublicKey, now));
  }
  assert.throws(() => validateDeliveryChallenge("Approve spending", origin, address, sessionPublicKey, now));
});

test("la récupération limite les opérations aux modèles historiques du wallet", () => {
  const model = { kind: "loan", id: "loan-1", subject: address, state: "metadata-consistent" };
  assert.deepEqual(ownedHistoricalModels({ results: [model, { ...model, subject: `0x${"34".repeat(20)}` }] }, address), [model]);
  for (const change of [{ kind: "run-training" }, { id: "../other" }, { state: "not-deliverable" }]) {
    assert.throws(() => ownedHistoricalModels({ results: [{ ...model, ...change }] }, address));
  }
});
