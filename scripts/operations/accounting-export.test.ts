import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildSyntheticExport } from "./accounting-fixture";
import { allocationCheck, shapeSignature, validateAccountingExport } from "./accounting-export.mjs";

const committed = JSON.parse(readFileSync(new URL("./fixtures/runner-accounting-export.v1.json", import.meta.url), "utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("l'export frais du vrai registre respecte le contrat et garde la même structure que l'exemple versionné", () => {
  const fresh = buildSyntheticExport();
  validateAccountingExport(fresh);
  validateAccountingExport(committed);
  // Échoue si A1 ajoute, retire ou retype un champ : régénérer l'exemple et relire la comptabilité.
  assert.equal(shapeSignature(fresh), shapeSignature(committed));
  assert.deepEqual(fresh.workflows.map((w) => w.checkpoint).sort(),
    ["failure-measured", "not-started", "result-durable", "uncertain"]);
  assert.deepEqual(fresh.pendingTransactions.map((t) => t.recovery), ["journal-missing"]);
});

test("les budgets des devis plus les opérations hors devis rejoignent exactement le total alloué", () => {
  for (const doc of [buildSyntheticExport(), committed]) {
    const check = allocationCheck(validateAccountingExport(doc));
    assert.equal(check.usdMicros.matches, true);
    assert.equal(check.wei.matches, true);
  }
});

test("un écart d'allocation est rapporté sans être corrigé ni masqué", () => {
  const doc = clone(committed);
  doc.totals.allocatedUsdMicros = String(BigInt(doc.totals.allocatedUsdMicros) + BigInt(5));
  const check = allocationCheck(validateAccountingExport(doc));
  assert.equal(check.usdMicros.matches, false);
  assert.equal(check.usdMicros.difference, "5");
});

test("champ inconnu, champ absent, montant décimal ou nature inconnue sont refusés avec leur chemin", () => {
  const cases: Array<[(doc: typeof committed) => void, RegExp]> = [
    [(doc) => { doc.totals.newField = "1"; }, /export\.totals\.newField : champ inconnu/],
    [(doc) => { delete doc.operations[0].budgetWei; }, /export\.operations\[0\]\.budgetWei : champ absent/],
    [(doc) => { doc.operations[0].budgetUsdMicros = "1.5"; }, /export\.operations\[0\]\.budgetUsdMicros/],
    [(doc) => { doc.operations[0].kind = "refund"; }, /export\.operations\[0\]\.kind/],
    [(doc) => { doc.version = 2; }, /export\.version/],
    [(doc) => { doc.operations[1].id = doc.operations[0].id; }, /identifiant en double/],
  ];
  for (const [change, expected] of cases) {
    const doc = clone(committed);
    change(doc);
    assert.throws(() => validateAccountingExport(doc), expected);
  }
});

test("une mesure absente n'est jamais acceptée comme consommation nulle d'un calcul terminé", () => {
  const doc = clone(committed);
  const durable = doc.workflows.find((w: { checkpoint: string }) => w.checkpoint === "result-durable");
  durable.measurement = null;
  assert.throws(() => validateAccountingExport(doc), /mesure réussie attendue/);
});

test("une transaction en attente doit correspondre à une opération de transaction encore réservée", () => {
  const doc = clone(committed);
  doc.pendingTransactions[0].id = "request:standalone";
  assert.throws(() => validateAccountingExport(doc), /transaction réservée exportée attendue/);
  const orphan = clone(committed);
  orphan.operations.find((o: { workflowId: string | null }) => o.workflowId !== null).workflowId = "loan:unknown";
  assert.throws(() => validateAccountingExport(orphan), /workflow exporté ou null attendu/);
});

test("le message d'erreur ne recopie aucune valeur de l'export", () => {
  const doc = clone(committed);
  doc.accountingReference = "";
  doc.wallet = "SECRET_NOT_AN_ADDRESS";
  assert.throws(() => validateAccountingExport(doc), (error: Error) => !error.message.includes("SECRET_"));
});
