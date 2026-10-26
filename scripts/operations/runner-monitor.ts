import { closeSync, fsyncSync, lstatSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { attestedRunnerFetch } from "../../src/lib/tee/ra-tls-client";
import { budgetAlerts } from "./supervisor.mjs";

export function validateBudgetReport(value: unknown, chainId: number, wallet: string, now = Date.now()) {
  const report = value as { version: number; chainId: number; wallet: string; observedAtMs: number; check: object };
  if (!report || report.version !== 1 || report.chainId !== chainId || report.wallet !== wallet.toLowerCase()
    || !Number.isSafeInteger(report.observedAtMs) || report.observedAtMs > now + 30_000 || now - report.observedAtMs > 60_000) {
    throw new Error("Rapport de supervision hors scope ou périmé");
  }
  budgetAlerts(report.check, report.observedAtMs, now);
  return report;
}

export function writeBudgetReport(path: string, report: unknown): void {
  const target = resolve(path);
  const directory = lstatSync(dirname(target));
  if (!directory.isDirectory() || (directory.mode & 0o077) !== 0) throw new Error("Répertoire de supervision privé requis");
  const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, `${JSON.stringify(report)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, target);
    const parent = openSync(dirname(target), "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } finally { rmSync(temporary, { force: true }); }
}

if (process.argv[1]?.endsWith("/runner-monitor.ts")) {
  void (async () => {
    try {
      const [output, ...extra] = process.argv.slice(2);
      const base = new URL(process.env.RUNNER_URL ?? "");
      const secret = process.env.RUNNER_MONITOR_SECRET;
      const wallet = process.env.SIRIUS_LOCK_AUTHORIZER ?? "";
      if (!output || extra.length || base.protocol !== "https:" || base.username || base.password || base.pathname !== "/"
        || base.search || base.hash || !secret || !/^[A-Za-z0-9+/]{43}=$/.test(secret)
        || !/^0x[0-9a-f]{40}$/i.test(wallet) || !["testnet", "mainnet"].includes(process.env.EVM_NETWORK ?? "")) throw new Error();
      const response = await attestedRunnerFetch(new URL("/operations/budget", base), {
        method: "GET", headers: { authorization: `Bearer ${secret}` }, timeoutMs: 15_000,
      });
      if (!response.ok) throw new Error();
      const report = validateBudgetReport(await response.json(), process.env.EVM_NETWORK === "testnet" ? 31611 : 31612, wallet);
      writeBudgetReport(output, report);
      console.log("Contrôle du budget attesté enregistré.");
    } catch {
      console.error("Supervision runner indisponible : vérifier transport attesté, identité et secret. Le précédent rapport conserve sa date.");
      process.exitCode = 1;
    }
  })();
}
