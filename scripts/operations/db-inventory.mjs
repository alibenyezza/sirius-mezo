// B2.0 — Inventaire de migration, en lecture seule.
// Photographie une base Sirius (schéma, migrations appliquées, comptes, empreintes des lignes,
// agrégats métier) avant et après une migration, puis compare les deux photos : aucune ligne
// perdue, aucune valeur historique modifiée, seules les colonnes annoncées par les migrations
// ajoutées. Les attentes sont dérivées des fichiers SQL des migrations, pas recopiées à la main.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { readPrivateFile } from "./archive.mjs";

const RECEIPT_TABLES = { Dataset: "runnerReceipt", TrainingJob: "runnerReceipt", Loan: "runnerReceipt" };
const BILLING_COLUMNS = ["billingQuote", "billingQuoteHash", "datasetAmountUsdcAtomic", "computeAmountUsdcAtomic",
  "maxFailureFeeUsdcAtomic", "retainedFeeUsdcAtomic", "refundAmountUsdcAtomic"];
const ACTIVE_DATASET = ["LISTED", "UNLISTED", "PRIVATE", "LISTING"];
const identifier = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** Version et nature d'un reçu runner `base64url(json).base64url(signature)`, sans vérifier la signature. */
export function receiptHeader(token) {
  try {
    if (typeof token !== "string" || token.length > 8192) return "invalid";
    const [payload, signature] = token.split(".");
    if (!payload || !signature || Buffer.from(signature, "base64url").length !== 32) return "invalid";
    const receipt = JSON.parse(Buffer.from(payload, "base64url").toString());
    return Number.isInteger(receipt.version) && typeof receipt.kind === "string" ? `${receipt.kind}:v${receipt.version}` : "invalid";
  } catch { return "invalid"; }
}

function count(rows, key) {
  const out = {};
  for (const row of rows) out[String(row[key])] = (out[String(row[key])] ?? 0) + Number(row.n);
  return out;
}

/**
 * @param {{ query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }} client
 * @param {{ columns?: Record<string, string[]>, now?: number }} options  `columns` : restreint les empreintes aux colonnes d'une photo précédente.
 */
