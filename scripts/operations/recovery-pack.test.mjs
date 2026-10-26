import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openArchive, privateFile, sealArchive } from "./archive.mjs";
import { createRecoveryPack, inspectRecoveryPack, unpackRecoveryPack } from "./recovery-pack.mjs";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "sirius-recovery-pack-"));
  const models = join(directory, "models");
  mkdirSync(models, { mode: 0o700 });
  const key = randomBytes(32);
  const hash = (data) => createHash("sha256").update(data).digest("hex");
  const dump = Buffer.from("synthetic-database");
  privateFile(join(directory, "database.aesgcm"), sealArchive({ version: 1, dump: dump.toString("base64"),
    dumpSha256: hash(dump), tables: [{ name: "Loan" }], models: [{ cid: "synthetic-cid" }] }, key));
  const blob = Buffer.from("original-model-ciphertext");
  privateFile(join(models, "0.aesgcm"), sealArchive({ version: 1, cid: "synthetic-cid", sha256: hash(blob), data: blob.toString("base64") }, key));
  privateFile(join(models, "manifest.json"), JSON.stringify({ results: [{ file: "0.aesgcm", copiedAndVerified: true }] }));
  return { directory, models, key };
}

test("le paquet se restaure hors du dossier source sans clé embarquée ni modèle en clair", () => {
  const { directory, models, key } = fixture();
  try {
    const packed = createRecoveryPack(directory, models, key);
    assert.ok(!packed.includes(Buffer.from("synthetic-database")));
    assert.ok(!packed.includes(key));
    const destination = join(directory, "restored");
    const result = unpackRecoveryPack(packed, key, destination);
    assert.equal(result.models.length, 1);
    assert.equal(statSync(join(destination, "database.aesgcm")).mode & 0o777, 0o600);
    assert.deepEqual(readFileSync(join(destination, "database.aesgcm")), readFileSync(join(directory, "database.aesgcm")));
    assert.deepEqual(readFileSync(join(destination, "models/0.aesgcm")), readFileSync(join(models, "0.aesgcm")));
    assert.throws(() => unpackRecoveryPack(packed, key, destination));
    assert.equal(inspectRecoveryPack(createRecoveryPack(destination, join(destination, "models"), key), key).models.length, 1);
  } finally { key.fill(0); rmSync(directory, { recursive: true, force: true }); }
});

test("le paquet refuse clés erronées, corruption, modèles manquants, substitutions et doublons", () => {
  const { directory, models, key } = fixture();
  try {
    const encrypted = createRecoveryPack(directory, models, key);
    assert.throws(() => inspectRecoveryPack(encrypted, randomBytes(32)));
    const modified = Buffer.from(encrypted); modified[modified.length - 1] ^= 1;
    assert.throws(() => inspectRecoveryPack(modified, key));
    const pack = openArchive(encrypted, key);
    assert.throws(() => inspectRecoveryPack(sealArchive({ ...pack, models: [] }, key), key));
    assert.throws(() => inspectRecoveryPack(sealArchive({ ...pack, models: [...pack.models, ...pack.models] }, key), key));
    const model = openArchive(Buffer.from(pack.models[0], "base64"), key);
    for (const invalid of [{ ...model, cid: "another-cid" }, { ...model, sha256: "0".repeat(64) }]) {
      assert.throws(() => inspectRecoveryPack(sealArchive({ ...pack, models: [sealArchive(invalid, key).toString("base64")] }, key), key));
    }
  } finally { key.fill(0); rmSync(directory, { recursive: true, force: true }); }
});
