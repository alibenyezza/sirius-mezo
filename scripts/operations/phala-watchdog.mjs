import { execFileSync } from "node:child_process";
import { readPrivateFile } from "./archive.mjs";

export function sessionDecision(session, cvm, now = Date.now()) {
  if (session.version !== 1 || !/^[a-f0-9]{40}$/.test(session.appId)
    || !/^[a-zA-Z0-9_-]+$/.test(session.profile) || !/^[a-zA-Z0-9_-]+$/.test(session.cvmId)
    || !Number.isSafeInteger(session.startedAt) || !Number.isSafeInteger(session.stopAt)
    || session.startedAt > now || session.stopAt <= session.startedAt || session.stopAt - session.startedAt > 86400000) {
    throw new Error("Session bornée invalide");
  }
  if (cvm.app_id !== session.appId || typeof cvm.status !== "string") throw new Error("Identité CVM inattendue");
  return { expired: now >= session.stopAt, stopped: cvm.status === "stopped", stopRequired: now >= session.stopAt && cvm.status !== "stopped" };
}

export function superviseSession(session, { get, stop }, apply = false, now = Date.now()) {
  const cvm = get(session);
  const decision = sessionDecision(session, cvm, now);
  if (decision.stopRequired && apply) stop(session);
  return { ...decision, stopRequested: decision.stopRequired && apply, appId: session.appId, deadline: session.stopAt };
}

if (process.argv[1]?.endsWith("/phala-watchdog.mjs")) {
  try {
    const [file, flag, ...extra] = process.argv.slice(2);
    if (!file || extra.length || (flag && flag !== "--apply-stop")) throw new Error("Arguments invalides");
    const session = JSON.parse(readPrivateFile(file).toString());
    const cli = (args) => JSON.parse(execFileSync("pnpm", ["dlx", "phala@1.1.22", ...args, "--profile", session.profile,
      "--json", "--timeout", "20"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }));
    const result = superviseSession(session, {
      get: () => { const result = cli(["cvms", "get", session.cvmId]); return result.data ?? result.result ?? result; },
      stop: () => cli(["cvms", "stop", session.cvmId]),
    }, flag === "--apply-stop");
    console.log(JSON.stringify(result));
    if (result.stopRequired && !result.stopRequested) process.exitCode = 1;
  } catch {
    console.error("Supervision Phala indisponible : intervention opérateur requise. Aucune commande de démarrage ni de suppression disponible.");
    process.exitCode = 1;
  }
}
