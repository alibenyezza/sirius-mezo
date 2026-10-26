import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import { DemoController, type DemoControllerIO } from "./demo-controller";
import { DemoSessionStore } from "../../src/lib/phala-demo/session-store";
import { controllerAuthorized, operatorAllowed } from "../../src/lib/phala-demo/operator";
import type { DemoPolicy } from "../../src/lib/phala-demo/contract";

const operator = `0x${"12".repeat(20)}`;
const visitor = `0x${"34".repeat(20)}`;
const old = process.env.SIRIUS_DEMO_OPERATORS;
process.env.SIRIUS_DEMO_OPERATORS = operator;
after(() => { if (old === undefined) delete process.env.SIRIUS_DEMO_OPERATORS; else process.env.SIRIUS_DEMO_OPERATORS = old; });
const policy: DemoPolicy = { funding: "credits", creditsUsdMicros: "1000", cashUsdMicros: "0", ceilingUsdMicros: "900",
  maxOperations: 4, maxOperationsPerWallet: 4, maxConcurrent: 1 };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sirius-demo-controller-"));
  const store = new DemoSessionStore(join(root, "session.sqlite"));
  const state = { power: "stopped" as "stopped" | "running", starts: 0, stops: 0, pending: 0, capacity: true };
  const io: DemoControllerIO = {
    getCvm: async () => state.power,
    startCvm: async () => { state.starts++; state.power = "running"; },
    stopCvm: async () => { state.stops++; state.power = "stopped"; },
    runner: async (body) => {
      if (state.power !== "running") throw new Error("CVM arrêtée");
      if (body?.command === "recover") store.recoverOrphans();
      else if (body && body.command !== "configure") store.command(body.command, body.revision, body.actor, body.policy);
      return { session: store.read(), policy, available: state.capacity && store.read().open };
    },
    pendingDeliveries: async () => state.pending,
    wait: tick,
  };
  const file = join(root, "controller.json");
  const controller = new DemoController(file, io);
  const cleanup = () => { store.close(); rmSync(root, { recursive: true, force: true }); };
  return { controller, state, io, store, file, cleanup };
}

async function phase(controller: DemoController, expected: string) {
  for (let index = 0; index < 200; index++) {
    const status = await controller.status();
    if (status.phase === expected) return status;
    await tick();
  }
  assert.fail(`État ${expected} non atteint`);
}

test("lecture publique, rejet visiteur, révision et budget épuisé ne démarrent/arrêtent jamais la CVM", async () => {
  const f = fixture();
  try {
    assert.equal((await f.controller.status()).phase, "closed");
    assert.throws(() => f.controller.submit("open", visitor, 0), /autorisé/);
    assert.equal(f.state.starts, 0);
    f.controller.submit("open", operator, 0);
    assert.throws(() => f.controller.submit("open", operator, 0), /concurrente/);
    await phase(f.controller, "open");
    f.state.capacity = false;
    assert.equal((await f.controller.status()).available, false);
    const restored = new DemoController(f.file, f.io);
    assert.equal((await restored.status()).phase, "open");
    assert.equal(f.state.starts, 1);
    assert.equal(f.state.stops, 0);
    assert.equal(f.store.read().open, true);
  } finally { f.cleanup(); }
});

test("fermer refuse les nouvelles opérations, puis attend le calcul et sa livraison avant arrêt", async () => {
  const f = fixture();
  try {
    f.controller.submit("open", operator, 0);
    const open = await phase(f.controller, "open");
    f.store.admit("train:one", visitor, "a".repeat(64)); f.state.pending = 1;
    let observed = false;
    f.io.wait = async () => {
      if (!f.store.read().open) {
        observed = true;
        assert.equal(f.state.stops, 0);
        assert.throws(() => f.store.admit("train:two", visitor, "b".repeat(64)), /fermée/);
        f.store.finish("train:one", true);
        f.state.pending = 0;
      }
      await tick();
    };
    f.controller.submit("close", operator, open.revision);
    await phase(f.controller, "closed");
    assert.equal(observed, true); assert.equal(f.state.stops, 1);
  } finally { f.cleanup(); }
});

