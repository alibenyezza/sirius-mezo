import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { REQUIRED_SUPPLIERS, supplierReadiness } from "./supplier-limits.mjs";

const doc = JSON.parse(readFileSync(new URL("../../deploy/operations/supplier-limits.json", import.meta.url), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const NOW = Date.parse("2026-10-01");
const verify = (supplier, overrides = {}) => Object.assign(supplier.dashboard, { verifiedAt: "2026-09-30", verifiedBy: "Ali",
  observedMode: "prépayé", autoRecharge: false, capConfigured: true, ...overrides });

test("la fiche versionnée couvre tous les fournisseurs et n'en déclare aucun vérifié", () => {
  const report = supplierReadiness(doc, NOW);
  assert.deepEqual(report.suppliers.map((s) => s.id).sort(), [...REQUIRED_SUPPLIERS].sort());
  assert.equal(report.providerCapsVerified, false);
  assert.ok(report.suppliers.every((s) => s.blockers.includes("tableau de bord non relevé")));
  // Pinata et le VPS restent un risque résiduel même relevés : aucun plafond bloquant connu.
  assert.deepEqual(report.suppliers.filter((s) => s.residualRisk).map((s) => s.id).sort(), ["pinata", "vps"]);
});

test("tous les relevés récents, sans recharge automatique, rendent les plafonds vérifiés", () => {
  const full = clone(doc);
  for (const supplier of full.suppliers) verify(supplier);
  assert.equal(supplierReadiness(full, NOW).providerCapsVerified, true);
});

test("recharge automatique, relevé ancien ou champ manquant bloquent la vérification", () => {
  for (const [overrides, expected] of [
    [{ autoRecharge: true }, "recharge automatique active"],
    [{ verifiedAt: "2026-07-01" }, "relevé du tableau de bord trop ancien"],
    [{ verifiedBy: "" }, "auteur du relevé absent"],
    [{ capConfigured: null }, "plafond ou alerte non relevé"],
  ]) {
    const full = clone(doc);
    for (const supplier of full.suppliers) verify(supplier);
    verify(full.suppliers[0], overrides);
    const report = supplierReadiness(full, NOW);
    assert.equal(report.providerCapsVerified, false);
    assert.ok(report.suppliers[0].blockers.includes(expected), expected);
  }
});

test("un fournisseur manquant ou en double invalide la fiche", () => {
  const missing = clone(doc);
  missing.suppliers = missing.suppliers.filter((s) => s.id !== "github");
  assert.throws(() => supplierReadiness(missing, NOW), /incomplète/);
  const duplicate = clone(doc);
  duplicate.suppliers.push(clone(duplicate.suppliers[0]));
  assert.throws(() => supplierReadiness(duplicate, NOW), /double/);
});