export async function inventory(client, options = {}) {
  const q = async (text, values = []) => (await client.query(text, values)).rows;
  const schema = (await q("SELECT current_schema() AS s"))[0].s;
  const columnRows = await q(`SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, ordinal_position`, [schema]);
  /** @type {Record<string, Array<{ name: string, type: string, nullable: boolean, default: string | null }>>} */
  const columns = {};
  for (const row of columnRows) {
    if (row.table_name === "_prisma_migrations") continue;
    (columns[row.table_name] ??= []).push({ name: row.column_name, type: row.data_type === "USER-DEFINED" ? row.udt_name : row.data_type,
      nullable: row.is_nullable === "YES", default: row.column_default ?? null });
  }
  const tables = Object.keys(columns).sort();
  /** @type {Record<string, string[]>} */
  const enums = {};
  for (const row of await q(`SELECT t.typname AS name, e.enumlabel AS value FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = $1 ORDER BY t.typname, e.enumsortorder`, [schema])) {
    (enums[row.name] ??= []).push(row.value);
  }
  const indexes = (await q("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname", [schema]))
    .filter((row) => !row.indexname.startsWith("_prisma_migrations"))
    .map((row) => ({ name: row.indexname, definition: row.indexdef.replace(new RegExp(`\\b${schema}\\.`, "g"), "") }));
  const hasMigrations = (await q("SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = '_prisma_migrations'", [schema])).length > 0;
  const migrations = hasMigrations
    ? (await q(`SELECT migration_name AS name, checksum, rolled_back_at IS NOT NULL AS rolled_back, finished_at IS NULL AS unfinished
        FROM ${identifier(schema)}._prisma_migrations ORDER BY migration_name`))
      .map((row) => ({ name: row.name, checksum: row.checksum, rolledBack: row.rolled_back, unfinished: row.unfinished }))
    : [];

  /** @type {Record<string, number>} */
  const counts = {};
  /** @type {Record<string, string>} */
  const digests = {};
  /** @type {Record<string, string[]>} */
  const digestColumns = {};
  for (const table of tables) {
    const present = columns[table].map((column) => column.name);
    const wanted = options.columns?.[table];
    const used = wanted ? wanted.filter((name) => present.includes(name)) : present;
    if (wanted && used.length !== wanted.length) throw new Error(`Colonnes attendues absentes de ${table}`);
    digestColumns[table] = used;
    const row = (await q(`SELECT count(*)::text AS n, md5(coalesce(string_agg(h, ',' ORDER BY h), '')) AS d
      FROM (SELECT md5(row_to_json(t)::text) AS h FROM (SELECT ${used.map(identifier).join(", ")} FROM ${identifier(schema)}.${identifier(table)}) t) x`))[0];
    counts[table] = Number(row.n);
    digests[table] = row.d;
  }

  const has = (table, column) => columns[table]?.some((item) => item.name === column);
  const groupBy = async (table, column) => has(table, column)
    ? count(await q(`SELECT ${identifier(column)}::text AS k, count(*)::text AS n FROM ${identifier(schema)}.${identifier(table)} GROUP BY 1 ORDER BY 1`), "k") : null;
  const domain = {};
  if (tables.includes("Loan")) {
    const byEscrow = has("Loan", "evmEscrowAddress")
      ? (await q(`SELECT coalesce("evmChainId"::text, '?') AS chain, coalesce(lower("evmEscrowAddress"), 'none') AS escrow, status::text AS status, count(*)::text AS n
          FROM ${identifier(schema)}."Loan" GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`)).map((row) => ({ chainId: String(row.chain), escrow: String(row.escrow), status: String(row.status), loans: Number(row.n) }))
      : null;
    const billing = {};
    for (const column of BILLING_COLUMNS) {
      if (has("Loan", column)) billing[column] = Number((await q(`SELECT count(*)::text AS n FROM ${identifier(schema)}."Loan" WHERE ${identifier(column)} IS NOT NULL`))[0].n);
    }
    domain.loans = { byStatus: await groupBy("Loan", "status"), byRunnerKind: await groupBy("Loan", "runnerKind"), byEscrow, billingColumnsFilled: billing,
      withModel: Number((await q(`SELECT count(*)::text AS n FROM ${identifier(schema)}."Loan" WHERE "modelCid" IS NOT NULL`))[0].n) };
  }
  if (tables.includes("Dataset")) {
    const toReimport = has("Dataset", "runnerDeploymentId")
      ? (await q(`SELECT id, status::text AS status FROM ${identifier(schema)}."Dataset" WHERE "runnerDeploymentId" IS NULL AND status::text = ANY($1) ORDER BY id`, [ACTIVE_DATASET]))
        .map((row) => ({ id: String(row.id), status: String(row.status) })) : null;
    domain.datasets = { byStatus: await groupBy("Dataset", "status"), byRunnerKind: await groupBy("Dataset", "runnerKind"),
      withActiveKey: Number((await q(`SELECT count(*)::text AS n FROM ${identifier(schema)}."Dataset" WHERE "wrappedKey" IS NOT NULL AND "keyDestroyedAt" IS NULL`))[0].n),
      toReimport };
  }
  if (tables.includes("TrainingJob")) domain.trainingJobs = { byStatus: await groupBy("TrainingJob", "status"), byRunnerKind: await groupBy("TrainingJob", "runnerKind") };
  if (tables.includes("KeyGrant")) domain.keyGrants = { byStatus: await groupBy("KeyGrant", "status") };
  if (tables.includes("Credential")) domain.credentials = { byStatus: await groupBy("Credential", "status") };
  const receipts = {};
  for (const [table, column] of Object.entries(RECEIPT_TABLES)) {
    if (!has(table, column)) continue;
    const rows = await q(`SELECT ${identifier(column)} AS token FROM ${identifier(schema)}.${identifier(table)} WHERE ${identifier(column)} IS NOT NULL`);
    receipts[table] = count(rows.map((row) => ({ h: receiptHeader(row.token), n: 1 })), "h");
  }
  const cids = [];
  for (const table of ["Loan", "TrainingJob"]) {
    if (has(table, "modelCid")) cids.push(...(await q(`SELECT DISTINCT "modelCid" AS cid FROM ${identifier(schema)}.${identifier(table)} WHERE "modelCid" IS NOT NULL`)).map((row) => row.cid));
  }
  const distinct = [...new Set(cids)].sort();
  domain.models = { distinctCids: distinct.length, cidsDigest: (await q("SELECT md5($1) AS d", [distinct.join(",")]))[0].d };
  domain.receipts = receipts;

  return { version: 1, kind: "sirius-db-inventory", observedAtMs: options.now ?? Date.now(), schema, tables, columns, enums, indexes, migrations,
    counts, digests, digestColumns, domain, note: "Photo en lecture seule ; aucune valeur de ligne n'est exportée, seulement des comptes et des empreintes." };
}

