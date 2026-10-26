import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openArchive, privateFile, readPrivateFile, sealArchive } from "./archive.mjs";

test("l’archive authentifiée refuse modification, autre clé et format inconnu", () => {
  const key = randomBytes(32);
  const content = { dump: "secret-synthetique", version: 1 };
  const archive = sealArchive(content, key);
  assert.ok(!archive.includes(Buffer.from(content.dump)));
  assert.deepEqual(openArchive(archive, key), content);
  assert.throws(() => openArchive(archive, randomBytes(32)));
  for (const index of [0, 16, 30, archive.length - 1]) {
    const modified = Buffer.from(archive); modified[index] ^= 1;
    assert.throws(() => openArchive(modified, key));
  }
});

test("les artefacts privés ne remplacent jamais une sauvegarde existante", () => {
  const directory = mkdtempSync(join(tmpdir(), "sirius-archive-"));
  try {
    const path = join(directory, "backup");
    privateFile(path, "ciphertext");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(readPrivateFile(path).toString(), "ciphertext");
    assert.throws(() => privateFile(path, "remplacement"));
    assert.equal(readFileSync(path, "utf8"), "ciphertext");
  } finally { rmSync(directory, { recursive: true }); }
});
