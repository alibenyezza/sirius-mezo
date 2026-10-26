// Contrat d'entrée de la comptabilité A2 : l'export `runner:budget export` fourni par A1.
// Validation stricte : un champ inconnu, absent ou mal typé arrête la lecture, pour qu'un
// changement de format côté runner se voie au lieu de fausser silencieusement les calculs.
// Les messages ne contiennent que des chemins de champs, jamais de valeurs.

const KINDS = new Set(["request", "seal", "training", "transaction"]);
const STATES = new Set(["reserved", "succeeded", "failed"]);
const CHECKPOINTS = new Set(["not-started", "uncertain", "result-durable", "result-missing", "failure-measured"]);
const RECOVERIES = new Set(["unsigned", "journal-missing", "attempts-exhausted", "awaiting-receipt"]);

const unsigned = (value) => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value);
const signed = (value) => typeof value === "string" && /^(0|-?[1-9][0-9]{0,77})$/.test(value);
const int = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value, max = 256) => typeof value === "string" && value.length > 0 && value.length <= max;
const hash = (value) => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const address = (value) => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function checker() {
  const errors = [];
  return {
    errors,
    shape(value, path, keys) {
      if (!object(value)) { errors.push(`${path} : objet attendu`); return false; }
      for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${path}.${key} : champ inconnu`);
      for (const key of keys) if (!(key in value)) errors.push(`${path}.${key} : champ absent`);
      return true;
    },
    field(ok, path, expected) { if (!ok) errors.push(`${path} : ${expected}`); },
  };
}

/**
 * Valide un export v1 et le renvoie inchangé. Lève une erreur listant les chemins fautifs.
 * @param {unknown} doc
 */
export function validateAccountingExport(doc) {
  const c = checker();
  if (!c.shape(doc, "export", ["version", "generatedAtMs", "chainId", "wallet", "accountingReference", "totals",
    "pendingTransactions", "operations", "workflows"])) throw failure(c.errors);
  c.field(doc.version === 1, "export.version", "version 1 attendue");
  c.field(int(doc.generatedAtMs), "export.generatedAtMs", "timestamp en millisecondes attendu");
  c.field(int(doc.chainId, 1), "export.chainId", "identifiant de réseau attendu");
  c.field(address(doc.wallet), "export.wallet", "adresse attendue");
  c.field(text(doc.accountingReference), "export.accountingReference", "référence non vide attendue");

  if (c.shape(doc.totals, "export.totals", ["allocatedUsdMicros", "allocatedWei", "remainingUsdMicros", "remainingWei", "failures"])) {
    c.field(unsigned(doc.totals.allocatedUsdMicros), "export.totals.allocatedUsdMicros", "entier positif en chaîne attendu");
    c.field(unsigned(doc.totals.allocatedWei), "export.totals.allocatedWei", "entier positif en chaîne attendu");
    // Le solde réservable peut être négatif : réserve de frais fixes supérieure à la marge.
    c.field(signed(doc.totals.remainingUsdMicros), "export.totals.remainingUsdMicros", "entier en chaîne attendu");
    c.field(signed(doc.totals.remainingWei), "export.totals.remainingWei", "entier en chaîne attendu");
    c.field(int(doc.totals.failures), "export.totals.failures", "entier positif attendu");
  }

  const workflowIds = new Set();
  if (!Array.isArray(doc.workflows)) c.field(false, "export.workflows", "liste attendue");
  else doc.workflows.forEach((w, i) => {
    const p = `export.workflows[${i}]`;
    if (!c.shape(w, p, ["id", "fingerprint", "validUntilMs", "budgetUsdMicros", "budgetWei", "remaining", "checkpoint",
      "measurement", "failureClaim"])) return;
    c.field(text(w.id), `${p}.id`, "identifiant attendu");
    c.field(!workflowIds.has(w.id), `${p}.id`, "identifiant en double");
    workflowIds.add(w.id);
    c.field(text(w.fingerprint), `${p}.fingerprint`, "empreinte attendue");
    c.field(int(w.validUntilMs), `${p}.validUntilMs`, "timestamp en millisecondes attendu");
    c.field(unsigned(w.budgetUsdMicros), `${p}.budgetUsdMicros`, "entier positif en chaîne attendu");
    c.field(unsigned(w.budgetWei), `${p}.budgetWei`, "entier positif en chaîne attendu");
    if (c.shape(w.remaining, `${p}.remaining`, ["requests", "training", "transactions"])) {
      for (const key of ["requests", "training", "transactions"]) c.field(int(w.remaining[key]), `${p}.remaining.${key}`, "entier positif attendu");
    }
    c.field(CHECKPOINTS.has(w.checkpoint), `${p}.checkpoint`, "état de checkpoint connu attendu");
    if (w.measurement !== null && c.shape(w.measurement, `${p}.measurement`, ["elapsedMs", "startedAtMs", "success"])) {
      c.field(int(w.measurement.elapsedMs, 0, 30000), `${p}.measurement.elapsedMs`, "durée bornée attendue");
      c.field(int(w.measurement.startedAtMs), `${p}.measurement.startedAtMs`, "timestamp en millisecondes attendu");
      c.field(typeof w.measurement.success === "boolean", `${p}.measurement.success`, "booléen attendu");
    }
    // Cohérence checkpoint / mesure : une mesure absente n'est jamais une consommation nulle.
    const measured = object(w.measurement);
    if (["not-started", "uncertain"].includes(w.checkpoint)) c.field(w.measurement === null, `${p}.measurement`, "absente attendue pour ce checkpoint");
    if (["result-durable", "result-missing"].includes(w.checkpoint)) c.field(measured && w.measurement.success === true, `${p}.measurement`, "mesure réussie attendue");
    if (w.checkpoint === "failure-measured") c.field(measured && w.measurement.success === false, `${p}.measurement`, "mesure en échec attendue");
    if (w.failureClaim !== null && c.shape(w.failureClaim, `${p}.failureClaim`, ["consumedComputeAtomic", "evidenceHash", "observedAtSeconds"])) {
      c.field(unsigned(w.failureClaim.consumedComputeAtomic), `${p}.failureClaim.consumedComputeAtomic`, "entier positif en chaîne attendu");
      c.field(hash(w.failureClaim.evidenceHash), `${p}.failureClaim.evidenceHash`, "empreinte de 32 octets attendue");
      c.field(int(w.failureClaim.observedAtSeconds), `${p}.failureClaim.observedAtSeconds`, "timestamp en secondes attendu");
    }
  });

  const operations = new Map();
  if (!Array.isArray(doc.operations)) c.field(false, "export.operations", "liste attendue");
  else doc.operations.forEach((o, i) => {
    const p = `export.operations[${i}]`;
    if (!c.shape(o, p, ["id", "fingerprint", "kind", "state", "createdAtMs", "workflowId", "budgetUsdMicros", "budgetWei",
      "transactionHash", "nonce", "broadcastAttempts"])) return;
    c.field(text(o.id), `${p}.id`, "identifiant attendu");
    c.field(!operations.has(o.id), `${p}.id`, "identifiant en double");
    operations.set(o.id, o);
    c.field(text(o.fingerprint), `${p}.fingerprint`, "empreinte attendue");
    c.field(KINDS.has(o.kind), `${p}.kind`, "nature connue attendue");
    c.field(STATES.has(o.state), `${p}.state`, "état connu attendu");
    c.field(int(o.createdAtMs), `${p}.createdAtMs`, "timestamp en millisecondes attendu");
    c.field(o.workflowId === null || (text(o.workflowId) && workflowIds.has(o.workflowId)), `${p}.workflowId`, "workflow exporté ou null attendu");
    c.field(unsigned(o.budgetUsdMicros), `${p}.budgetUsdMicros`, "entier positif en chaîne attendu");
    c.field(unsigned(o.budgetWei), `${p}.budgetWei`, "entier positif en chaîne attendu");
    c.field(o.transactionHash === null || hash(o.transactionHash), `${p}.transactionHash`, "hash ou null attendu");
    c.field(o.nonce === null || int(o.nonce), `${p}.nonce`, "nonce ou null attendu");
    c.field(o.broadcastAttempts === null || int(o.broadcastAttempts), `${p}.broadcastAttempts`, "entier ou null attendu");
    if (o.kind !== "transaction") c.field(o.transactionHash === null && o.nonce === null, `${p}.transactionHash`, "aucune transaction attendue hors nature transaction");
  });

  const pendingIds = new Set();
  if (!Array.isArray(doc.pendingTransactions)) c.field(false, "export.pendingTransactions", "liste attendue");
  else doc.pendingTransactions.forEach((t, i) => {
    const p = `export.pendingTransactions[${i}]`;
    if (!c.shape(t, p, ["id", "hash", "nonce", "ageMs", "attempts", "journalAvailable", "recovery"])) return;
    const op = operations.get(t.id);
    c.field(Boolean(op) && op.kind === "transaction" && op.state === "reserved", `${p}.id`, "transaction réservée exportée attendue");
    c.field(!pendingIds.has(t.id), `${p}.id`, "identifiant en double");
    pendingIds.add(t.id);
    c.field(t.hash === null || hash(t.hash), `${p}.hash`, "hash ou null attendu");
    c.field(t.nonce === null || int(t.nonce), `${p}.nonce`, "nonce ou null attendu");
    c.field(int(t.ageMs), `${p}.ageMs`, "durée attendue");
    c.field(int(t.attempts), `${p}.attempts`, "entier positif attendu");
    c.field(typeof t.journalAvailable === "boolean", `${p}.journalAvailable`, "booléen attendu");
    c.field(RECOVERIES.has(t.recovery), `${p}.recovery`, "motif de reprise connu attendu");
  });

  if (c.errors.length) throw failure(c.errors);
  return doc;
}

function failure(errors) {
  const error = new Error(`Export comptable refusé :\n- ${errors.slice(0, 50).join("\n- ")}`);
  error.fields = errors;
  return error;
}

/**
 * Vérifie la règle anti double compte donnée par A1 : budgets des workflows + opérations
 * hors workflow = total alloué. Ne lève pas : un écart est une information comptable.
 * @param {ReturnType<typeof validateAccountingExport>} doc
 */
export function allocationCheck(doc) {
  const sum = (rows, key) => rows.reduce((total, row) => total + BigInt(row[key]), 0n);
  const standalone = doc.operations.filter((op) => op.workflowId === null);
  const unit = (key, total) => {
    const workflows = sum(doc.workflows, key);
    const operations = sum(standalone, key);
    const allocated = BigInt(doc.totals[total]);
    return { workflows: String(workflows), standaloneOperations: String(operations), allocated: String(allocated),
      difference: String(allocated - workflows - operations), matches: allocated === workflows + operations };
  };
  return { usdMicros: unit("budgetUsdMicros", "allocatedUsdMicros"), wei: unit("budgetWei", "allocatedWei") };
}

/** Signature de structure (clés et types, sans valeurs) pour détecter un changement de format. */
export function shapeSignature(value) {
  if (Array.isArray(value)) {
    const items = [...new Set(value.map(shapeSignature))].sort();
    return `[${items.join("|")}]`;
  }
  if (value === null) return "null";
  if (typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${key}:${shapeSignature(value[key])}`).join(",")}}`;
  return typeof value;
}
