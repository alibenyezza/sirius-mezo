import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { parseDelegationMessage, runnerGrantMessage, runnerIntent, type RunnerDelegation, type RunnerGrantPayload } from "../../src/lib/runner/authorization-contract";
import { createRunnerDelivery } from "../../src/lib/runner/delivery-client";
import { decryptModelPayload } from "../../src/lib/train/model-client";
import type { RunnerDeliveryEnvelope } from "../../src/lib/tee/contract";
import { openArchive, privateFile, readPrivateFile, sealArchive } from "./archive.mjs";

type HistoricalModel = { kind: "loan" | "training"; id: string; subject: string; state: string };
type ListedModel = { id: string; borrower?: string; owner?: string; modelCid?: string; runnerReceipt?: string; status: string };
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export function validateDeliveryChallenge(message: string, origin: string, address: string, sessionPublicKey: string, now = Date.now()) {
  const fields = parseDelegationMessage(message);
  if (!fields || fields.origin !== origin || fields.address !== address || fields.sessionPublicKey !== sessionPublicKey
    || fields.network !== "testnet" || fields.issuedAt < now - 300000 || fields.issuedAt > now + 30000
    || fields.issuedAt >= fields.expiresAt || fields.expiresAt <= now || fields.expiresAt - fields.issuedAt > 7 * 86400000) {
    throw new Error("Challenge hors scope");
  }
  return fields;
}

export function ownedHistoricalModels(value: unknown, address: string): HistoricalModel[] {
  const rows = (value as { results?: HistoricalModel[] } | null)?.results;
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error("Inventaire invalide");
  return rows.filter((row) => row.subject === address).map((row) => {
    if (!["loan", "training"].includes(row.kind) || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.id)
      || !["metadata-consistent", "legacy-profile-unattested"].includes(row.state)) throw new Error("Historique hors scope");
    return row;
  });
}