/** Ajouts et retraits qu'un ensemble de migrations Prisma annonce, lus dans leurs fichiers SQL. */
export function expectedChanges(migrationDirs) {
  /** @type {{ migrations: string[], tablesAdded: string[], columnsAdded: Record<string, string[]>, columnsRemoved: Record<string, string[]>, enumsAdded: string[], enumValuesAdded: Record<string, string[]>, indexesAdded: string[] }} */
  const changes = { migrations: [], tablesAdded: [], columnsAdded: {}, columnsRemoved: {}, enumsAdded: [], enumValuesAdded: {}, indexesAdded: [] };
  for (const dir of migrationDirs) {
    const name = basename(dir);
    const sql = readFileSync(join(dir, "migration.sql"), "utf8").replace(/--[^\n]*/g, "");
    changes.migrations.push(name);
    for (const statement of sql.split(";")) {
      const alter = /ALTER\s+TABLE\s+"?(\w+)"?/i.exec(statement);
      if (alter) {
        const table = alter[1];
        for (const m of statement.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)) (changes.columnsAdded[table] ??= []).push(m[1]);
        for (const m of statement.matchAll(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) (changes.columnsRemoved[table] ??= []).push(m[1]);
        for (const m of statement.matchAll(/RENAME\s+COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/gi)) {
          (changes.columnsRemoved[table] ??= []).push(m[1]);
          (changes.columnsAdded[table] ??= []).push(m[2]);
        }
      }
      // Une table créée amène sa clé primaire, que PostgreSQL expose comme index « <table>_pkey ».
      const table = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s*\(([\s\S]*)\)\s*$/i.exec(statement.trim());
      if (table) {
        changes.tablesAdded.push(table[1]);
        changes.indexesAdded.push(`${table[1]}_pkey`);
        // Colonnes du corps : une par ligne, nom entre guillemets suivi d'un type (nu ou entre
        // guillemets pour une énumération) ; les lignes CONSTRAINT ne commencent pas par un nom.
        for (const m of table[2].matchAll(/^\s*"(\w+)"\s+(?:"\w+"|\w)/gm)) (changes.columnsAdded[table[1]] ??= []).push(m[1]);
      }
      const type = /CREATE\s+TYPE\s+"?(\w+)"?\s+AS\s+ENUM/i.exec(statement);
      if (type) changes.enumsAdded.push(type[1]);
      const value = /ALTER\s+TYPE\s+"?(\w+)"?\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/i.exec(statement);
      if (value) (changes.enumValuesAdded[value[1]] ??= []).push(value[2]);
      const index = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/i.exec(statement);
      if (index) changes.indexesAdded.push(index[1]);
    }
  }
  return changes;
}

export function migrationDirectories(root, names) {
  const all = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const chosen = names?.length ? names : [];
  for (const name of chosen) if (!all.includes(name)) throw new Error(`Migration inconnue : ${name}`);
  return chosen.map((name) => join(root, name));
}

