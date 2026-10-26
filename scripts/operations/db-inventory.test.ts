import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import pg from "pg";
import { compareInventories, expectedChanges, inventory, migrationDirectories, receiptHeader } from "./db-inventory.mjs";

interface Finding { severity: string; code: string; ref: string | null }
const MIGRATIONS = resolve("prisma/migrations");
const PENDING = ["20260919000000_track_runner_provenance", "20260923000000_add_compute_billing"];
const codes = (result: { findings: Finding[] }) => result.findings.map((finding) => `${finding.code}:${finding.ref}`);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const receipt = (payload: Record<string, unknown>) => `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${randomBytes(32).toString("base64url")}`;

test("les attentes viennent des fichiers SQL des migrations en attente, pas d'une liste écrite à la main", () => {
  const expected = expectedChanges(migrationDirectories(MIGRATIONS, PENDING));
  assert.deepEqual(expected.migrations, PENDING);
  assert.deepEqual(expected.enumsAdded, ["RunnerKind"]);
  assert.deepEqual(expected.columnsAdded.Dataset, ["runnerKind", "runnerDeploymentId"]);
  assert.deepEqual(expected.columnsAdded.TrainingJob, ["runnerKind", "runnerDeploymentId"]);
  assert.deepEqual(expected.columnsAdded.Loan, ["runnerKind", "runnerDeploymentId", "billingQuote", "billingQuoteHash", "datasetAmountUsdcAtomic",
    "computeAmountUsdcAtomic", "maxFailureFeeUsdcAtomic", "retainedFeeUsdcAtomic", "refundAmountUsdcAtomic"]);
  assert.deepEqual(expected.columnsRemoved, {});
  // La migration historique de renommage est lue comme un retrait plus un ajout.
  const rename = expectedChanges(migrationDirectories(MIGRATIONS, ["20260903010000_add_loan_attestation_payload"]));
  assert.deepEqual(rename.columnsRemoved.Loan, ["auditTxHash"]);
  assert.deepEqual(rename.columnsAdded.Loan, ["auditReceipt", "attestationPayload"]);
  assert.throws(() => migrationDirectories(MIGRATIONS, ["20990101000000_nope"]), /inconnue/);
  // Une migration qui crée des tables annonce les tables, leurs clés primaires et leurs index.
  const profiles = expectedChanges(migrationDirectories(MIGRATIONS, ["20261003000000_add_user_profiles"]));
  assert.deepEqual(profiles.tablesAdded, ["DatasetAccessLog", "UserProfile"]);
  assert.deepEqual(profiles.columnsAdded.Dataset, ["category", "listingExpiresAt", "trainingConsentAt", "trainingConsentVersion", "trainingConsentRevokedAt"]);
  assert.deepEqual(profiles.columnsAdded.UserProfile, ["address", "tourCompletedAt", "featureTours", "settings", "kybStatus", "kybCheckedAt", "blockedAt", "blockedReason", "blockedBy", "createdAt", "lastSeenAt"]);
  assert.deepEqual(profiles.columnsAdded.DatasetAccessLog, ["id", "datasetId", "loanId", "address", "modelCid", "modelFingerprint", "createdAt"]);
  // Les tables historiques sont lues de la même façon, sans confondre une contrainte avec une colonne.
  const init = expectedChanges(migrationDirectories(MIGRATIONS, ["20260825000000_init_postgres"]));
  assert.ok(init.tablesAdded.includes("Loan") && init.tablesAdded.includes("KeyGrant"));
  assert.deepEqual(init.columnsAdded.KeyGrant, ["id", "datasetId", "loanId", "grantee", "keyRef", "status", "createdAt", "revokedAt"]);
  assert.deepEqual(profiles.indexesAdded, ["DatasetAccessLog_pkey", "DatasetAccessLog_datasetId_idx", "DatasetAccessLog_address_idx", "UserProfile_pkey"]);
  assert.deepEqual(profiles.columnsRemoved, {});
});

test("l'en-tête d'un reçu runner est lu sans vérifier ni exposer sa signature", () => {
  assert.equal(receiptHeader(receipt({ version: 2, kind: "loan", loanId: "x" })), "loan:v2");
  assert.equal(receiptHeader(receipt({ version: 3, kind: "training" })), "training:v3");
  assert.equal(receiptHeader("pas.un.reçu"), "invalid");
  assert.equal(receiptHeader(`${Buffer.from("{}").toString("base64url")}.${randomBytes(31).toString("base64url")}`), "invalid");
});

