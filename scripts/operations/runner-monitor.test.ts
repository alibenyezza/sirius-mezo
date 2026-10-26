import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateBudgetReport, writeBudgetReport } from "./runner-monitor";
import { budgetAlerts } from "./supervisor.mjs";

const wallet = `0x${"12".repeat(20)}`;
const check = { canQuote: false, expired: true, circuitOpen: false, incompleteJobs: 0, pendingTransactions: [], remainingUsd: "0" };

test("le superviseur accepte un budget épuisé mais refuse une identité ou une date étrangère", () => {
  const now = Date.now();
  const report = { version: 1, chainId: 31611, wallet, observedAtMs: now, check };
  assert.equal(validateBudgetReport(report, 31611, wallet, now), report);
  for (const change of [{ chainId: 31612 }, { wallet: `0x${"34".repeat(20)}` }, { observedAtMs: now - 60_001 }, { observedAtMs: now + 30_001 }]) {
    assert.throws(() => validateBudgetReport({ ...report, ...change }, 31611, wallet, now));
  }
  assert.equal(budgetAlerts(check, now + 30_001, now).alerts[0].code, "budget-report-stale");
});

test("le rapport privé conserve sa date réelle lors d’un remplacement atomique", () => {
  const root = mkdtempSync(join(tmpdir(), "sirius-monitor-"));
  try {
    const path = join(root, "budget.json");
    writeBudgetReport(path, { observedAtMs: 1, check });
    writeBudgetReport(path, { observedAtMs: 2, check });
    assert.equal(JSON.parse(readFileSync(path, "utf8")).observedAtMs, 2);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