async function readResponse(response: Response) {
  if (!response.body) throw new Error("Réponse vide");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("Réponse trop volumineuse"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function verifyHistoricalModels(args: string[]) {
  let phase = "arguments";
  let httpStatus: number | undefined;
  let backupKey: Buffer | undefined;
  try {
    const [originArg, envFile, inventoryFile, snapshotDirectory, modelManifestFile, backupKeyFile, outputDirectory, ...extra] = args;
    if (!outputDirectory || extra.length) throw new Error();
    const target = new URL(originArg);
    if (target.protocol !== "https:" || target.username || target.password || target.pathname !== "/" || target.search || target.hash) throw new Error();
    const origin = target.origin;
    const env = parseEnv(readPrivateFile(resolve(envFile)).toString());
    const raw = env.MEZO_DEPLOYER_KEY;
    if (typeof raw !== "string" || !/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) throw new Error();
    const account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`);
    const address = account.address.toLowerCase();
    const expected = ownedHistoricalModels(JSON.parse(readPrivateFile(resolve(inventoryFile)).toString()), address);
    if (!expected.length || expected.length > 13) throw new Error("Aucun modèle accessible");
    backupKey = readPrivateFile(resolve(backupKeyFile));
    const archive = openArchive(readPrivateFile(join(resolve(snapshotDirectory), "database.aesgcm")), backupKey);
    const blobs = JSON.parse(readPrivateFile(resolve(modelManifestFile)).toString()) as {
      results: Array<{ cid: string; sha256: string; copiedAndVerified: boolean }>;
    };
    const expectedCids = new Map<string, string>((archive.models as Array<{ kind: string; id: string; cid: string }>).map((row) => [`${row.kind}:${row.id}`, row.cid]));
    const directory = resolve(outputDirectory);
    mkdirSync(directory, { mode: 0o700 });
    let cookie = "";
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(new URL(path, origin), {
        method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(60000),
        headers: { origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      httpStatus = response.status;
      const bytes = await readResponse(response);
      if (!response.ok) throw new Error("Requête refusée");
      return { value: JSON.parse(bytes.toString()), bytes, headers: response.headers };
    };
    const session = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const sessionPublicKey = Buffer.from(await crypto.subtle.exportKey("spki", session.publicKey)).toString("base64url");
    phase = "challenge";
    const challenge = (await request("/api/auth/challenge", { address, runnerSessionPublicKey: sessionPublicKey })).value as { challenge: string };
    const fields = validateDeliveryChallenge(challenge.challenge, origin, address, sessionPublicKey);
    const walletSignature = await account.signMessage({ message: challenge.challenge });
    const delegation: RunnerDelegation = { message: challenge.challenge, walletSignature, sessionPublicKey };
    phase = "connexion";
    const verified = await request("/api/auth/verify", { address, message: challenge.challenge, signature: walletSignature, source: "external" });
    if (verified.value.address !== address) throw new Error();
    const token = verified.headers.getSetCookie().map((value) => value.split(";")[0]).find((value) => /^sirius_session=[^;\s]+$/.test(value));
    if (!token) throw new Error();
    cookie = token;
    const results = [];
    let completed = false;
    try {
      phase = "historique-proprietaire";
      const listed = new Map<string, ListedModel>();
      for (const kind of new Set(expected.map((item) => item.kind))) {
        const items = (await request(kind === "loan" ? "/api/loans" : "/api/train")).value as ListedModel[];
        if (!Array.isArray(items)) throw new Error();
        for (const item of items) listed.set(`${kind}:${item.id}`, item);
      }
      for (const item of expected) {
        phase = "coherence-modele";
        const loan = item.kind === "loan";
        const row = listed.get(`${item.kind}:${item.id}`);
        const cid = expectedCids.get(`${item.kind}:${item.id}`);
        const blob = blobs.results.find((value) => value.cid === cid && value.copiedAndVerified);
        if (!row || (loan ? row.borrower : row.owner) !== address || row.status !== (loan ? "SETTLED" : "DONE")
          || !row.runnerReceipt || row.runnerReceipt.length > 8192 || !cid || row.modelCid !== cid || !blob) throw new Error();
        const delivery = await createRunnerDelivery(`${loan ? "loan" : "self-train"}:${address}:${item.id}`);
        const now = Date.now();
        const payload: RunnerGrantPayload = { version: 1, operation: loan ? "loan-model-key" : "self-train-key",
          subject: address, network: "testnet", ...(loan ? { loanId: item.id } : { jobId: item.id }),
          payloadHash: createHash("sha256").update(runnerIntent([item.id, row.runnerReceipt, delivery.publicKey])).digest("hex"),
          nonce: randomBytes(18).toString("base64url"), issuedAt: now, expiresAt: Math.min(now + 60000, fields.expiresAt) };
        const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, session.privateKey,
          new TextEncoder().encode(runnerGrantMessage(payload)))).toString("base64url");
        phase = "livraison-cle";
        const response = (await request(`/api/${loan ? "loans" : "train"}/${encodeURIComponent(item.id)}/key`, {
          authorization: { delegation, payload, signature }, deliveryPublicKey: delivery.publicKey,
        })).value as { modelCid: string; modelKeyEnvelope: RunnerDeliveryEnvelope };
        if (response.modelCid !== cid) throw new Error();
        const modelKey = await delivery.decrypt(response.modelKeyEnvelope);
        phase = "verification-blob";
        const downloaded = await request(`/api/models/${encodeURIComponent(cid)}`);
        if (createHash("sha256").update(downloaded.bytes).digest("hex") !== blob.sha256) throw new Error();
        phase = "dechiffrement-modele";
        const model = await decryptModelPayload(downloaded.value, modelKey).catch(() => {
          privateFile(join(directory, "delivery-diagnostic.aesgcm"), sealArchive({ version: 1, kind: "unverified-model-delivery",
            owner: address, modelKind: item.kind, id: item.id, cid, modelKey, encryptedModel: downloaded.value }, backupKey));
          throw new Error("Modèle non ouvert");
        });
        const keyArchive = join(directory, `${item.kind}-${item.id}.aesgcm`);
        privateFile(keyArchive, sealArchive({ version: 1, kind: "verified-model-key",
          owner: address, modelKind: item.kind, id: item.id, cid, modelKey, blobSha256: blob.sha256,
          modelId: model.algo, modelVersion: model.version ?? null, verifiedAt: new Date().toISOString() }, backupKey));
        const reread = openArchive(readPrivateFile(keyArchive), backupKey);
        if (reread.modelKey !== modelKey || reread.cid !== cid || reread.owner !== address) throw new Error();
        results.push({ kind: item.kind, id: item.id, cid, blobIdentical: true, modelDecryptionVerified: true });
      }
      completed = true;
    } finally {
      const report = { checkedAt: new Date().toISOString(), origin, owner: address, expectedModels: expected.length,
        verifiedModels: results.length, completeForWallet: completed, historicalModels: archive.models.length,
        trainingStarted: false, transactionSent: false, masterKeyExported: false, results,
        ...(completed ? {} : { failurePhase: phase, httpStatus }) };
      privateFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
      await request("/api/auth/logout", {}).catch(() => {});
      cookie = "";
      if (completed) console.log(JSON.stringify({ verifiedModels: results.length, historicalModels: archive.models.length,
        modelKeysBackedUpEncrypted: results.length, trainingStarted: false, transactionSent: false }));
    }
  } catch {
    console.error(JSON.stringify({ operation: "historical-model-delivery", phase, httpStatus, verified: false,
      message: "Vérification interrompue ; aucun secret ni modèle en clair enregistré dans les logs." }));
    process.exitCode = 1;
  } finally { backupKey?.fill(0); }
}
