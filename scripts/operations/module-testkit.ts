// Kit de test : charge un module TypeScript du serveur (y compris marqué `server-only`) dans un bac
// à sable, avec ses dépendances fournies explicitement. Même approche que src/lib/audit-regressions.test.ts :
// une dépendance non prévue fait échouer le test au lieu d'atteindre le réseau ou la base.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

export const serverOnly = {};

export function loadModule<T>(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, {
    exports, Buffer, Date, Map, Set, Number, String, BigInt, JSON, Math, Promise, Error, TextEncoder, TextDecoder, URL, console,
    process: { env: {} }, ...globals,
    require: (name: string) => {
      assert.ok(Object.hasOwn(dependencies, name), `Dépendance inattendue : ${name}`);
      return dependencies[name];
    },
  });
  return exports as T;
}
