import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openArchive, privateFile, readPrivateFile, sealArchive } from "./archive.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const MAX_PACK_BYTES = 128 * 1024 * 1024;

function bytes(value) {
  if (typeof value !== "string" || value.length > MAX_PACK_BYTES * 2) throw new Error("Contenu invalide");
  const result = Buffer.from(value, "base64");
  if (!result.length || result.length > MAX_PACK_BYTES || result.toString("base64") !== value) throw new Error("Contenu invalide");
  return result;
}

export function validateRecoveryPack(pack, key) {
  if (pack?.version !== 1 || pack.kind !== "sirius-recovery" || !Array.isArray(pack.models)) throw new Error("Paquet invalide");
  const database = bytes(pack.database);
  const archive = openArchive(database, key);
  const dump = bytes(archive.dump);
  try {
    if (archive.version !== 1 || digest(dump) !== archive.dumpSha256 || !Array.isArray(archive.models)
      || !Array.isArray(archive.tables)) throw new Error("Base incohérente");
  } finally { dump.fill(0); }
  const expected = new Set(archive.models.map((model) => model.cid));
  if (pack.models.length !== expected.size || expected.size > 10000) throw new Error("Modèles incomplets");
  const seen = new Set();
  const models = pack.models.map((encoded) => {
    const encrypted = bytes(encoded);
    const model = openArchive(encrypted, key);
    const blob = bytes(model.data);
    if (model.version !== 1 || !expected.has(model.cid) || seen.has(model.cid) || digest(blob) !== model.sha256) {
      throw new Error("Modèle incohérent");
    }
    seen.add(model.cid);
    return { encrypted, cid: model.cid, sha256: model.sha256, bytes: blob.length };
  });
  return { database, models, archive };
}

export function createRecoveryPack(snapshotDirectory, modelsDirectory, key) {
  const database = readPrivateFile(join(snapshotDirectory, "database.aesgcm"));
  const manifest = JSON.parse(readPrivateFile(join(modelsDirectory, "manifest.json")).toString());
  if (!Array.isArray(manifest.results) || manifest.results.length > 10000) throw new Error("Inventaire invalide");
  const models = manifest.results.map((item) => {
    if (!item.copiedAndVerified || !/^\d+\.aesgcm$/.test(item.file)) throw new Error("Copie modèle absente");
    return readPrivateFile(join(modelsDirectory, item.file)).toString("base64");
  });
  const pack = { version: 1, kind: "sirius-recovery", createdAt: new Date().toISOString(), database: database.toString("base64"), models };
  validateRecoveryPack(pack, key);
  const sealed = sealArchive(pack, key);
  if (sealed.length > MAX_PACK_BYTES) throw new Error("Paquet trop volumineux");
  return sealed;
}

export function inspectRecoveryPack(encrypted, key) {
  if (encrypted.length > MAX_PACK_BYTES) throw new Error("Paquet trop volumineux");
  const pack = openArchive(encrypted, key);
  return validateRecoveryPack(pack, key);
}

export function unpackRecoveryPack(encrypted, key, destination) {
  const verified = inspectRecoveryPack(encrypted, key);
  mkdirSync(destination, { mode: 0o700 });
  const modelsDirectory = join(destination, "models");
  mkdirSync(modelsDirectory, { mode: 0o700 });
  privateFile(join(destination, "database.aesgcm"), verified.database);
  const results = verified.models.map((model, index) => {
    const file = `${index}.aesgcm`;
    privateFile(join(modelsDirectory, file), model.encrypted);
    return { cid: model.cid, file, bytes: model.bytes, sha256: model.sha256, copiedAndVerified: true };
  });
  privateFile(join(modelsDirectory, "manifest.json"), JSON.stringify({ results, modelDecryptionVerified: false }, null, 2));
  return verified;
}

async function main() {
  const [operation, ...args] = process.argv.slice(2);
  let key;
  try {
    let encrypted;
    let verified;
    if (operation === "pack" && args.length === 4) {
      const [snapshotDirectory, modelsDirectory, keyFile, destination] = args.map((arg) => resolve(arg));
      key = readPrivateFile(keyFile);
      encrypted = createRecoveryPack(snapshotDirectory, modelsDirectory, key);
      privateFile(destination, encrypted);
      verified = inspectRecoveryPack(readPrivateFile(destination), key);
    } else if (["verify", "unpack"].includes(operation) && args.length === (operation === "verify" ? 2 : 3)) {
      encrypted = readPrivateFile(resolve(args[0]));
      key = readPrivateFile(resolve(args[1]));
      verified = operation === "verify" ? inspectRecoveryPack(encrypted, key)
        : unpackRecoveryPack(encrypted, key, resolve(args[2]));
    } else throw new Error("Arguments invalides");
    console.log(JSON.stringify({ operation, sha256: digest(encrypted), bytes: encrypted.length,
      tables: verified.archive.tables.length, historicalReferences: verified.archive.models.length,
      verifiedModelBlobs: verified.models.length, containsBackupKey: false, modelDecryptionVerified: false }));
  } catch {
    console.error("Paquet refusé : vérifier arguments, clé séparée, permissions, intégrité et présence de tous les modèles. Aucune sauvegarde existante remplacée.");
    process.exitCode = 1;
  } finally { key?.fill(0); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