function photo(overrides: Record<string, unknown> = {}) {
  return {
    version: 1, kind: "sirius-db-inventory", observedAtMs: 1, schema: "public", tables: ["Loan"],
    columns: { Loan: [{ name: "id", type: "text", nullable: false, default: null }, { name: "amountUsdcAtomic", type: "text", nullable: false, default: null }] },
    enums: { LoanStatus: ["PENDING", "SETTLED"] }, indexes: [{ name: "Loan_pkey", definition: "CREATE UNIQUE INDEX Loan_pkey ON \"Loan\" USING btree (id)" }],
    migrations: [{ name: "20260825000000_init_postgres", checksum: "a", rolledBack: false, unfinished: false }],
    counts: { Loan: 10 }, digests: { Loan: "d1" }, digestColumns: { Loan: ["id", "amountUsdcAtomic"] },
    domain: { loans: { byStatus: { SETTLED: 10 }, byRunnerKind: null, byEscrow: [{ chainId: "31611", escrow: "0xabc", status: "SETTLED", loans: 10 }], billingColumnsFilled: {}, withModel: 10 },
      models: { distinctCids: 10, cidsDigest: "m" }, receipts: { Loan: { "loan:v2": 10 } } },
    ...overrides,
  };
}

test("deux photos identiques ne donnent aucun écart ; une migration annoncée mais absente est critique", () => {
  const before = photo();
  assert.equal(compareInventories(before, clone(before)).ok, true);
  const expected = expectedChanges(migrationDirectories(MIGRATIONS, PENDING));
  const result = compareInventories(before, clone(before), expected);
  assert.equal(result.ok, false);
  const found = codes(result);
  assert.ok(found.includes("migration-not-applied:20260923000000_add_compute_billing"));
  assert.ok(found.includes("column-not-added:Loan.billingQuote"));
  assert.ok(found.includes("enum-not-added:RunnerKind"));
});

test("lignes perdues, valeurs modifiées, colonne perdue, index perdu et colonne v7 remplie sont critiques", () => {
  const before = photo();
  const cases: Array<[(after: ReturnType<typeof photo>) => void, string]> = [
    [(after) => { after.counts = { Loan: 9 }; }, "rows-lost:Loan"],
    [(after) => { after.digests = { Loan: "d2" }; }, "values-changed:Loan"],
    [(after) => { (after.columns as { Loan: unknown[] }).Loan.pop(); after.digestColumns = { Loan: ["id"] }; }, "column-removed:Loan.amountUsdcAtomic"],
    [(after) => { after.indexes = []; }, "index-missing:Loan_pkey"],
    [(after) => { (after.domain as { loans: { billingColumnsFilled: Record<string, number> } }).loans.billingColumnsFilled = { billingQuote: 1 }; }, "billing-column-filled:Loan.billingQuote"],
    [(after) => { after.migrations = []; }, "migration-missing:20260825000000_init_postgres"],
    [(after) => { (after.domain as { loans: { byEscrow: unknown } }).loans.byEscrow = []; }, "domain-changed:loans.byEscrow"],
  ];
  for (const [change, expected] of cases) {
    const after = clone(before);
    change(after);
    const result = compareInventories(before, after);
    assert.equal(result.ok, false, expected);
    assert.ok(codes(result).includes(expected), expected);
  }
  const added = clone(before);
  added.columns.Loan.push({ name: "extra", type: "text", nullable: true, default: null });
  const result = compareInventories(before, added);
  assert.equal(result.ok, true);
  assert.ok(codes(result).includes("column-unexpected:Loan.extra"));
});

