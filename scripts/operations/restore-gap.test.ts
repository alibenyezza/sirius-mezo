import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BudgetLedger, initializeBudgetLedger } from "../../src/lib/runner/budget-ledger";
import { syntheticPolicy } from "./accounting-fixture";
import { restoreGap } from "./restore-gap.mjs";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Exercice complet : sauvegarde cohérente, dépenses après la copie, perte du volume, restauration. */
function drill() {
  const directory = mkdtempSync(join(tmpdir(), "sirius-restore-"));
  chmodSync(directory, 0o700);
  const path = join(directory, "ledger.sqlite");
  const backupPath = join(directory, "backup.sqlite");
  const policy = syntheticPolicy();
  initializeBudgetLedger(path, policy);
  const live = new BudgetLedger(path, policy.chainId, policy.wallet);
  const before = { id: "loan:before-backup", fingerprint: "quote-before" };
  live.reserveWorkflow(before, "signed", policy.validUntil, BigInt(policy.gas.totalWei));
  live.reserve("training:before", "input-before", "training", before);
  live.backup(backupPath);

  // Après la copie : le calcul se termine et un nouveau prêt règle une transaction (nonce 9).
  live.finish("training:before", "input-before", true);
  const after = { id: "loan:after-backup", fingerprint: "quote-after" };
  live.reserveWorkflow(after, "signed", policy.validUntil, BigInt(policy.gas.totalWei));
  live.reserve("release:after", "data-after", "transaction", after);
  live.recordTransaction("release:after", "data-after", hash(9), 9, "encrypted");
  live.reserve("request:after", "public", "request");
  const lastKnown = live.accountingExport(Date.now() + 1);
  live.close();

  // Perte du volume : seul le fichier de sauvegarde reste.
  unlinkSync(path);
  const restoredLedger = new BudgetLedger(backupPath, policy.chainId, policy.wallet);
  const restored = restoredLedger.accountingExport();
  restoredLedger.close();
  rmSync(directory, { recursive: true, force: true });
  return { restored, lastKnown };
}

test("un registre restauré depuis une copie ancienne ne peut pas rouvrir : dépenses, devis et nonce postérieurs listés", () => {
  const { restored, lastKnown } = drill();
  const gap = restoreGap(restored, lastKnown);
  assert.equal(gap.reopenAllowed, false);
  assert.deepEqual(gap.missingOperations.map((op) => op.id).sort(), ["release:after", "request:after"]);
  assert.deepEqual(gap.missingWorkflows.map((w: { id: string }) => w.id), ["loan:after-backup"]);
  assert.deepEqual(gap.regressedOperations.map((op) => [op.id, op.restoredState, op.lastKnownState]),
    [["training:before", "reserved", "succeeded"]]);
  assert.deepEqual(gap.consumedNonces, [9]);
  assert.ok(BigInt(gap.allocationGap.usdMicros) > BigInt(0));
  assert.ok(BigInt(gap.allocationGap.wei) > BigInt(0));
  assert.ok(gap.reasons.some((reason) => reason.includes("ne rien re-signer")));
});

test("un registre identique au dernier export n'a aucun écart, sans pour autant prouver être le plus récent", () => {
  const { lastKnown } = drill();
  const gap = restoreGap(lastKnown, lastKnown);
  assert.equal(gap.reopenAllowed, true);
  assert.deepEqual(gap.reasons, []);
  assert.match(gap.note, /ne prouve pas/);
});

test("deux registres contradictoires ou de wallets différents sont signalés, jamais fusionnés", () => {
  const { restored, lastKnown } = drill();
  const forged = clone(lastKnown);
  forged.operations.find((op: { id: string }) => op.id === "training:before")!.fingerprint = "other-input";
  const gap = restoreGap(restored, forged);
  assert.deepEqual(gap.conflictingOperations.map((op) => op.id), ["training:before"]);
  assert.equal(gap.reopenAllowed, false);
  const otherWallet = clone(lastKnown);
  otherWallet.wallet = `0x${"34".repeat(20)}`;
  assert.throws(() => restoreGap(restored, otherWallet), /registres différents/);
});
