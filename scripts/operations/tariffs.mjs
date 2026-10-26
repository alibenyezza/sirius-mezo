// A2.3 — Tarifs proposés et financement des essais, en entiers.
// Transforme la proposition versionnée en montants USDC atomiques au format exact de
// `RUNNER_BILLING_POLICY_FILE` (src/lib/billing/config.ts). La politique n'est produite que si
// tous les bloqueurs sont levés : proposition et politique approuvée restent distinctes.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { estimatePlan } from "./costs.mjs";

const PROFILES = ["linear_regression", "logistic_regression"];
const amount = (value) => typeof value === "string" && /^(0|[1-9][0-9]{0,28})$/.test(value);
const int = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const ceilDiv = (value, divisor) => (value + divisor - 1n) / divisor;
const MICROS = 1_000_000n;
const MS_PER_HOUR = 3_600_000n;

/** Micro-USD → unités atomiques d'un token à `decimals` décimales, en supposant 1 USDC = 1 USD. */
export function usdMicrosToAtomic(usdMicros, decimals, rounding) {
  const scale = 10n ** BigInt(decimals);
  const numerator = BigInt(usdMicros) * scale;
  return rounding === "ceil" ? ceilDiv(numerator, MICROS) : numerator / MICROS;
}

export function validateProposal(p) {
  const ok = p && p.version === 1 && ["proposed", "approved"].includes(p.status)
    && Array.isArray(p.approval?.approvedBy) && amount(p.minimumComputeUsdMicros) && BigInt(p.minimumComputeUsdMicros) > 0n
    && amount(p.currency?.usdPerUsdcLowerBoundMicros) && amount(p.currency?.usdPerUsdcUpperBoundMicros)
    && BigInt(p.currency.usdPerUsdcLowerBoundMicros) <= MICROS && BigInt(p.currency.usdPerUsdcUpperBoundMicros) >= MICROS
    && amount(p.fixedCostCoverage?.monthlyFixedUsdMicros) && amount(p.fixedCostCoverage?.variableUsdMicrosPerAttempt)
    && int(p.fixedCostCoverage?.successesPerMonth, 1) && int(p.fixedCostCoverage?.attemptsPerMonth, p.fixedCostCoverage?.successesPerMonth)
    && int(p.fixedCostCoverage?.bufferPercent, 0, 500)
    && p.failurePolicy?.rule === "consumed-execution-only" && p.failurePolicy?.rounding === "floor"
    && amount(p.trialFunding?.proposedEnvelopeUsdMicros) && Array.isArray(p.stopScenarios) && p.stopScenarios.length > 0
    && PROFILES.every((id) => int(p.profiles?.[id]?.maxExecutionMs, 1000, 30000) && typeof p.profiles[id].phalaCalibrated === "boolean");
  if (!ok) throw new Error("Proposition tarifaire invalide");
  return p;
}

/**
 * @param {object} proposal  deploy/operations/tariff-proposal.json
 * @param {object} plan      deploy/operations/testnet-plan.json
 * @param {{ usdc?: string, usdcDecimals: number, now?: number }} token
 */
