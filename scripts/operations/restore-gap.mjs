// A2.6 — Écart entre un registre runner restauré et le dernier export connu.
// Une copie cohérente mais ancienne paraît valide : ce qu'elle a oublié (dépenses, devis,
// transactions et nonces postérieurs) doit être compté avant toute réouverture. L'outil compare
// deux exports v1 ; il ne modifie aucun registre et ne recrée aucun budget.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { validateAccountingExport } from "./accounting-export.mjs";

const RANK = { reserved: 0, succeeded: 1, failed: 1 };

/**
 * @param {object} restored  export du registre restauré
 * @param {object} lastKnown dernier export connu avant l'incident (au moins aussi récent que la copie)
 */
export function restoreGap(restored, lastKnown) {
  const r = validateAccountingExport(restored);
  const l = validateAccountingExport(lastKnown);
  if (r.chainId !== l.chainId || r.wallet.toLowerCase() !== l.wallet.toLowerCase()) throw new Error("Exports de registres différents");

  const restoredOps = new Map(r.operations.map((op) => [op.id, op]));
  const restoredWorkflows = new Set(r.workflows.map((w) => w.id));
  const missingOperations = [];
  const regressedOperations = [];
  const conflictingOperations = [];
  for (const op of l.operations) {
    const before = restoredOps.get(op.id);
    if (!before) { missingOperations.push({ id: op.id, kind: op.kind, state: op.state, workflowId: op.workflowId,
      budgetUsdMicros: op.budgetUsdMicros, budgetWei: op.budgetWei, transactionHash: op.transactionHash, nonce: op.nonce }); continue; }
    if (before.fingerprint !== op.fingerprint || before.kind !== op.kind || before.workflowId !== op.workflowId
      || (before.transactionHash && op.transactionHash && before.transactionHash.toLowerCase() !== op.transactionHash.toLowerCase())) {
      conflictingOperations.push({ id: op.id });
      continue;
    }
    if (RANK[before.state] < RANK[op.state] || (!before.transactionHash && op.transactionHash)) {
      regressedOperations.push({ id: op.id, restoredState: before.state, lastKnownState: op.state,
        transactionHash: op.transactionHash, nonce: op.nonce });
    }
  }
  const missingWorkflows = l.workflows.filter((w) => !restoredWorkflows.has(w.id))
    .map((w) => ({ id: w.id, checkpoint: w.checkpoint, budgetUsdMicros: w.budgetUsdMicros, budgetWei: w.budgetWei }));

  // Transactions connues ailleurs mais absentes de la copie : leurs nonces sont déjà consommés.
  const knownTx = [...missingOperations, ...regressedOperations].filter((op) => op.transactionHash);
  const nonces = knownTx.map((op) => op.nonce).filter((n) => Number.isSafeInteger(n));
  const allocationGap = {
    usdMicros: String(BigInt(l.totals.allocatedUsdMicros) - BigInt(r.totals.allocatedUsdMicros)),
    wei: String(BigInt(l.totals.allocatedWei) - BigInt(r.totals.allocatedWei)),
  };
  const olderThanLastKnown = r.generatedAtMs < l.generatedAtMs;
  const gaps = missingOperations.length + regressedOperations.length + conflictingOperations.length + missingWorkflows.length;
  const reasons = [];
  if (conflictingOperations.length) reasons.push("opérations contradictoires : deux registres différents, escalade immédiate");
  if (missingOperations.length || missingWorkflows.length) reasons.push("dépenses ou devis postérieurs à la copie absents du registre restauré");
  if (regressedOperations.length) reasons.push("opérations revenues à un état antérieur");
  if (knownTx.length) reasons.push("transactions postérieures à la copie : nonces déjà consommés, ne rien re-signer");
  if (BigInt(allocationGap.usdMicros) > 0n || BigInt(allocationGap.wei) > 0n) reasons.push("exposition allouée supérieure à celle du registre restauré");
  return {
    reopenAllowed: gaps === 0 && BigInt(allocationGap.usdMicros) <= 0n && BigInt(allocationGap.wei) <= 0n,
    reasons,
    olderThanLastKnown,
    allocationGap,
    missingOperations, regressedOperations, conflictingOperations, missingWorkflows,
    consumedNonces: [...new Set(nonces)].sort((a, b) => a - b),
    note: "Absence d'écart avec le dernier export ne prouve pas que ce dernier était le plus récent : comparer aussi la chaîne (relevé des escrows, nonce du wallet) et les factures avant réouverture.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [restoredFile, lastKnownFile, ...extra] = process.argv.slice(2);
    if (!restoredFile || !lastKnownFile || extra.length) throw new Error();
    const report = restoreGap(JSON.parse(readFileSync(restoredFile, "utf8")), JSON.parse(readFileSync(lastKnownFile, "utf8")));
    console.log(JSON.stringify(report, null, 2));
    if (!report.reopenAllowed) process.exitCode = 1;
  } catch {
    console.error("Comparaison refusée : fournir l'export du registre restauré puis le dernier export connu du même wallet.");
    process.exitCode = 2;
  }
}