test("une table créée par une migration annoncée n'est pas un écart ; absente, elle est critique", () => {
  const before = photo();
  const expected = expectedChanges(migrationDirectories(MIGRATIONS, ["20261003000000_add_user_profiles"]));
  const after = clone(before) as ReturnType<typeof photo> & { columns: Record<string, unknown[]>; counts: Record<string, number> };
  after.tables = ["Loan", "UserProfile", "DatasetAccessLog"];
  const columnsOf = (table: string) => expected.columnsAdded[table].map((name) => ({ name, type: "text", nullable: true, default: null }));
  after.columns = { ...after.columns, UserProfile: columnsOf("UserProfile"), DatasetAccessLog: columnsOf("DatasetAccessLog") };
  after.counts = { ...after.counts, UserProfile: 0, DatasetAccessLog: 0 };
  after.indexes = [...after.indexes,
    { name: "UserProfile_pkey", definition: "CREATE UNIQUE INDEX \"UserProfile_pkey\" ON \"UserProfile\" USING btree (address)" },
    { name: "DatasetAccessLog_pkey", definition: "CREATE UNIQUE INDEX \"DatasetAccessLog_pkey\" ON \"DatasetAccessLog\" USING btree (id)" },
    { name: "DatasetAccessLog_datasetId_idx", definition: "CREATE INDEX \"DatasetAccessLog_datasetId_idx\" ON \"DatasetAccessLog\" USING btree (\"datasetId\")" },
    { name: "DatasetAccessLog_address_idx", definition: "CREATE INDEX \"DatasetAccessLog_address_idx\" ON \"DatasetAccessLog\" USING btree (address)" }];
  after.migrations = [...after.migrations, { name: "20261003000000_add_user_profiles", checksum: "b", rolledBack: false, unfinished: false }];
  const unexpected = compareInventories(before, after);
  assert.ok(codes(unexpected).includes("table-unexpected:UserProfile"));
  assert.ok(codes(unexpected).includes("index-unexpected:UserProfile_pkey"));
  // La photo synthétique n'a pas de table Dataset : ses colonnes ajoutées ne sont pas contrôlées ici
  // (la boucle des colonnes ne parcourt que les tables de la photo « avant »), le rejeu réel sur
  // PostgreSQL du test suivant les couvre.
  const announced = compareInventories(before, after, expected);
  assert.deepEqual(codes(announced), [], "tables, colonnes, clés primaires et index annoncés ne sont plus signalés");
  assert.equal(announced.ok, true);
  const missing = compareInventories(before, clone(before), expected);
  assert.equal(missing.ok, false);
  assert.ok(codes(missing).includes("table-not-added:UserProfile"));
  assert.ok(codes(missing).includes("table-not-added:DatasetAccessLog"));
  // Une table créée sans l'une de ses colonnes, ou sans un index annoncé, est un écart critique.
  const incomplete = clone(after);
  incomplete.columns.UserProfile = columnsOf("UserProfile").filter((c) => c.name !== "blockedBy");
  incomplete.indexes = incomplete.indexes.filter((index: { name: string }) => index.name !== "DatasetAccessLog_address_idx");
  const partial = compareInventories(before, incomplete, expected);
  assert.equal(partial.ok, false);
  assert.ok(codes(partial).includes("column-not-added:UserProfile.blockedBy"));
  assert.ok(codes(partial).includes("index-not-added:DatasetAccessLog_address_idx"));
});

