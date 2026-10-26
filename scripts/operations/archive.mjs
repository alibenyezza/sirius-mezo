import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const MAGIC = Buffer.from("SIRIUS-BACKUP-1\n");

export function privateFile(path, contents) {
  const parent = lstatSync(dirname(resolve(path)));
  if (!parent.isDirectory() || (parent.mode & 0o077)) throw new Error("Répertoire privé 0700 requis");
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
  const directory = openSync(dirname(resolve(path)), constants.O_RDONLY);
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

export function readPrivateFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || (stat.mode & 0o077)) throw new Error("Fichier privé 0600 requis");
  return readFileSync(path);
}

export function sealArchive(value, key) {
  if (key.length !== 32) throw new Error("Clé de sauvegarde invalide");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
}

export function openArchive(bytes, key) {
  if (key.length !== 32 || bytes.length < MAGIC.length + 29 || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Sauvegarde invalide");
  }
  const offset = MAGIC.length;
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(offset, offset + 12));
  cipher.setAAD(MAGIC);
  cipher.setAuthTag(bytes.subarray(offset + 12, offset + 28));
  const plaintext = Buffer.concat([cipher.update(bytes.subarray(offset + 28)), cipher.final()]);
  try { return JSON.parse(plaintext.toString()); } finally { plaintext.fill(0); }
}
