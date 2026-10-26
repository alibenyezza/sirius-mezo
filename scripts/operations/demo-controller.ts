import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:https";
import { readFileSync, writeFileSync, renameSync, lstatSync, existsSync, openSync, closeSync, fsyncSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { AppError } from "../../src/lib/app-error";
import { attestedRunnerFetch } from "../../src/lib/tee/ra-tls-client";
import { controllerAuthorized, operatorAllowed } from "../../src/lib/phala-demo/operator";
import type { ControllerStatus } from "../../src/lib/phala-demo/controller-client";
import { parseDemoPolicy, type DemoPolicy, type DemoSession } from "../../src/lib/phala-demo/contract";

interface RunnerStatus { session: DemoSession; policy: DemoPolicy; available: boolean }
export interface DemoControllerIO {
  getCvm(): Promise<"running" | "stopped" | "transitioning">;
  startCvm(): Promise<void>;
  stopCvm(): Promise<void>;
  runner(command?: { command: "open" | "close" | "configure" | "recover"; actor: string; revision: number; policy?: DemoPolicy; observedAtMs?: number }): Promise<RunnerStatus>;
  funding?(): { policy: DemoPolicy; observedAtMs: number };
  pendingDeliveries(): Promise<number>;
  wait(): Promise<void>;
}

export class DemoController {
  private state: ControllerStatus;
  private busy = false;
  private running: Promise<void> = Promise.resolve();

  constructor(private readonly file: string, private readonly io: DemoControllerIO) {
    if (!isAbsolute(file)) throw new Error("Chemin privé absolu requis");
    const dir = lstatSync(dirname(file));
    if (!dir.isDirectory() || (dir.mode & 0o077) !== 0) throw new Error("Répertoire contrôleur privé requis");
    this.state = { revision: 0, phase: "closed", available: false, changedAt: Date.now(), activeOperations: 0, usedOperations: 0, funding: null };
    if (existsSync(file)) {
      const stat = lstatSync(file);
      if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("État contrôleur privé requis");
      const saved = JSON.parse(readFileSync(file, "utf8")) as ControllerStatus;
      if (!Number.isSafeInteger(saved.revision) || !["closed", "opening", "open", "closing", "error"].includes(saved.phase)) throw new Error("État contrôleur invalide");
      this.state = saved;
      if (saved.phase === "opening" || saved.phase === "closing") this.save({ phase: "error", available: false, error: "Commande interrompue : intervention opérateur requise" });
    } else this.save({});
  }

  private save(update: Partial<ControllerStatus>) {
    const next = { ...this.state, ...update, changedAt: Date.now() };
    const temporary = `${this.file}.${randomUUID()}`;
    try {
      writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: "wx" });
      const fd = openSync(temporary, "r");
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, this.file);
      this.state = next;
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }

  async status(): Promise<ControllerStatus> {
    if (this.state.phase !== "open") return { ...this.state, available: false };
    const revision = this.state.revision;
    try {
      const result = await this.io.runner();
      if (this.state.revision !== revision) return { ...this.state, available: false };
      return { ...this.state, available: result.session.open && result.available,
        activeOperations: result.session.activeOperations, usedOperations: result.session.usedOperations, funding: result.policy.funding,
        sessionRevision: result.session.revision };
    } catch { return { ...this.state, available: false }; }
  }

  submit(command: "open" | "close" | "emergency", actor: string, revision: number): ControllerStatus {
    if (!operatorAllowed(actor)) throw new AppError("Opérateur non autorisé", 403);
    if (!["open", "close", "emergency"].includes(command)) throw new AppError("Commande invalide", 400);
    // Désactiver pendant l’ouverture annule le démarrage : aucun calcul n’est encore admis, le
    // chemin est celui de l’urgence, sans attendre une session qui n’existe pas sur le runner.
    const effective = command === "close" && this.busy && this.state.phase === "opening" ? "emergency" : command;
    if ((this.busy && effective !== "emergency") || revision !== this.state.revision) throw new AppError("Commande concurrente", 409);
    if (command === "open" && this.state.phase === "open") throw new AppError("Session déjà ouverte", 409);
    const nextRevision = this.state.revision + 1;
    this.save({ phase: command === "open" ? "opening" : "closing", available: false,
      revision: nextRevision, error: undefined });
    this.busy = true;
    // L’urgence invalide la commande précédente, mais attend son appel fournisseur en vol.
    this.running = this.running.then(() => this.execute(effective, actor, nextRevision)).catch(() => {
      if (this.state.revision === nextRevision) {
        try { this.save({ phase: "error", available: false, error: "Commande non confirmée : vérifier Phala avant de réessayer" }); }
        catch { console.error("Écriture de l’état Phala impossible ; vérifier le disque du contrôleur"); }
      }
    }).finally(() => { if (this.state.revision === nextRevision) this.busy = false; });
    return { ...this.state };
  }

  private assertCurrent(revision: number) {
    if (this.state.revision !== revision) throw new Error("Commande remplacée par un arrêt opérateur");
  }

  private async step<T>(revision: number, action: () => Promise<T>): Promise<T> {
    this.assertCurrent(revision);
    const result = await action();
    this.assertCurrent(revision);
    return result;
  }

  private async until(revision: number, check: () => Promise<boolean>) {
    for (let attempt = 0; attempt < 90; attempt++) {
      if (await this.step(revision, check)) return;
      await this.step(revision, () => this.io.wait());
    }
    throw new Error("Commande non confirmée");
  }

  private async execute(command: "open" | "close" | "emergency", actor: string, revision: number) {
    const step = <T>(action: () => Promise<T>) => this.step(revision, action);
    if (command === "open") {
      this.assertCurrent(revision);
      const funding = this.io.funding?.();
      const power = await step(() => this.io.getCvm());
      if (power === "stopped") await step(() => this.io.startCvm());
      await this.until(revision, async () => await this.io.getCvm() === "running");
      let result: RunnerStatus | undefined;
      await this.until(revision, async () => {
        try { result = await this.io.runner(); return true; } catch { return false; }
      });
      if (!result) throw new Error("Attestation indisponible");
      if (result.session.open) result = await step(() => this.io.runner({ command: "close", actor, revision: result!.session.revision }));
      // Session fermée mais opérations encore « en cours » : orphelines d'un runner arrêté.
      if (result.session.activeOperations > 0) result = await step(() => this.io.runner({ command: "recover", actor, revision: result!.session.revision }));
      if (funding) result = await step(() => this.io.runner({ command: "configure", actor, revision: result!.session.revision, ...funding }));
      result = await step(() => this.io.runner({ command: "open", actor, revision: result!.session.revision, policy: result!.policy }));
      this.save({ phase: "open", available: result.available, funding: result.policy.funding });
      return;
    }
    const power = await step(() => this.io.getCvm());
    if (power !== "stopped") {
      const close = async () => {
        const result = await step(() => this.io.runner());
        await step(() => this.io.runner({ command: "close", actor, revision: result.session.revision }));
      };
      if (command === "emergency") await close().catch(() => {});
      else {
        await close();
        await this.until(revision, async () => {
          const result = await step(() => this.io.runner());
          return result.session.activeOperations === 0 && await step(() => this.io.pendingDeliveries()) === 0;
        });
      }
      await step(() => this.io.stopCvm());
      await this.until(revision, async () => await this.io.getCvm() === "stopped");
    }
    this.save({ phase: "closed", available: false, activeOperations: 0 });
  }
}

