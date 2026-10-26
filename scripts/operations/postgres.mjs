import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { openArchive, privateFile, readPrivateFile, sealArchive } from "./archive.mjs";
import { historicalDeliveryInventory } from "./historical-delivery.mjs";

function postgresImage(version) {
  const major = Math.floor(version / 10000);
  if (![17, 18].includes(major)) throw new Error("Version PostgreSQL non prise en charge");
  return process.env.SIRIUS_POSTGRES_IMAGE || `postgres:${major}-alpine`;
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
const ROOT = resolve(".ops");
let phase = "arguments";

function command(args, { input, env = process.env, timeout = 120000 } = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn("docker", args, { env, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let bytes = 0;
    let failed = false;
    const timer = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, timeout);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) { failed = true; child.kill("SIGKILL"); }
      else chunks.push(chunk);
    });
    let diagnostic = "";
    child.stderr.on("data", (chunk) => { if (diagnostic.length < 8192) diagnostic += chunk.toString(); });
    child.on("error", () => { clearTimeout(timer); reject(new Error("Docker indisponible")); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code || failed) {
        const error = new Error("Opération PostgreSQL refusée ou interrompue");
        error.code = /role .*does not exist/.test(diagnostic) ? "ROLE_MISSING" : /schema .*does not exist/.test(diagnostic) ? "SCHEMA_MISSING"
          : /extension .*does not exist/.test(diagnostic) ? "EXTENSION_MISSING" : /type .*does not exist/.test(diagnostic) ? "TYPE_MISSING"
          : /already exists/.test(diagnostic) ? "OBJECT_EXISTS" : /permission denied/.test(diagnostic) ? "PERMISSION"
          : /does not exist/.test(diagnostic) ? "OBJECT_MISSING" : /No space left/.test(diagnostic) ? "DISK_FULL" : "COMMAND_FAILED";
        reject(error);
      }
      else resolveCommand(Buffer.concat(chunks));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function sourceConfiguration(file) {
  const values = parseEnv(readPrivateFile(file).toString());
  const url = new URL(values.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.password) throw new Error("Source PostgreSQL explicite requise");
  // Le dump utilise une session directe, sans dépendre du pooler transactionnel Neon.
  const host = url.hostname.endsWith(".neon.tech") ? url.hostname.replace(/-pooler(?=\.)/, "") : url.hostname;
  if (["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Cette commande sauvegarde une source distante TLS explicite");
  return { host, port: Number(url.port || 5432), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)) };
}

async function inventory(query, shape) {
  const tables = shape || (await query(`SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)).rows;
  const result = [];
  for (const table of tables) {
    const columns = table.columns || (await query(`SELECT column_name AS name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table.name])).rows.map((column) => column.name);
    const rows = (await query(`SELECT row_to_json(t)::text AS content FROM
      (SELECT ${columns.map(identifier).join(", ")} FROM public.${identifier(table.name)}) t ORDER BY row_to_json(t)::text`)).rows;
    result.push({ name: table.name, columns, count: rows.length, sha256: digest(rows.map((row) => row.content).sort().join("\n")) });
  }
  return result;
}

