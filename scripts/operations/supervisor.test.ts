import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { BudgetLedger, initializeBudgetLedger } from "../../src/lib/runner/budget-ledger";
import { syntheticPolicy } from "./accounting-fixture";
import { budgetAlerts, supervisionReport } from "./supervisor.mjs";

const APP = "12".repeat(20);
const NOW = 1_800_000_000_000;
const session = { version: 1, appId: APP, cvmId: "cvm-test", profile: "sirius", startedAt: NOW - 3_600_000, stopAt: NOW + 3_600_000 };
const running = { app_id: APP, status: "running" };
const healthy = { canQuote: true, expired: false, circuitOpen: false, incompleteJobs: 0, pendingTransactions: [], remainingUsd: "1000" };
const codes = (report: { alerts: Array<{ code: string }> }) => report.alerts.map((a) => a.code);

function realCheck(change: (ledger: BudgetLedger) => void = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), "sirius-supervisor-"));
  chmodSync(directory, 0o700);
  const path = join(directory, "ledger.sqlite");
  const policy = syntheticPolicy();
  initializeBudgetLedger(path, policy);
  const ledger = new BudgetLedger(path, policy.chainId, policy.wallet);
  try {
    change(ledger);
    // Même sérialisation que `runner:budget check`.
    return JSON.parse(JSON.stringify({ policy: ledger.policy, ...ledger.diagnostics() },
      (_key, value) => typeof value === "bigint" ? String(value) : value));
  } finally {
    ledger.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("la sortie réelle de runner:budget check est lue : registre sain, puis calcul resté en cours", () => {
  assert.deepEqual(budgetAlerts(realCheck(), NOW, NOW).alerts, []);
  const busy = budgetAlerts(realCheck((ledger) => { ledger.reserve("job", "scope", "training"); }), NOW, NOW);
  assert.deepEqual(busy.alerts.map((a) => a.code), ["incomplete-jobs"]);
  assert.equal(busy.inFlight, true);
});

test("session saine avec contrôle récent : aucun signal", () => {
  const report = supervisionReport({ session, cvm: running, budget: { check: healthy, observedAtMs: NOW - 60_000 }, now: NOW });
  assert.equal(report.level, "ok");
  assert.deepEqual(report.alerts, []);
});

test("échéance dépassée, contrôle absent ou périmé : niveau critique", () => {
  const late = supervisionReport({ session, cvm: running, budget: { check: healthy, observedAtMs: NOW }, now: session.stopAt + 1 });
  assert.equal(late.level, "critical");
  assert.ok(codes(late).includes("deadline-passed"));
  assert.equal(supervisionReport({ session, cvm: running, now: NOW }).level, "critical");
  const stale = supervisionReport({ session, cvm: running, budget: { check: healthy, observedAtMs: NOW - 3_600_000 }, now: NOW });
  assert.deepEqual(codes(stale), ["budget-report-stale"]);
  // CVM arrêtée : l'absence de contrôle n'est plus une alerte.
  assert.equal(supervisionReport({ session, cvm: { ...running, status: "stopped" }, now: NOW }).level, "ok");
});

test("admissions bloquées : avancer l'arrêt sans travail en cours, attendre la réconciliation sinon", () => {
  const blocked = { ...healthy, canQuote: false, circuitOpen: true };
  const idle = supervisionReport({ session, cvm: running, budget: { check: blocked, observedAtMs: NOW }, now: NOW });
  assert.equal(idle.level, "critical");
  assert.match(idle.recommendation, /avancer l'arrêt/);
  const pending = { ...blocked, pendingTransactions: [{ id: "failure:x", ageMs: 600_000, recovery: "attempts-exhausted" }] };
  const busy = supervisionReport({ session, cvm: running, budget: { check: pending, observedAtMs: NOW }, now: NOW });
  assert.match(busy.recommendation, /ne pas arrêter avant réconciliation/);
  assert.ok(codes(busy).includes("pending-attempts-exhausted"));
});

test("un contrôle de budget malformé ou une autre CVM sont refusés", () => {
  assert.throws(() => budgetAlerts({ ...healthy, remainingUsd: 5 }, NOW, NOW), /illisible/);
  assert.throws(() => supervisionReport({ session, cvm: { app_id: "34".repeat(20), status: "running" }, now: NOW }), /Identité CVM/);
});

test("le vrai watchdog, face à une fausse CLI Phala : ne rien faire avant l'échéance, arrêter après, échouer si l'API tombe", {
  skip: process.platform === "win32" ? "permissions POSIX et PATH factice requis" : false,
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "sirius-watchdog-"));
  chmodSync(directory, 0o700);
  try {
    const bin = join(directory, "bin");
    execFileSync("mkdir", ["-m", "700", bin]);
    const calls = join(directory, "calls.log");
    // Fausse `pnpm dlx phala@… cvms <get|stop> …` : journalise l'appel et répond selon $FAKE_STATUS.
    writeFileSync(join(bin, "pnpm"), `#!/bin/sh
echo "$*" >> "${calls}"
[ "$FAKE_STATUS" = "down" ] && exit 1
case "$*" in
  *"cvms get"*) printf '{"data":{"app_id":"${APP}","status":"%s"}}' "$FAKE_STATUS" ;;
  *"cvms stop"*) printf '{"data":{"status":"stopping"}}' ;;
esac
`, { mode: 0o700 });
    const run = (current: { startedAt: number; stopAt: number }, status: string, apply: boolean) => {
      const file = join(directory, `session-${Math.random().toString(16).slice(2)}.json`);
      writeFileSync(file, JSON.stringify({ ...session, ...current }), { mode: 0o600 });
      return spawnSync(process.execPath, [resolve("scripts/operations/phala-watchdog.mjs"), file, ...(apply ? ["--apply-stop"] : [])],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_STATUS: status }, encoding: "utf8" });
    };
    const now = Date.now();
    const future = { startedAt: now - 60_000, stopAt: now + 3_600_000 };
    const past = { startedAt: now - 7_200_000, stopAt: now - 60_000 };

    const early = run(future, "running", true);
    assert.equal(early.status, 0);
    assert.equal(JSON.parse(early.stdout).stopRequested, false);
    assert.doesNotMatch(readFileSync(calls, "utf8"), /cvms stop/);

    const due = run(past, "running", false);
    assert.equal(due.status, 1, "échéance dépassée sans --apply-stop : échec visible");

    const applied = run(past, "running", true);
    assert.equal(applied.status, 0);
    assert.equal(JSON.parse(applied.stdout).stopRequested, true);
    assert.match(readFileSync(calls, "utf8"), /cvms stop cvm-test --profile sirius --json/);

    const down = run(past, "down", true);
    assert.equal(down.status, 1);
    assert.match(down.stderr, /intervention opérateur requise/);
    assert.doesNotMatch(readFileSync(calls, "utf8"), /cvms (start|delete)/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
