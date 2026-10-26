import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { estimatePlan, estimateScenario, estimateTrial } from "./costs.mjs";

const plan = { diskGb: 20, computeUsdMicrosPerHour: "58000", diskUsdMicrosPerGbHour: "139" };
test("les coûts incluent le disque arrêté et n’allouent les frais fixes qu’une fois", () => {
  const result = estimateScenario(plan, { name: "session", runningHours: 2, retentionHours: 720, successfulJobs: 10 });
  assert.equal(result.computeUsdMicros, "116000");
  assert.equal(result.storageUsdMicros, "2001600");
  assert.equal(result.totalPhalaUsdMicros, "2117600");
  assert.equal(result.breakEvenPhalaPerSuccessUsdMicros, "211760");
  assert.equal(result.minimumWith25PercentBufferUsdCents, "27");
});
test("une période sans vente n’a aucun prix capable d’en couvrir les coûts", () => {
  const result = estimateScenario(plan, { runningHours: 0, retentionHours: 720, successfulJobs: 0 });
  assert.equal(result.totalPhalaUsdMicros, "2001600");
  assert.equal(result.breakEvenPhalaPerSuccessUsdMicros, null);
  assert.equal(result.minimumWith25PercentBufferUsdCents, null);
});

const draft = JSON.parse(readFileSync(new URL("../../deploy/operations/testnet-plan.json", import.meta.url), "utf8"));

test("les essais provisionnent chaque délai d'arrêt et tout le disque conservé", () => {
  const result = estimateTrial(draft);
  assert.equal(result.plannedComputeUsdMicros, "1160000");
  assert.equal(result.stopDelayReserveUsdMicros, "48340");
  assert.equal(result.storageUsdMicros, "2001600");
  assert.equal(result.provisionPhalaUsdMicros, "3209940");
  assert.equal(result.provisionWith25PercentBufferUsdCents, "402");
  assert.equal(result.proposedBudgetCoversProvision, true);
  assert.equal(estimateTrial({ ...draft, trial: { ...draft.trial, proposedPhalaBudgetUsdMicros: "4019999" } }).proposedBudgetCoversProvision, false);
});

test("un budget proposé ou des liquidités ne deviennent ni approbation ni marge acquise", () => {
  const result = estimatePlan({ ...draft, cashUsdMicros: "5000000", providerCapsVerified: true });
  assert.equal(result.activationReady, false);
  assert.equal(result.commercialTariffReady, false);
  assert.equal(result.trial.approved, false);
  assert.equal(result.trial.providerEnforced, false);
  assert.equal(result.strictRunnerCeilingBeforeReservesUsdMicros, "0");
  assert.equal(result.scope, "Phala");
  assert.ok(result.excluded.includes("Neon"));
});

test("refuse les tarifs absents, nombres imprécis et sessions dépassant la période", () => {
  for (const value of [null, "", "-1", 58000, "0.058", "1e6", " 58000", "9".repeat(30)]) {
    assert.throws(() => estimateTrial({ ...draft, computeUsdMicrosPerHour: value }));
  }
  for (const trial of [
    { ...draft.trial, sessions: 0 },
    { ...draft.trial, sessions: Number.MAX_SAFE_INTEGER + 1 },
    { ...draft.trial, minutesPerSession: 1.5 },
    { ...draft.trial, stopDelayMinutesPerSession: -1 },
    { ...draft.trial, minutesPerSession: 1441 },
    { ...draft.trial, sessions: 500 },
    { ...draft.trial, proposedPhalaBudgetUsdMicros: null },
  ]) assert.throws(() => estimateTrial({ ...draft, trial }));
  assert.throws(() => estimatePlan({ ...draft, version: 99 }));
  assert.throws(() => estimatePlan({ ...draft, chainId: 31612 }));
});
