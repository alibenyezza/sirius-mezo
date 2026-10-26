import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./check-reaper.sh", import.meta.url));

const OK = "[reaper] passe ok 2026-10-01T10:00:00.000Z prêts=2 erreurs=0";

function check(state, missing = false, heartbeat = OK) {
  const directory = mkdtempSync(join(tmpdir(), "sirius-reaper-check-"));
  try {
    const bin = join(directory, "bin");
    mkdirSync(bin);
    // Les douze attentes de dix secondes deviennent instantanées.
    writeFileSync(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o700 });
    writeFileSync(join(directory, ".env.vps"), "DATABASE_URL=SECRET_SYNTHETIQUE\n");
    writeFileSync(join(bin, "docker"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.REAPER_TEST_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'inspect') console.log(process.env.REAPER_TEST_STATE);
else if (args.includes('logs') && args.includes('--since')) console.log(process.env.REAPER_TEST_HEARTBEAT);
else if (args.includes('logs')) console.log('[reaper] arrêt : contrats incompatibles');
else if (args.includes('--quiet')) {
  if (process.env.REAPER_TEST_MISSING !== 'true') console.log('container-staging');
} else if (args.includes('ps')) console.log('sirius-staging-reaper-1');
else process.exit(2);
`, { mode: 0o700 });
    const callsFile = join(directory, "calls.jsonl");
    const result = spawnSync("bash", [script, directory, "sirius-staging"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, REAPER_TEST_STATE: state,
        REAPER_TEST_MISSING: String(missing), REAPER_TEST_HEARTBEAT: String(heartbeat), REAPER_TEST_CALLS: callsFile },
    });
    const calls = readFileSync(callsFile, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(!result.stdout.includes("SECRET_SYNTHETIQUE"));
    for (const call of calls.filter((args) => args[0] === "compose")) {
      assert.deepEqual(call.slice(0, 5), ["compose", "-p", "sirius-staging", "--env-file", ".env.vps"]);
      assert.equal(call.at(-1), "reaper");
    }
    return { ...result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("le contrôle VPS accepte le processus running de staging", () => {
  const result = check("running 0 false 0");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /statut=running/);
  assert.match(result.stdout, /Ligne de vie récente trouvée/);
  // Seule la lecture de la ligne de vie : aucun affichage de logs d'erreur.
  assert.ok(result.calls.filter((args) => args.includes("logs")).every((args) => args.includes("--since")));
});

test("le contrôle VPS explique un redémarrage et affiche les logs du seul reaper", () => {
  const result = check("restarting 1 true 3");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /mémoire_dépassée=true redémarrages=3/);
  assert.match(result.stdout, /arrêt : contrats incompatibles/);
  assert.match(result.stdout, /::error::Le reaper ne tourne pas/);
});

for (const [name, heartbeat] of [
  ["une passe échouée", "[reaper] passe échouée 2026-10-01T10:00:00.000Z : passe interrompue"],
  ["des prêts tous en erreur", "[reaper] passe échouée 2026-10-01T10:00:00.000Z prêts=3 erreurs=3"],
  ["le seul démarrage", "[reaper] démarré, une passe toutes les 30000 ms"],
  ["l'ancien battement inconditionnel", "[reaper] passe 2026-10-01T10:00:00.000Z"],
]) {
  test(`le contrôle VPS refuse un reaper running sans passe réussie : ${name}`, () => {
    const result = check("running 0 false 0", false, heartbeat);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /Ligne de vie récente trouvée/);
    assert.match(result.stdout, /::error::Le reaper tourne mais ne journalise aucune passe réussie/);
  });
}

test("le contrôle VPS refuse un conteneur absent", () => {
  const result = check("", true);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Aucun conteneur reaper/);
  assert.ok(!result.calls.some((args) => args[0] === "inspect"));
});