export function tariffReport(proposal, plan, token) {
  const p = validateProposal(proposal);
  const costs = estimatePlan(plan);
  const now = token.now ?? Date.now();
  if (!int(token.usdcDecimals, 6, 30)) throw new Error("Décimales du token à lire sur le contrat (6 à 30)");
  const decimals = token.usdcDecimals;

  // Couverture des frais fixes : (base mensuelle + tentatives × coût variable) × (1 + coussin) / réussites.
  const c = p.fixedCostCoverage;
  const monthly = BigInt(c.monthlyFixedUsdMicros) + BigInt(c.attemptsPerMonth) * BigInt(c.variableUsdMicrosPerAttempt);
  const perSuccess = ceilDiv(monthly * BigInt(100 + c.bufferPercent), BigInt(100 * c.successesPerMonth));
  const minimum = BigInt(p.minimumComputeUsdMicros);

  // Tarif d'exécution en échec : coût de calcul Phala à la milliseconde, arrondi vers le bas, sans marge.
  const computePerHour = BigInt(plan.computeUsdMicrosPerHour);
  const rateAtomicPerMs = computePerHour * 10n ** BigInt(decimals) / (MICROS * MS_PER_HOUR);
  const minimumAtomic = usdMicrosToAtomic(minimum, decimals, "ceil");

  const profiles = Object.fromEntries(PROFILES.map((id) => {
    const profile = p.profiles[id];
    const maxFailureFee = rateAtomicPerMs * BigInt(profile.maxExecutionMs);
    const activeCostCeiling = ceilDiv(computePerHour * BigInt(profile.maxExecutionMs), MS_PER_HOUR);
    return [id, {
      computeAmount: String(minimumAtomic), maxFailureFee: String(maxFailureFee),
      executionRateAtomicPerMs: String(rateAtomicPerMs), maxExecutionMs: profile.maxExecutionMs,
      activeComputeCostAtMaxDurationUsdMicros: String(activeCostCeiling),
      failureFeeCoversNothing: rateAtomicPerMs === 0n, phalaCalibrated: profile.phalaCalibrated,
    }];
  }));

  const blockers = [];
  if (!p.approval.approvedBy.includes("Ali") || !p.approval.approvedBy.includes("Ali")) blockers.push("approbation Ali et Ali manquante");
  if (typeof p.approval.approvedAt !== "string") blockers.push("date d'approbation manquante");
  if (!int(p.approval.validUntil) || p.approval.validUntil <= now) blockers.push("fin de validité absente ou passée");
  if (p.status !== "approved") blockers.push("statut encore proposé");
  if (!p.trialFunding.fundingSource) blockers.push("source de financement des essais non désignée");
  if (!p.trialFunding.approved) blockers.push("enveloppe d'essai non approuvée");
  for (const id of PROFILES) if (!p.profiles[id].phalaCalibrated) blockers.push(`profil ${id} non calibré sur la CVM`);
  if (!plan.providerCapsVerified) blockers.push("plafonds fournisseurs non vérifiés");
  if (!plan.phalaBenchmarkVerified) blockers.push("benchmark Phala non vérifié");
  if (!token.usdc || !/^0x[0-9a-f]{40}$/.test(token.usdc)) blockers.push("adresse du token USDC absente");
  if (minimum < perSuccess) blockers.push("minimum inférieur au coût par réussite des hypothèses");
  for (const id of PROFILES) {
    if (BigInt(profiles[id].maxFailureFee) > BigInt(profiles[id].computeAmount)) blockers.push(`retenue maximale ${id} supérieure au prix`);
  }

  const billingPolicy = blockers.length ? null : {
    version: 1, tariffVersion: `tarif-${p.approval.approvedAt}`, costReference: "deploy/operations/tariff-proposal.json",
    validUntil: p.approval.validUntil, chainId: plan.chainId, usdc: token.usdc, usdcDecimals: decimals,
    computeRecipient: plan.computeRecipient, minimumComputeAmount: String(minimumAtomic),
    profiles: Object.fromEntries(PROFILES.map((id) => [id, { computeAmount: profiles[id].computeAmount,
      maxFailureFee: profiles[id].maxFailureFee, executionRateAtomicPerMs: profiles[id].executionRateAtomicPerMs,
      maxExecutionMs: profiles[id].maxExecutionMs }])),
  };

  return {
    status: p.status, readyForRunner: billingPolicy !== null, blockers,
    currency: { usdcDecimals: decimals, usdPerUsdcLowerBoundMicros: p.currency.usdPerUsdcLowerBoundMicros,
      usdPerUsdcUpperBoundMicros: p.currency.usdPerUsdcUpperBoundMicros },
    coverage: { monthlyCostUsdMicros: String(monthly), costPerSuccessWithBufferUsdMicros: String(perSuccess),
      minimumComputeUsdMicros: String(minimum), minimumCoversCost: minimum >= perSuccess,
      marginAtAssumedVolumeUsdMicros: String((minimum - perSuccess) * BigInt(c.successesPerMonth)) },
    profiles,
    trial: { ...costs.trial, proposedEnvelopeUsdMicros: p.trialFunding.proposedEnvelopeUsdMicros,
      fundingSource: p.trialFunding.fundingSource, approved: p.trialFunding.approved, providerEnforced: p.trialFunding.providerEnforced },
    stopScenarios: p.stopScenarios,
    billingPolicy,
    note: "Proposition de travail : ni prix accepté par un client, ni marge acquise. La politique n'est produite qu'après levée de tous les bloqueurs ; son installation reste une opération de Ali.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
    const files = args.filter((arg) => !arg.startsWith("--"));
    if (files.length > 2 || args.some((arg) => arg.startsWith("--") && !/^--(usdc|decimals|require-ready)(=|$)/.test(arg))) throw new Error();
    const proposal = JSON.parse(readFileSync(files[0] || "deploy/operations/tariff-proposal.json", "utf8"));
    const plan = JSON.parse(readFileSync(files[1] || proposal.costPlan, "utf8"));
    const decimals = Number(option("decimals"));
    const report = tariffReport(proposal, plan, { usdc: option("usdc")?.toLowerCase(), usdcDecimals: decimals });
    console.log(JSON.stringify(report, null, 2));
    if (args.includes("--require-ready") && !report.readyForRunner) process.exitCode = 1;
  } catch {
    console.error("Calcul tarifaire refusé : vérifier la proposition, le plan de coûts et --decimals lues sur le contrat du token.");
    process.exitCode = 1;
  }
}
