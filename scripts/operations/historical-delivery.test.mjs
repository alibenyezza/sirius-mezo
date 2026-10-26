import assert from "node:assert/strict";
import { test } from "node:test";
import { historicalDeliveryInventory } from "./historical-delivery.mjs";

const address = `0x${"12".repeat(20)}`;
const receipt = { version: 2, kind: "loan", loanId: "loan-1", datasetId: "dataset-1", borrower: address,
  modelCid: "cid-1", modelId: "linear_regression", modelVersion: "1.0.0", chainId: 31611,
  escrow: `0x${"34".repeat(20)}`, loanKey: `0x${"56".repeat(32)}` };
const token = `${Buffer.from(JSON.stringify(receipt)).toString("base64url")}.${Buffer.alloc(32).toString("base64url")}`;
const row = { kind: "loan", id: "loan-1", datasetId: "dataset-1", subject: address, cid: "cid-1",
  modelId: receipt.modelId, modelVersion: receipt.modelVersion, chainId: 31611, escrow: receipt.escrow,
  loanKey: receipt.loanKey, status: "SETTLED", receipt: token };

test("l'inventaire distingue cohérence des métadonnées et preuve cryptographique", () => {
  const report = historicalDeliveryInventory([row]);
  assert.equal(report.metadataConsistent, 1);
  assert.equal(report.requiredWallets, 1);
  assert.equal(report.receiptSignaturesVerified, false);
  assert.equal(report.onChainSettlementVerified, false);
  assert.equal(report.modelDecryptionVerified, false);
  assert.ok(!JSON.stringify(report).includes(token));
});

test("l'inventaire refuse scope substitué, reçu absent et prêt non réglé", () => {
  const report = historicalDeliveryInventory([
    { ...row, subject: `0x${"78".repeat(20)}` }, { ...row, chainId: 31612 },
    { ...row, cid: "other" }, { ...row, receipt: null }, { ...row, receipt: "invalid" },
    { ...row, status: "CANCELLED" },
  ]);
  assert.equal(report.metadataConsistent, 0);
  assert.deepEqual(report.results.map((item) => item.state), ["scope-mismatch", "scope-mismatch", "scope-mismatch", "missing-receipt", "invalid-receipt", "not-deliverable"]);
});

test("un ancien reçu sans profil conserve sa limite sans fabriquer une attestation", () => {
  const legacy = { ...receipt };
  delete legacy.modelId;
  delete legacy.modelVersion;
  const encode = (value) => `${Buffer.from(JSON.stringify(value)).toString("base64url")}.${Buffer.alloc(32).toString("base64url")}`;
  const report = historicalDeliveryInventory([{ ...row, receipt: encode(legacy) },
    { ...row, receipt: encode({ ...legacy, version: 3 }) }]);
  assert.equal(report.metadataCompatible, 1);
  assert.equal(report.metadataConsistent, 0);
  assert.equal(report.legacyProfileUnattested, 1);
  assert.equal(report.results[1].state, "scope-mismatch");
  assert.equal(report.receiptSignaturesVerified, false);
});