async function backup(envFile) {
  phase = "configuration-source";
  const source = sourceConfiguration(envFile);
  const client = new pg.Client({ ...source, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000,
    statement_timeout: 60000, application_name: "sirius-readonly-backup" });
  let id;
  try {
    phase = "connexion-source";
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const serverVersion = Number((await client.query("SHOW server_version_num")).rows[0].server_version_num);
    const image = postgresImage(serverVersion);
    const snapshot = (await client.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
    phase = "inventaire-source";
    const tables = await inventory(client.query.bind(client));
    const migrations = (await client.query('SELECT migration_name AS name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
    const models = (await client.query(`SELECT 'loan' AS kind, id, "modelCid" AS cid FROM "Loan" WHERE "modelCid" IS NOT NULL
      UNION ALL SELECT 'training', id, "modelCid" FROM "TrainingJob" WHERE "modelCid" IS NOT NULL`)).rows;
    const pgEnv = { ...process.env, PGHOST: source.host, PGPORT: String(source.port), PGUSER: source.user,
      PGPASSWORD: source.password, PGDATABASE: source.database, PGSSLMODE: "verify-full", PGSSLROOTCERT: "system",
      PGCONNECT_TIMEOUT: "15", PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=10000" };
    console.log("Snapshot cohérent ouvert en lecture seule ; export chiffré en préparation.");
    phase = "export-source";
    const dump = await command(["run", "--rm", ...Object.keys(pgEnv).filter((name) => name.startsWith("PG")).flatMap((name) => ["--env", name]),
      image, "pg_dump", "--format=custom", "--no-owner", "--no-acl", "--schema=public", `--snapshot=${snapshot}`], { env: pgEnv });
    await client.query("COMMIT");
    phase = "chiffrement-sauvegarde";
    id = `snapshot-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`;
    const directory = join(ROOT, id);
    const keyDirectory = join(homedir(), ".local", "share", "sirius", "backup-keys");
    mkdirSync(ROOT, { recursive: true, mode: 0o700 });
    mkdirSync(directory, { mode: 0o700 });
    mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
    const keyPath = join(keyDirectory, `${id}.key`);
    const key = randomBytes(32);
    privateFile(keyPath, key);
    const archive = { version: 1, createdAt: new Date().toISOString(), sourceFingerprint: digest(`${source.host}/${source.database}`),
      serverVersion, tables, migrations, models, dump: dump.toString("base64"), dumpSha256: digest(dump) };
    privateFile(join(directory, "database.aesgcm"), sealArchive(archive, key));
    key.fill(0); dump.fill(0);
    const manifest = { id, createdAt: archive.createdAt, sourceFingerprint: archive.sourceFingerprint, serverVersion,
      tables: tables.map(({ name, count, sha256 }) => ({ name, count, sha256 })), models: models.length,
      keyFile: keyPath, migrations: migrations.map(({ name }) => name), restoreVerified: false };
    privateFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ directory, keyFile: keyPath, tables: tables.length, models: models.length, restoreVerified: false }));
  } finally { await client.end(); }
  return id;
}

async function verify(directory, keyFile) {
  phase = "authentification-archive";
  const archive = openArchive(readPrivateFile(join(directory, "database.aesgcm")), readPrivateFile(keyFile));
  const dump = Buffer.from(archive.dump, "base64");
  if (archive.version !== 1 || digest(dump) !== archive.dumpSha256) throw new Error("Archive incohérente");
  const name = `sirius-restore-${randomUUID()}`;
  const image = postgresImage(archive.serverVersion);
  let created = false;
  try {
    phase = "postgres-local";
    await command(["run", "--detach", "--name", name, "--network", "none", "--memory", "384m", "--cpus", "1",
      "--tmpfs", "/var/lib/postgresql:rw,noexec,nosuid,size=256m", "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
      "--env", "PGDATA=/var/lib/postgresql/data", "--env", "POSTGRES_DB=sirius_restore", image]);
    created = true;
    for (let attempt = 0; ; attempt++) {
      try { await command(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "sirius_restore"], { timeout: 5000 }); break; }
      catch { if (attempt >= 30) throw new Error("PostgreSQL local indisponible"); await delay(300); }
    }
    phase = "restauration-locale";
    await command(["exec", "-i", name, "pg_restore", "--exit-on-error", "--single-transaction", "--clean", "--if-exists", "--no-owner", "--no-acl", "-U", "postgres", "-d", "sirius_restore"], { input: dump });
    const sql = async (statement) => (await command(["exec", "-i", name, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "sirius_restore"], { input: statement })).toString().trim();
    const query = async (statement) => {
      const text = await sql(`SELECT COALESCE(json_agg(q), '[]'::json) FROM (${statement}) q;`);
      return { rows: JSON.parse(text) };
    };
    phase = "comparaison-restauration";
    const restored = await inventory(query, archive.tables);
    if (JSON.stringify(restored) !== JSON.stringify(archive.tables)) throw new Error("Restauration différente de la source");
    phase = "verification-historique-migrations";
    const available = readdirSync("prisma/migrations").filter((file) => /^\d+_/.test(file)).sort();
    for (const [index, migration] of archive.migrations.entries()) {
      if (available[index] !== migration.name || digest(readFileSync(join("prisma/migrations", migration.name, "migration.sql"))) !== migration.checksum) {
        throw new Error("Historique des migrations divergent");
      }
    }
    const applied = [];
    phase = "migration-locale";
    for (const migration of available.slice(archive.migrations.length)) {
      await sql(`BEGIN;\n${readFileSync(join("prisma/migrations", migration, "migration.sql"), "utf8")}\nCOMMIT;`);
      applied.push(migration);
    }
    phase = "comparaison-apres-migration";
    const migrated = await inventory(query, archive.tables);
    if (JSON.stringify(migrated) !== JSON.stringify(archive.tables)) throw new Error("La migration altère les données historiques");
    phase = "inventaire-livraison-historique";
    const historical = historicalDeliveryInventory((await query(`SELECT 'loan' AS kind, id, "datasetId", borrower AS subject,
      "modelCid" AS cid, "modelId", "modelVersion", "runnerReceipt" AS receipt, status::text,
      "evmChainId" AS "chainId", "evmEscrowAddress" AS escrow, "evmLoanKey" AS "loanKey"
      FROM "Loan" WHERE "modelCid" IS NOT NULL UNION ALL
      SELECT 'training', id, "datasetId", owner, "modelCid", "modelId", "modelVersion", "runnerReceipt", status::text,
      NULL::integer, NULL::text, NULL::text FROM "TrainingJob" WHERE "modelCid" IS NOT NULL`)).rows);
    privateFile(join(directory, `historical-delivery-${Date.now()}.json`), JSON.stringify(historical, null, 2));
    const report = { checkedAt: new Date().toISOString(), sourceFingerprint: archive.sourceFingerprint,
      restoredTables: restored.length, allHistoricalRowsIdentical: true, pendingMigrationsAppliedLocally: applied,
      sourceMutated: false, remoteRestorePossible: false, historicalModels: archive.models.length, modelDecryptionVerified: false,
      historicalMetadataConsistent: historical.metadataConsistent, historicalMetadataCompatible: historical.metadataCompatible,
      historicalLegacyProfilesUnattested: historical.legacyProfileUnattested, historicalWalletsRequired: historical.requiredWallets };
    privateFile(join(directory, `restore-${Date.now()}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    dump.fill(0);
    if (created) await command(["rm", "--force", name]);
  }
}

const [operation, arg, keyFile, ...extra] = process.argv.slice(2);
try {
  if (operation === "backup" && arg && !keyFile) await backup(resolve(arg));
  else if (operation === "verify" && arg && keyFile && !extra.length) await verify(resolve(arg), resolve(keyFile));
  else throw new Error("Usage : ops:postgres backup <fichier-env> | verify <dossier-sauvegarde> <fichier-clé>");
} catch (error) {
  const code = typeof error.code === "string" && /^[A-Z0-9_]{1,24}$/.test(error.code) ? error.code : "REFUSED";
  console.error(`Opération arrêtée (${phase}, ${code}) : vérifier source explicite, TLS, Docker, permissions et compatibilité PostgreSQL. Aucun secret affiché ; aucune restauration distante disponible.`);
  process.exitCode = 1;
}