/** Compare deux photos ; `expected` vient de expectedChanges(). Signale, ne corrige rien. */
export function compareInventories(before, after, expected = expectedChanges([])) {
  for (const doc of [before, after]) if (doc?.version !== 1 || doc.kind !== "sirius-db-inventory") throw new Error("Photo de base invalide");
  const findings = [];
  const finding = (severity, code, ref, detail) => findings.push({ severity, code, ref, detail });
  const set = (values) => new Set(values ?? []);
  for (const table of before.tables) {
    if (!after.tables.includes(table)) { finding("critical", "table-missing", table, "table absente après migration"); continue; }
    const beforeCols = set(before.columns[table].map((c) => c.name));
    const afterCols = set(after.columns[table].map((c) => c.name));
    const expectedAdded = set(expected.columnsAdded[table]);
    const expectedRemoved = set(expected.columnsRemoved[table]);
    for (const name of beforeCols) if (!afterCols.has(name)) finding(expectedRemoved.has(name) ? "info" : "critical", "column-removed", `${table}.${name}`, expectedRemoved.has(name) ? "retrait annoncé par la migration" : "colonne perdue");
    for (const name of afterCols) if (!beforeCols.has(name) && !expectedAdded.has(name)) finding("warning", "column-unexpected", `${table}.${name}`, "colonne ajoutée sans migration annoncée");
    for (const name of expectedAdded) if (!afterCols.has(name)) finding("critical", "column-not-added", `${table}.${name}`, "colonne annoncée par la migration mais absente");
    for (const column of before.columns[table]) {
      const same = after.columns[table].find((c) => c.name === column.name);
      if (same && (same.type !== column.type || same.nullable !== column.nullable || same.default !== column.default)) {
        finding("critical", "column-changed", `${table}.${column.name}`, "type, nullabilité ou défaut modifié");
      }
    }
    if (after.counts[table] < before.counts[table]) finding("critical", "rows-lost", table, `${before.counts[table] - after.counts[table]} ligne(s) perdue(s)`);
    else if (after.counts[table] > before.counts[table]) finding("warning", "rows-added", table, `${after.counts[table] - before.counts[table]} ligne(s) ajoutée(s) pendant la fenêtre`);
    const sameColumns = JSON.stringify(after.digestColumns[table]) === JSON.stringify(before.digestColumns[table]);
    if (!sameColumns) finding("warning", "digest-not-comparable", table, "photo après prise sans les colonnes de la photo avant : relancer avec --before");
    else if (after.counts[table] === before.counts[table] && after.digests[table] !== before.digests[table]) {
      finding("critical", "values-changed", table, "valeurs historiques modifiées à nombre de lignes égal");
    }
  }
  const expectedTables = set(expected.tablesAdded);
  for (const table of after.tables) if (!before.tables.includes(table) && !expectedTables.has(table)) finding("warning", "table-unexpected", table, "table apparue sans migration annoncée");
  for (const table of expectedTables) {
    if (!after.tables.includes(table)) { finding("critical", "table-not-added", table, "table annoncée par la migration mais absente"); continue; }
    if (before.tables.includes(table)) continue;
    const afterCols = set((after.columns[table] ?? []).map((c) => c.name));
    for (const name of expected.columnsAdded[table] ?? []) if (!afterCols.has(name)) finding("critical", "column-not-added", `${table}.${name}`, "colonne annoncée par la migration mais absente");
  }
  for (const [name, values] of Object.entries(before.enums)) {
    const now = set(after.enums[name]);
    if (!after.enums[name]) { finding("critical", "enum-missing", name, "type énuméré absent"); continue; }
    for (const value of values) if (!now.has(value)) finding("critical", "enum-value-removed", `${name}.${value}`, "valeur d'énumération perdue");
    const expectedValues = set(expected.enumValuesAdded[name]);
    for (const value of now) if (!values.includes(value) && !expectedValues.has(value)) finding("warning", "enum-value-unexpected", `${name}.${value}`, "valeur ajoutée sans migration annoncée");
  }
  for (const name of Object.keys(after.enums)) if (!before.enums[name] && !expected.enumsAdded.includes(name)) finding("warning", "enum-unexpected", name, "type énuméré ajouté sans migration annoncée");
  for (const name of expected.enumsAdded) if (!after.enums[name]) finding("critical", "enum-not-added", name, "type annoncé par la migration mais absent");
  const afterIndexes = new Map(after.indexes.map((index) => [index.name, index.definition]));
  for (const index of before.indexes) {
    if (!afterIndexes.has(index.name)) finding("critical", "index-missing", index.name, "index perdu");
    else if (afterIndexes.get(index.name) !== index.definition) finding("critical", "index-changed", index.name, "définition d'index modifiée");
  }
  for (const index of after.indexes) if (!before.indexes.some((item) => item.name === index.name) && !expected.indexesAdded.includes(index.name)) finding("warning", "index-unexpected", index.name, "index ajouté sans migration annoncée");
  for (const name of expected.indexesAdded) if (!afterIndexes.has(name)) finding("critical", "index-not-added", name, "index annoncé par la migration mais absent");
  const beforeMigrations = set(before.migrations.map((m) => m.name));
  const afterMigrations = new Map(after.migrations.map((m) => [m.name, m]));
  for (const m of before.migrations) {
    const now = afterMigrations.get(m.name);
    if (!now) finding("critical", "migration-missing", m.name, "migration disparue de l'historique");
    else if (now.checksum !== m.checksum) finding("critical", "migration-checksum-changed", m.name, "somme de contrôle modifiée");
  }
  for (const m of after.migrations) {
    if (m.rolledBack) finding("critical", "migration-rolled-back", m.name, "migration marquée annulée");
    if (m.unfinished) finding("critical", "migration-unfinished", m.name, "migration commencée mais non terminée");
    if (!beforeMigrations.has(m.name) && !expected.migrations.includes(m.name)) finding("warning", "migration-unexpected", m.name, "migration appliquée sans être annoncée");
  }
  for (const name of expected.migrations) if (!afterMigrations.has(name)) finding("critical", "migration-not-applied", name, "migration annoncée mais absente de l'historique");
  const domainSame = (path, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) finding("critical", "domain-changed", path, "agrégat métier différent"); };
  if (before.domain.loans && after.domain.loans) {
    domainSame("loans.byStatus", before.domain.loans.byStatus, after.domain.loans.byStatus);
    domainSame("loans.byEscrow", before.domain.loans.byEscrow, after.domain.loans.byEscrow);
    domainSame("loans.withModel", before.domain.loans.withModel, after.domain.loans.withModel);
    for (const [column, filled] of Object.entries(after.domain.loans.billingColumnsFilled)) {
      if (filled > (before.domain.loans.billingColumnsFilled[column] ?? 0)) finding("critical", "billing-column-filled", `Loan.${column}`, "colonne v7 remplie pendant la migration : les historiques doivent rester vides");
    }
  }
  if (before.domain.datasets && after.domain.datasets) {
    domainSame("datasets.byStatus", before.domain.datasets.byStatus, after.domain.datasets.byStatus);
    domainSame("datasets.withActiveKey", before.domain.datasets.withActiveKey, after.domain.datasets.withActiveKey);
  }
  if (before.domain.trainingJobs && after.domain.trainingJobs) domainSame("trainingJobs.byStatus", before.domain.trainingJobs.byStatus, after.domain.trainingJobs.byStatus);
  domainSame("models", before.domain.models, after.domain.models);
  domainSame("receipts", before.domain.receipts, after.domain.receipts);
  const severity = { critical: 0, warning: 0, info: 0 };
  for (const item of findings) severity[item.severity]++;
  return { ok: severity.critical === 0, severity, findings, expected,
    note: "Comparaison de photos ; un résultat sans écart ne prouve pas la cohérence avec la chaîne ni les sauvegardes." };
}