test("urgence pendant le démarrage : aucune réouverture après la fin de l’appel fournisseur", async () => {
  const f = fixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  f.io.startCvm = async () => { f.state.starts++; await pending; f.state.power = "running"; };
  try {
    const opening = f.controller.submit("open", operator, 0);
    await tick();
    assert.equal(f.state.starts, 1);
    f.controller.submit("emergency", operator, opening.revision);
    release();
    await phase(f.controller, "closed");
    assert.equal(f.store.read().openedAt, null);
    assert.equal(f.state.stops, 1);
  } finally { release(); f.cleanup(); }
});

test("désactiver pendant le démarrage annule l’ouverture, sans session ni réouverture", async () => {
  const f = fixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  f.io.startCvm = async () => { f.state.starts++; await pending; f.state.power = "running"; };
  try {
    const opening = f.controller.submit("open", operator, 0);
    await tick();
    assert.equal(f.state.starts, 1);
    assert.equal(f.controller.submit("close", operator, opening.revision).phase, "closing");
    release();
    await phase(f.controller, "closed");
    assert.equal(f.store.read().openedAt, null);
    assert.equal(f.state.stops, 1);
  } finally { release(); f.cleanup(); }
});

test("urgence supplante le drainage ; reprise du contrôleur ne relance pas une commande interrompue", async () => {
  const f = fixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  try {
    f.controller.submit("open", operator, 0); const open = await phase(f.controller, "open");
    f.state.pending = 1; f.io.wait = () => pending;
    const closing = f.controller.submit("close", operator, open.revision);
    await tick();
    const restored = new DemoController(f.file, f.io);
    assert.equal((await restored.status()).phase, "error");
    assert.equal(f.state.stops, 0);
    f.controller.submit("emergency", operator, closing.revision);
    release(); await phase(f.controller, "closed");
    assert.equal(f.state.stops, 1); assert.equal(f.state.pending, 1);
  } finally { release(); f.cleanup(); }
});

test("allowlist et secret du contrôleur sont fermés par défaut", () => {
  assert.equal(operatorAllowed(visitor), false);
  assert.equal(operatorAllowed(operator, ""), false);
  assert.equal(operatorAllowed(operator, `${operator},garbage`), false);
  const secret = Buffer.alloc(32, 19).toString("base64");
  assert.equal(controllerAuthorized(`Bearer ${secret}`, secret), true);
  assert.equal(controllerAuthorized(`Bearer ${secret}x`, secret), false);
  assert.equal(controllerAuthorized(null, secret), false);
});

test("une politique privée absente ou invalide échoue avant tout démarrage", async () => {
  const f = fixture();
  f.io.funding = () => { throw new Error("Politique privée indisponible"); };
  try {
    f.controller.submit("open", operator, 0);
    await phase(f.controller, "error");
    assert.equal(f.state.starts, 0);
    assert.equal(f.store.read().open, false);
  } finally { f.cleanup(); }
});

test("une opération orpheline d’un runner arrêté n’empêche plus de rouvrir la démonstration", async () => {
  const f = fixture();
  try {
    f.controller.submit("open", operator, 0);
    await phase(f.controller, "open");
    f.store.admit("train:crash", visitor, "c".repeat(64));
    f.controller.submit("emergency", operator, (await f.controller.status()).revision);
    await phase(f.controller, "closed");
    // Le runner redémarre : un nouveau processus ouvre le même registre.
    f.store.close();
    const restarted = new DemoSessionStore(f.store.path);
    Object.assign(f.store, restarted);
    assert.equal(restarted.read().activeOperations, 1, "l’admission orpheline survit à l’arrêt");
    f.io.runner = async (body) => {
      if (f.state.power !== "running") throw new Error("CVM arrêtée");
      if (body?.command === "recover") restarted.recoverOrphans();
      else if (body && body.command !== "configure") restarted.command(body.command, body.revision, body.actor, body.policy);
      return { session: restarted.read(), policy, available: restarted.read().open };
    };
    f.controller.submit("open", operator, (await f.controller.status()).revision);
    await phase(f.controller, "open");
    assert.equal(restarted.read().activeOperations, 0);
    assert.equal(restarted.read().open, true);
    restarted.close();
  } finally { rmSync(dirname(f.file), { recursive: true, force: true }); }
});