async function main() {
  const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} requis`); return value; };
  const profile = required("PHALA_DEMO_PROFILE");
  const cvm = required("PHALA_DEMO_CVM_ID");
  const appId = required("PHALA_DEMO_APP_ID");
  if (!/^[\w-]+$/.test(profile) || !/^[\w-]+$/.test(cvm) || !/^[a-f0-9]{40}$/.test(appId)) throw new Error("Identité Phala invalide");
  const runner = new URL(required("RUNNER_URL"));
  const application = new URL(required("SIRIUS_APP_ORIGIN"));
  if ([runner, application].some((url) => url.protocol !== "https:" || url.origin !== url.href.slice(0, -1))) throw new Error("Origines HTTPS requises");
  const execute = promisify(execFile);
  const cli = async (operation: "get" | "start" | "stop") => {
    const { stdout } = await execute("pnpm", ["dlx", "phala@1.1.22", "cvms", operation, cvm,
      "--profile", profile, "--json", "--timeout", "20"], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout);
    return result.data ?? result.result ?? result;
  };
  const secret = required("PHALA_DEMO_CONTROLLER_SECRET");
  if (!controllerAuthorized(`Bearer ${secret}`)) throw new Error("Secret contrôleur invalide");
  required("SIRIUS_DEMO_OPERATORS");
  const controller = new DemoController(required("PHALA_DEMO_STATE_FILE"), {
    funding: () => {
      const path = required("PHALA_DEMO_FUNDING_FILE");
      const stat = lstatSync(path);
      if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Politique privée requise");
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (!Number.isSafeInteger(value.observedAtMs) || value.observedAtMs <= 0 || value.observedAtMs > Date.now() + 30_000
        || value.observedAtMs < Date.now() - 31 * 86400_000) throw new Error("Relevé financier à renouveler");
      return { policy: parseDemoPolicy(value), observedAtMs: value.observedAtMs };
    },
    getCvm: async () => {
      const result = await cli("get");
      if (result.app_id !== appId) throw new Error("Identité CVM inattendue");
      return result.status === "running" ? "running" : result.status === "stopped" ? "stopped" : "transitioning";
    },
    startCvm: async () => { await cli("start"); },
    stopCvm: async () => { await cli("stop"); },
    runner: async (body) => {
      const response = await attestedRunnerFetch(new URL("/operations/demo", runner), {
        method: body ? "POST" : "GET", timeoutMs: 15_000,
        headers: { authorization: `Bearer ${required("RUNNER_DEMO_CONTROL_SECRET")}`, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error("Contrôle runner refusé");
      return await response.json() as RunnerStatus;
    },
    pendingDeliveries: async () => {
      const response = await fetch(new URL("/api/phala-demo/drain", application), {
        headers: { authorization: `Bearer ${secret}` }, redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json();
      if (!response.ok || !Number.isSafeInteger(body.pending) || body.pending < 0) throw new Error("Livraisons non vérifiées");
      return body.pending as number;
    },
    wait: () => delay(2000),
  });
  const server = createServer({ cert: readFileSync(required("PHALA_DEMO_TLS_CERT")), key: readFileSync(required("PHALA_DEMO_TLS_KEY")),
    minVersion: "TLSv1.3", maxHeaderSize: 8192 }, async (req, res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
    try {
      if (req.url !== "/session" || !controllerAuthorized(typeof req.headers.authorization === "string" ? req.headers.authorization : null)) {
        return send(401, { error: "Accès refusé" });
      }
      if (req.method === "GET") return send(200, await controller.status());
      if (req.method !== "POST") return send(405, { error: "Méthode refusée" });
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2048) throw new AppError("Commande trop volumineuse", 413); chunks.push(Buffer.from(chunk)); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (!["open", "close", "emergency"].includes(body.command) || typeof body.actor !== "string" || !Number.isSafeInteger(body.revision)) throw new AppError("Commande invalide", 400);
      return send(202, controller.submit(body.command, body.actor.toLowerCase(), body.revision));
    } catch (error) { send(error instanceof AppError ? error.status : 503, { error: "Contrôleur indisponible ou commande refusée" }); }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 5_000;
  server.maxConnections = 32;
  const port = Number(process.env.PHALA_DEMO_PORT ?? 4443);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Port contrôleur invalide");
  server.listen(port, process.env.PHALA_DEMO_BIND ?? "127.0.0.1");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Contrôleur Phala arrêté : vérifier sa configuration privée"); process.exitCode = 1; });
}
