import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { tariffReport, usdMicrosToAtomic } from "./tariffs.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
const proposal = read("deploy/operations/tariff-proposal.json");
const plan = read("deploy/operations/testnet-plan.json");
const USDC = `0x${"ab".repeat(20)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

test("la proposition versionnée reproduit le coût par réussite du business plan et reste non utilisable", () => {
  const report = tariffReport(proposal, plan, { usdc: USDC, usdcDecimals: 18 });
  // 150 USD + 34 × 0,10 USD = 153,40 USD, coussin 25 %, 30 réussites : 6,391667 USD, soit 6,40 au centime.
  assert.equal(report.coverage.monthlyCostUsdMicros, "153400000");
  assert.equal(report.coverage.costPerSuccessWithBufferUsdMicros, "6391667");
  assert.equal(report.coverage.minimumCoversCost, true);
  assert.equal(report.readyForRunner, false);
  assert.equal(report.billingPolicy, null);
  for (const expected of ["approbation Ali et Ali manquante", "source de financement des essais non désignée",
    "profil linear_regression non calibré sur la CVM", "plafonds fournisseurs non vérifiés"]) {
    assert.ok(report.blockers.includes(expected), expected);
  }
  assert.equal(report.trial.approved, false);
  assert.equal(report.trial.providerEnforced, false);
});

test("les montants suivent les décimales lues sur le token, prix arrondi vers le haut et retenue vers le bas", () => {
  const eighteen = tariffReport(proposal, plan, { usdc: USDC, usdcDecimals: 18 });
  assert.equal(eighteen.profiles.linear_regression.computeAmount, "7000000000000000000");
  // 0,058 USD/h = 16 111 111 111 unités atomiques par milliseconde (18 décimales), arrondi vers le bas.
  assert.equal(eighteen.profiles.linear_regression.executionRateAtomicPerMs, "16111111111");
  assert.equal(eighteen.profiles.linear_regression.maxFailureFee, String(16111111111n * 30000n));
  const six = tariffReport(proposal, plan, { usdc: USDC, usdcDecimals: 6 });
  assert.equal(six.profiles.logistic_regression.computeAmount, "7000000");
  // Avec 18 décimales le tarif à la milliseconde s'arrondit à 0 : aucune retenue plutôt qu'une retenue gonflée.
  assert.equal(six.profiles.logistic_regression.executionRateAtomicPerMs, "0");
  assert.equal(six.profiles.logistic_regression.failureFeeCoversNothing, true);
  assert.equal(usdMicrosToAtomic("1", 6, "ceil"), 1n);
  assert.equal(usdMicrosToAtomic("1", 18, "floor"), 1000000000000n);
  assert.throws(() => tariffReport(proposal, plan, { usdc: USDC, usdcDecimals: Number.NaN }), /Décimales/);
});

test("la politique runner n'est produite qu'après approbation, financement, calibration et plafonds vérifiés", () => {
  const approved = clone(proposal);
  approved.status = "approved";
  approved.approval = { approvedBy: ["Ali", "Ali"], approvedAt: "2026-10-01", validUntil: 1_900_000_000_000 };
  approved.trialFunding.fundingSource = "apport fondateurs";
  approved.trialFunding.approved = true;
  for (const id of ["linear_regression", "logistic_regression"]) approved.profiles[id].phalaCalibrated = true;
  const verifiedPlan = { ...clone(plan), providerCapsVerified: true, phalaBenchmarkVerified: true };
  const report = tariffReport(approved, verifiedPlan, { usdc: USDC, usdcDecimals: 18, now: 1_800_000_000_000 });
  assert.deepEqual(report.blockers, []);
  const policy = report.billingPolicy;
  // Format exact attendu par src/lib/billing/config.ts.
  assert.deepEqual(Object.keys(policy).sort(), ["chainId", "computeRecipient", "costReference", "minimumComputeAmount", "profiles",
    "tariffVersion", "usdc", "usdcDecimals", "validUntil", "version"]);
  assert.equal(policy.chainId, 31611);
  assert.equal(policy.computeRecipient, plan.computeRecipient);
  assert.equal(policy.profiles.linear_regression.maxExecutionMs, 30000);
  // Une seule condition manquante suffit à bloquer.
  const expired = tariffReport(approved, verifiedPlan, { usdc: USDC, usdcDecimals: 18, now: 1_950_000_000_000 });
  assert.equal(expired.billingPolicy, null);
  assert.deepEqual(expired.blockers, ["fin de validité absente ou passée"]);
  const oneSigner = clone(approved);
  oneSigner.approval.approvedBy = ["Ali"];
  assert.equal(tariffReport(oneSigner, verifiedPlan, { usdc: USDC, usdcDecimals: 18, now: 1_800_000_000_000 }).billingPolicy, null);
});

test("un minimum inférieur au coût par réussite est signalé comme bloqueur", () => {
  const low = clone(proposal);
  low.minimumComputeUsdMicros = "6000000";
  const report = tariffReport(low, plan, { usdc: USDC, usdcDecimals: 18 });
  assert.equal(report.coverage.minimumCoversCost, false);
  assert.ok(report.blockers.includes("minimum inférieur au coût par réussite des hypothèses"));
});

test("une proposition incohérente est refusée en bloc", () => {
  for (const change of [
    (p) => { p.failurePolicy.rounding = "ceil"; },
    (p) => { p.profiles.linear_regression.maxExecutionMs = 60000; },
    (p) => { p.currency.usdPerUsdcLowerBoundMicros = "1100000"; },
    (p) => { p.fixedCostCoverage.attemptsPerMonth = 10; },
    (p) => { p.stopScenarios = []; },
  ]) {
    const bad = clone(proposal);
    change(bad);
    assert.throws(() => tariffReport(bad, plan, { usdc: USDC, usdcDecimals: 18 }), /Proposition tarifaire invalide/);
  }
});