const url = process.env.SIRIUS_TEST_DATABASE_URL ?? (process.env.CI ? process.env.DATABASE_URL : undefined);
test("répétition sur PostgreSQL : historiques intacts après les deux migrations, et une retouche de valeur est détectée",
  { skip: url ? false : "SIRIUS_TEST_DATABASE_URL absente", timeout: 120_000 }, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const schema = `inv_${randomBytes(4).toString("hex")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE _prisma_migrations (id text PRIMARY KEY, checksum text NOT NULL, finished_at timestamptz, migration_name text NOT NULL,
      logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)`);
    const names = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    const apply = async (name: string) => {
      await client.query(readFileSync(`${MIGRATIONS}/${name}/migration.sql`, "utf8"));
      await client.query("INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $1, 1)", [name, `sum-${name}`]);
    };
    for (const name of names.filter((n) => !PENDING.includes(n))) await apply(name);

    // Formes historiques : v5 et v6 réglés, un v6 encore verrouillé, un entraînement personnel, deux datasets.
    await client.query(`INSERT INTO "Dataset" (id, name, provider, "priceUsdcAtomic", status, "ipfsCid", "wrappedKey", "runnerReceipt", "updatedAt") VALUES
      ('ds-listed', 'A', '0xprov', '10000000000000000000', 'LISTED', 'bafy-a', 'wk-a', $1, now()),
      ('ds-deleted', 'B', '0xprov', '1', 'DELETED', NULL, NULL, NULL, now())`, [receipt({ version: 2, kind: "dataset" })]);
    await client.query(`INSERT INTO "TrainingJob" (id, "datasetId", owner, "modelCid", "runnerReceipt", status, "updatedAt") VALUES
      ('job-1', 'ds-listed', '0xprov', 'bafy-model-1', $1, 'DONE', now())`, [receipt({ version: 2, kind: "training", jobId: "job-1" })]);
    await client.query(`INSERT INTO "Loan" (id, "datasetId", borrower, provider, "amountUsdcAtomic", "evmChainId", "evmEscrowAddress", "modelCid", "runnerReceipt", status, "updatedAt") VALUES
      ('loan-v5', 'ds-listed', '0xb1', '0xprov', '10000000000000000000', 31611, '0xede81141d007593d4bfce2de4778f753d167700e', 'bafy-model-2', $1, 'SETTLED', now()),
      ('loan-v6', 'ds-listed', '0xb2', '0xprov', '10000000000000000000', 31611, '0x805a2c2deaa3a8926e85fed6b341dacb54cacba0', 'bafy-model-3', $2, 'SETTLED', now()),
      ('loan-open', 'ds-listed', '0xb3', '0xprov', '10000000000000000000', 31611, '0x805a2c2deaa3a8926e85fed6b341dacb54cacba0', NULL, NULL, 'ESCROWED', now())`,
      [receipt({ version: 2, kind: "loan", loanId: "loan-v5" }), receipt({ version: 3, kind: "loan", loanId: "loan-v6", modelId: "linear_regression" })]);
    await client.query(`INSERT INTO "KeyGrant" (id, "datasetId", "loanId", grantee, "keyRef", status) VALUES ('kg-1', 'ds-listed', 'loan-v6', '0xtee', 'ref', 'GRANTED')`);

    const before = await inventory(client, { now: 1 });
    assert.equal(before.counts.Loan, 3);
    assert.equal(before.domain.loans.byRunnerKind, null);
    assert.deepEqual(before.domain.receipts, { Dataset: { "dataset:v2": 1 }, TrainingJob: { "training:v2": 1 }, Loan: { "loan:v2": 1, "loan:v3": 1 } });
    assert.equal(before.domain.models.distinctCids, 3);

    for (const name of PENDING) await apply(name);
    const after = await inventory(client, { columns: before.digestColumns, now: 2 });
    const result = compareInventories(before, after, expectedChanges(migrationDirectories(MIGRATIONS, PENDING)));
    assert.deepEqual(result.findings, []);
    assert.equal(result.ok, true);
    assert.deepEqual(after.domain.loans.byRunnerKind, { UNKNOWN: 3 });
    assert.deepEqual(after.domain.loans.billingColumnsFilled, Object.fromEntries(["billingQuote", "billingQuoteHash", "datasetAmountUsdcAtomic",
      "computeAmountUsdcAtomic", "maxFailureFeeUsdcAtomic", "retainedFeeUsdcAtomic", "refundAmountUsdcAtomic"].map((c) => [c, 0])));
    assert.deepEqual(after.domain.datasets.toReimport, [{ id: "ds-listed", status: "LISTED" }]);
    assert.deepEqual(after.domain.loans.byEscrow!.map((row: { escrow: string; loans: number }) => [row.escrow, row.loans]),
      [["0x805a2c2deaa3a8926e85fed6b341dacb54cacba0", 1], ["0x805a2c2deaa3a8926e85fed6b341dacb54cacba0", 1], ["0xede81141d007593d4bfce2de4778f753d167700e", 1]]);

    // Une retouche silencieuse d'une valeur historique, à nombre de lignes égal, est détectée.
    await client.query(`UPDATE "Loan" SET "amountUsdcAtomic" = '1' WHERE id = 'loan-v5'`);
    const tampered = await inventory(client, { columns: before.digestColumns, now: 3 });
    const detected = compareInventories(before, tampered, expectedChanges(migrationDirectories(MIGRATIONS, PENDING)));
    assert.equal(detected.ok, false);
    assert.ok(codes(detected).includes("values-changed:Loan"));
    // Une photo « après » prise sans les colonnes de la photo « avant » n'est pas comparable et le dit.
    const fresh = await inventory(client, { now: 4 });
    assert.ok(codes(compareInventories(before, fresh)).includes("digest-not-comparable:Loan"));
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await client.end();
  }
});
