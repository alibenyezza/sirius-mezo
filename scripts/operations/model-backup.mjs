import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { openArchive, privateFile, readPrivateFile, sealArchive } from "./archive.mjs";

async function download(url) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw new Error("Blob indisponible");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("Blob trop volumineux"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error("Blob vide");
  return Buffer.concat(chunks);
}

try {
  const [directoryArg, keyFile, envFile, ...extra] = process.argv.slice(2);
  if (!directoryArg || !keyFile || !envFile || extra.length) throw new Error("Arguments invalides");
  const directory = resolve(directoryArg);
  const key = readPrivateFile(keyFile);
  const archive = openArchive(readPrivateFile(join(directory, "database.aesgcm")), key);
  const env = parseEnv(readPrivateFile(envFile).toString());
  const gateway = new URL(env.PINATA_GATEWAY);
  if (gateway.protocol !== "https:" || gateway.username || gateway.password || gateway.search || gateway.hash) throw new Error("Gateway HTTPS requise");
  const output = join(directory, `models-${Date.now()}`);
  mkdirSync(output, { mode: 0o700 });
  const cids = [...new Set(archive.models.map((model) => model.cid))];
  const results = [];
  for (const [index, cid] of cids.entries()) {
    try {
      if (typeof cid !== "string" || !/^[a-zA-Z0-9]{32,128}$/.test(cid)) throw new Error("CID invalide");
      const blob = await download(`${gateway.href.replace(/\/+$/, "")}/ipfs/${encodeURIComponent(cid)}`);
      const sha256 = createHash("sha256").update(blob).digest("hex");
      const file = `${index}.aesgcm`;
      privateFile(join(output, file), sealArchive({ version: 1, cid, sha256, data: blob.toString("base64") }, key));
      const reread = openArchive(readPrivateFile(join(output, file)), key);
      if (createHash("sha256").update(Buffer.from(reread.data, "base64")).digest("hex") !== sha256) throw new Error("Copie invalide");
      results.push({ cid, file, bytes: blob.length, sha256, copiedAndVerified: true });
    } catch { results.push({ cid, copiedAndVerified: false }); }
  }
  const report = { checkedAt: new Date().toISOString(), historicalReferences: archive.models.length,
    uniqueBlobs: cids.length, copiedAndVerified: results.filter((item) => item.copiedAndVerified).length,
    modelDecryptionVerified: false, originalEncryptionPreserved: true, results };
  privateFile(join(output, "manifest.json"), JSON.stringify(report, null, 2));
  key.fill(0);
  console.log(JSON.stringify({ directory: output, historicalReferences: report.historicalReferences,
    uniqueBlobs: report.uniqueBlobs, copiedAndVerified: report.copiedAndVerified, modelDecryptionVerified: false }));
  if (report.copiedAndVerified !== cids.length) process.exitCode = 1;
} catch {
  console.error("Sauvegarde modèles interrompue : vérifier archive, clé et gateway. Aucune clé historique extraite ni opération runner exécutée.");
  process.exitCode = 1;
}
