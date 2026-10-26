// A2.5 — Synthèse d'exploitation d'une session Phala : échéance absolue (même règle que le
// watchdog) + dernier `runner:budget check` connu. Ce module ne démarre, n'arrête et ne supprime
// rien : il classe la situation et dit quoi faire. L'arrêt automatique reste celui du watchdog.
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { sessionDecision } from "./phala-watchdog.mjs";
import { readPrivateFile } from "./archive.mjs";

const PENDING_ALERT_MS = 300_000; // même seuil que `runner:budget check`
const signed = (value) => typeof value === "string" && /^(0|-?[1-9][0-9]{0,77})$/.test(value);

/** Alertes tirées d'un `runner:budget check` (sortie JSON) observé à `observedAtMs`. */
export function budgetAlerts(check, observedAtMs, now = Date.now(), maxAgeMs = 600_000) {
  if (!check || typeof check !== "object" || typeof check.canQuote !== "boolean" || typeof check.expired !== "boolean"
    || typeof check.circuitOpen !== "boolean" || !Number.isSafeInteger(check.incompleteJobs) || !Array.isArray(check.pendingTransactions)
    || !signed(check.remainingUsd) || !Number.isSafeInteger(observedAtMs)) throw new Error("Contrôle de budget illisible");
  const alerts = [];
  if (now - observedAtMs > maxAgeMs || observedAtMs > now + 30_000) alerts.push({ code: "budget-report-stale", detail: "Date du contrôle de budget trop ancienne ou future" });
  if (check.circuitOpen) alerts.push({ code: "circuit-open", detail: "Coupe-circuit ouvert : admissions refusées" });
  if (check.expired) alerts.push({ code: "policy-expired", detail: "Politique de budget expirée : admissions refusées" });
  if (!check.canQuote && !check.circuitOpen && !check.expired) alerts.push({ code: "cannot-quote", detail: "Marge ou gas insuffisant pour un nouveau devis" });
  if (BigInt(check.remainingUsd) < 0n) alerts.push({ code: "negative-remaining", detail: "Réserve de frais fixes supérieure à la marge" });
  if (check.incompleteJobs > 0) alerts.push({ code: "incomplete-jobs", detail: `${check.incompleteJobs} calcul(s) réservé(s) non terminé(s)` });
  for (const tx of check.pendingTransactions) {
    if (Number.isSafeInteger(tx?.ageMs) && tx.ageMs >= PENDING_ALERT_MS) {
      alerts.push({ code: `pending-${tx.recovery ?? "unknown"}`, detail: "Transaction incertaine de plus de cinq minutes : réconciliation opérateur" });
    }
  }
  const blocked = check.circuitOpen || check.expired || !check.canQuote;
  const inFlight = check.incompleteJobs > 0 || check.pendingTransactions.length > 0;
  return { alerts, blocked, inFlight };
}

/**
 * @param {{ session: object, cvm: { app_id: string, status: string }, budget?: { check: object, observedAtMs: number } | null, now?: number }} input
 */
export function supervisionReport({ session, cvm, budget = null, now = Date.now() }) {
  const deadline = sessionDecision(session, cvm, now);
  const running = cvm.status !== "stopped";
  const alerts = [];
  let recommendation = "Rien à faire.";
  if (deadline.stopRequired) {
    alerts.push({ code: "deadline-passed", detail: "Échéance de session dépassée et CVM non arrêtée" });
    recommendation = "Arrêt obligatoire : le watchdog doit l'avoir demandé ; sinon arrêter depuis la console Phala.";
  }
  let budgetState = null;
  if (running && !budget) alerts.push({ code: "budget-report-missing", detail: "Aucun contrôle de budget transmis pour une CVM allumée" });
  if (budget) {
    budgetState = budgetAlerts(budget.check, budget.observedAtMs, now);
    alerts.push(...budgetState.alerts);
    if (running && budgetState.blocked && !deadline.stopRequired) {
      recommendation = budgetState.inFlight
        ? "Admissions bloquées mais calcul ou transaction en cours : ne pas arrêter avant réconciliation (runner:transactions reconcile)."
        : "Admissions bloquées sans travail en cours : la CVM est facturée pour rien, avancer l'arrêt manuellement.";
    }
  }
  const critical = alerts.some((a) => ["deadline-passed", "budget-report-stale", "budget-report-missing", "circuit-open",
    "pending-attempts-exhausted", "pending-journal-missing"].includes(a.code)) || (running && Boolean(budgetState?.blocked));
  return {
    level: critical ? "critical" : alerts.length ? "warning" : "ok",
    cvm: { appId: session.appId, status: cvm.status, deadline: session.stopAt, expired: deadline.expired },
    alerts, recommendation,
    note: "Rapport sans action : aucun démarrage, arrêt ou suppression n'est effectué par ce module.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // Usage : node scripts/operations/supervisor.mjs session.json cvm.json [budget-check.json]
    // cvm.json : sortie de `phala cvms get` (champ data) ; budget-check.json : sortie de `runner:budget check`,
    // son heure d'observation est celle de la dernière modification du fichier.
    const [sessionFile, cvmFile, budgetFile, ...extra] = process.argv.slice(2);
    if (!sessionFile || !cvmFile || extra.length) throw new Error();
    const session = JSON.parse(readPrivateFile(sessionFile).toString());
    const cvmRaw = JSON.parse(readFileSync(cvmFile, "utf8"));
    const savedBudget = budgetFile ? JSON.parse(readFileSync(budgetFile, "utf8")) : null;
    const budget = savedBudget?.version === 1 && savedBudget.check
      ? { check: savedBudget.check, observedAtMs: savedBudget.observedAtMs }
      : budgetFile ? { check: savedBudget, observedAtMs: Math.floor(statSync(budgetFile).mtimeMs) } : null;
    const report = supervisionReport({ session, cvm: cvmRaw.data ?? cvmRaw, budget });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.level === "critical" ? 2 : report.level === "warning" ? 1 : 0;
  } catch {
    console.error("Supervision impossible : session, état CVM ou contrôle de budget illisible. Intervention opérateur requise.");
    process.exitCode = 2;
  }
}