export async function snapshotFromEnvFile(envFile, options = {}) {
  const env = parseEnv(readPrivateFile(envFile).toString());
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL absente du fichier d'environnement");
  const client = new pg.Client({ connectionString: url, application_name: "sirius-db-inventory", statement_timeout: 120_000, query_timeout: 120_000 });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return await inventory(client, options);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Usage :
  //   snapshot <env-prive> [--before=photo-avant.json]            photo JSON sur la sortie standard
  //   compare <avant.json> <apres.json> [--migrations=nom,nom] [--migrations-dir=prisma/migrations]
  //   expect --migrations=nom,nom [--migrations-dir=…]             changements annoncés par ces migrations
  (async () => {
    const [command, ...args] = process.argv.slice(2);
    const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
    const files = args.filter((arg) => !arg.startsWith("--"));
    const read = (path) => JSON.parse(readFileSync(path, "utf8"));
    const dirs = () => migrationDirectories(resolve(option("migrations-dir") ?? "prisma/migrations"), (option("migrations") ?? "").split(",").filter(Boolean));
    if (command === "snapshot" && files.length === 1) {
      const before = option("before") ? read(option("before")) : null;
      console.log(JSON.stringify(await snapshotFromEnvFile(files[0], { columns: before?.digestColumns }), null, 2));
    } else if (command === "compare" && files.length === 2) {
      const result = compareInventories(read(files[0]), read(files[1]), expectedChanges(dirs()));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? (result.severity.warning ? 1 : 0) : 2;
    } else if (command === "expect" && files.length === 0) {
      console.log(JSON.stringify(expectedChanges(dirs()), null, 2));
    } else throw new Error();
  })().catch(() => {
    console.error("Inventaire refusé : vérifier la commande, le fichier d'environnement privé, la connexion en lecture et les migrations nommées. Aucune donnée modifiée.");
    process.exitCode = 3;
  });
}
