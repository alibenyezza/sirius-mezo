import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const amount = (value) => typeof value === "string" && /^(0|[1-9][0-9]{0,28})$/.test(value);
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const ceilDiv = (value, divisor) => (value + divisor - 1n) / divisor;

function validateRates(plan) {
  if (!integer(plan.diskGb, 20) || !amount(plan.computeUsdMicrosPerHour) || !amount(plan.diskUsdMicrosPerGbHour)) {
    throw new Error("Tarifs Phala invalides");
  }
}

export function estimateScenario(plan, scenario) {
  validateRates(plan);
  if (![plan.diskGb, scenario.retentionHours, scenario.runningHours, scenario.successfulJobs].every(Number.isSafeInteger)
    || scenario.runningHours < 0 || scenario.retentionHours < scenario.runningHours || scenario.successfulJobs < 0) {
    throw new Error("Hypothèses de coûts invalides");
  }
  const compute = BigInt(plan.computeUsdMicrosPerHour) * BigInt(scenario.runningHours);
  const storage = BigInt(plan.diskUsdMicrosPerGbHour) * BigInt(plan.diskGb) * BigInt(scenario.retentionHours);
  if (compute < 0n || storage < 0n) throw new Error("Coûts négatifs refusés");
  const jobs = BigInt(scenario.successfulJobs);
  const total = compute + storage;
  const perJob = jobs === 0n ? null : String(ceilDiv(total, jobs));
  return { name: scenario.name, computeUsdMicros: String(compute), storageUsdMicros: String(storage),
    totalPhalaUsdMicros: String(total), breakEvenPhalaPerSuccessUsdMicros: perJob,
    minimumWith25PercentBufferUsdCents: jobs === 0n ? null : String(ceilDiv(total * 125n, jobs * 1000000n)) };
}

export function estimateTrial(plan) {
  validateRates(plan);
  const trial = plan.trial;
  if (!integer(plan.periodHours, 1) || !trial || !integer(trial.sessions, 1)
    || !integer(trial.minutesPerSession, 1) || trial.minutesPerSession > 1440
    || !integer(trial.stopDelayMinutesPerSession) || !amount(trial.proposedPhalaBudgetUsdMicros)) {
    throw new Error("Essai borné invalide");
  }
  const plannedMinutes = BigInt(trial.sessions) * BigInt(trial.minutesPerSession);
  const delayMinutes = BigInt(trial.sessions) * BigInt(trial.stopDelayMinutesPerSession);
  if (plannedMinutes + delayMinutes > BigInt(plan.periodHours) * 60n) throw new Error("Essais hors période");
  const rate = BigInt(plan.computeUsdMicrosPerHour);
  const compute = ceilDiv(rate * BigInt(trial.minutesPerSession), 60n) * BigInt(trial.sessions);
  const delay = ceilDiv(rate * BigInt(trial.stopDelayMinutesPerSession), 60n) * BigInt(trial.sessions);
  const storage = BigInt(plan.diskUsdMicrosPerGbHour) * BigInt(plan.diskGb) * BigInt(plan.periodHours);
  const provision = compute + delay + storage;
  const bufferedCents = ceilDiv(provision * 125n, 1000000n);
  const proposedBudget = BigInt(trial.proposedPhalaBudgetUsdMicros);
  return {
    sessions: trial.sessions, minutesPerSession: trial.minutesPerSession,
    plannedComputeUsdMicros: String(compute), stopDelayReserveUsdMicros: String(delay), storageUsdMicros: String(storage),
    provisionPhalaUsdMicros: String(provision), provisionWith25PercentBufferUsdCents: String(bufferedCents),
    proposedPhalaBudgetUsdMicros: String(proposedBudget), proposedBudgetCoversProvision: proposedBudget >= bufferedCents * 10000n,
    approved: false, providerEnforced: false,
    note: "Proposition Phala uniquement, hors autres fournisseurs et taxes. Le délai d'arrêt est une hypothèse, pas une garantie. Le disque continue après cette période." };
}

export function estimatePlan(plan) {
  if (plan.version !== 1 || plan.status !== "draft" || plan.network !== "testnet" || plan.chainId !== 31611
    || !integer(plan.periodHours, 1) || !amount(plan.cashUsdMicros) || !amount(plan.earnedMarginUsdMicros)
    || (plan.spendingCapUsdMicros !== null && !amount(plan.spendingCapUsdMicros))
    || !Array.isArray(plan.scenarios) || !plan.scenarios.length) throw new Error("Plan de coûts invalide");
  const trial = estimateTrial(plan);
  const margin = BigInt(plan.earnedMarginUsdMicros);
  const cash = BigInt(plan.cashUsdMicros);
  return { status: "draft", activationReady: false, commercialTariffReady: false, scope: "Phala",
    chainId: plan.chainId, computeRecipient: plan.computeRecipient, runner: plan.runner,
    spendingCapUsdMicros: plan.spendingCapUsdMicros, trial,
    strictRunnerCeilingBeforeReservesUsdMicros: String(margin < cash ? margin : cash),
    excluded: ["Pinata", "Vercel", "Neon", "VPS", "RPC", "taxes", "change USD/USDC"],
    scenarios: plan.scenarios.map((scenario) => estimateScenario(plan, scenario)),
    note: "Les tentatives échouées consomment aussi des ressources. Aucune vente garantie ; les apports et crédits ne deviennent pas une marge acquise. Aucune politique active créée." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(estimatePlan(JSON.parse(readFileSync(process.argv[2] || "deploy/operations/testnet-plan.json", "utf8"))), null, 2)); }
  catch { console.error("Estimation refusée : vérifier les hypothèses explicites."); process.exitCode = 1; }
}
