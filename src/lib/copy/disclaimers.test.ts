import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";
import { EN_MESSAGES, translateEnglish as t } from "@/lib/i18n/english";
import { MAX_DATASET_BYTES } from "@/lib/tee/contract";
import { MAX_CSV_ROWS } from "@/lib/sirius/metrics";
import { MAX_TRAINING_FEATURES, MIN_TRAINING_ROWS } from "@/lib/tee/train";
import {
  CONTACT_LABEL,
  CONTACT_URL,
  DISCLAIMER_IDS,
  DISCLAIMERS,
  contactHref,
  dataLimitsVariables,
  disclaimerText,
} from "./disclaimers";
import { formatCount, formatLimitBytes, groupDigits } from "./numbers";

test("les cinq textes anglais sont ceux de 16-socle-technique.md, section 4", () => {
  assert.deepEqual([...DISCLAIMER_IDS].sort(), ["betaLimits", "contactUs", "dataLimits", "modelQuality", "retrainDeterministic"]);
  assert.equal(
    disclaimerText("modelQuality", t),
    "Sirius currently trains baseline models: linear and logistic regression on tabular data. Results depend on the data. New models are in development.",
  );
  assert.equal(
    disclaimerText("contactUs", t),
    "Need a stronger model or specific data? Contact us at github.com/alibenyezza/sirius-mezo/issues.",
  );
  assert.equal(disclaimerText("betaLimits", t), "Beta: instant on-chain wallet verification, capped amounts per loan and in total.");
  assert.equal(
    disclaimerText("retrainDeterministic", t),
    "Linear and logistic regression are deterministic: retraining on the same data gives the same model.",
  );
  assert.equal(
    disclaimerText("dataLimits", t),
    "CSV up to 3 MB, 100 to 20,000 rows, numeric columns, up to 31 input features.",
  );
});

test("l'adresse de contact est celle du cahier des charges", () => {
  assert.equal(CONTACT_LABEL, "github.com/alibenyezza/sirius-mezo/issues");
  assert.equal(DISCLAIMERS.contactUs.variables.email, CONTACT_LABEL);
});

test("chaque texte est traduit et aucun paramètre n'est laissé vide", () => {
  for (const id of DISCLAIMER_IDS) {
    const { key, variables } = DISCLAIMERS[id];
    assert.ok(Object.hasOwn(EN_MESSAGES, key), `clé non traduite : ${id}`);
    assert.notEqual(EN_MESSAGES[key], key, id);
    const text = disclaimerText(id, t);
    assert.doesNotMatch(text, /\{\w+\}/, `paramètre non résolu dans ${id}`);
    assert.doesNotMatch(text, /—/, `valeur absente dans ${id}`);
    // Chaque variable fournie est réellement utilisée par la clé, et inversement.
    const used = [...new Set(key.match(/\{(\w+)\}/g))].map((p) => p.slice(1, -1)).sort();
    assert.deepEqual(Object.keys(variables).sort(), used, id);
  }
});

test("dataLimits lit les constantes du code (indépendamment recalculées)", () => {
  assert.equal(MAX_DATASET_BYTES % (1024 * 1024), 0, "ce test suppose une limite en Mio entiers");
  const expected =
    `CSV up to ${MAX_DATASET_BYTES / (1024 * 1024)} MB, ` +
    `${MIN_TRAINING_ROWS.toLocaleString("en-US")} to ${MAX_CSV_ROWS.toLocaleString("en-US")} rows, ` +
    `numeric columns, up to ${MAX_TRAINING_FEATURES} input features.`;
  assert.equal(disclaimerText("dataLimits", t), expected);
});

test("dataLimits suit un changement de limites : aucune valeur n'est recopiée dans le texte", () => {
  const { key } = DISCLAIMERS.dataLimits;
  assert.doesNotMatch(key, /\d/, "la clé ne doit contenir aucun chiffre");
  const text = t(key, dataLimitsVariables({ maxDatasetBytes: 5 * 1024 * 1024, minRows: 250, maxRows: 1_500_000, maxFeatures: 8 }));
  assert.equal(text, "CSV up to 5 MB, 250 to 1,500,000 rows, numeric columns, up to 8 input features.");
  const half = t(key, dataLimitsVariables({ maxDatasetBytes: 2.5 * 1024 * 1024, minRows: 100, maxRows: 20_000, maxFeatures: 31 }));
  assert.match(half, /^CSV up to 2\.5 MB,/);
});

test("le tableau DISCLAIMERS ne contient aucune valeur numérique écrite en dur", () => {
  const file = join(root, "src/lib/copy/disclaimers.ts");
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let inspected = false;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "DISCLAIMERS" && node.initializer) {
      inspected = true;
      const literals: string[] = [];
      (function scan(child: ts.Node) {
        if (ts.isNumericLiteral(child)) literals.push(child.text);
        ts.forEachChild(child, scan);
      })(node.initializer);
      assert.deepEqual(literals, [], "les limites doivent venir des constantes, pas de littéraux");
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(inspected, "DISCLAIMERS introuvable");
});

test("aucun texte commun ne contient de chiffre en dur, sauf ceux lus dans le code", () => {
  for (const id of DISCLAIMER_IDS) assert.doesNotMatch(DISCLAIMERS[id].key, /\d/, id);
});

test("formatage : milliers, tailles tronquées vers le bas, valeurs invalides", () => {
  assert.equal(groupDigits("0"), "0");
  assert.equal(groupDigits("999"), "999");
  assert.equal(groupDigits("1000"), "1,000");
  assert.equal(groupDigits("1234567"), "1,234,567");
  assert.equal(formatCount(20_000), "20,000");
  assert.equal(formatCount(0), "0");
  for (const bad of [-1, 1.5, NaN, Infinity, null, undefined]) assert.equal(formatCount(bad as number), "—");
  assert.equal(formatLimitBytes(3 * 1024 * 1024), "3 MB");
  assert.equal(formatLimitBytes(3 * 1024 * 1024 - 1), "2.9 MB", "une limite n'est jamais arrondie vers le haut");
  assert.equal(formatLimitBytes(1024 * 1024), "1 MB");
  assert.equal(formatLimitBytes(512 * 1024), "512 KB");
  assert.equal(formatLimitBytes(1024), "1 KB");
  assert.equal(formatLimitBytes(100), "100 B", "une limite sous 1 KB n'est pas annoncée « 0 KB »");
  assert.equal(formatLimitBytes(1), "1 B");
  assert.equal(formatCount(2 ** 53), "—", "entier non sûr");
  assert.equal(formatLimitBytes(0), "—");
  assert.equal(formatLimitBytes(-5), "—");
  assert.equal(formatLimitBytes(1.5), "—");
});

test("le lien mailto ne contient que l'adresse de contact, objet encodé strictement", () => {
  assert.equal(contactHref(), "https://github.com/alibenyezza/sirius-mezo/issues/new");
  assert.equal(contactHref("   "), "https://github.com/alibenyezza/sirius-mezo/issues/new");
  assert.equal(contactHref("Model quality"), "https://github.com/alibenyezza/sirius-mezo/issues/new?title=Model%20quality");
  const hostile = 'x&cc=evil@example.com&bcc=evil@example.com?body=<script>\r\nBcc: evil@example.com';
  const href = contactHref(hostile);
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, CONTACT_URL);
  assert.deepEqual([...url.searchParams.keys()], ["title"], "aucun paramètre ajouté");
  assert.doesNotMatch(href, /[\r\n<>& ]|\?.*\?/);
  assert.match(href.slice(href.indexOf("?")), /^\?title=[A-Za-z0-9%._~!*'()-]*$/);
  assert.ok(href.length < 800);
  assert.ok(contactHref("😀".repeat(5000)).length < 200 * 12 + 100, "objet borné à 200 caractères");
});

test("le lien mailto ne lève jamais d'exception, même avec des substituts UTF-16 isolés ou coupés", () => {
  const sans = "https://github.com/alibenyezza/sirius-mezo/issues/new?title=";
  // Substituts isolés (JSON les admet) : remplacés par U+FFFD.
  assert.equal(contactHref("\ud800"), `${sans}%EF%BF%BD`);
  assert.equal(contactHref("a\udc00b"), `${sans}a%EF%BF%BDb`);
  // Emoji à cheval sur la limite de 200 : coupé sur des points de code, jamais en deux.
  const href = contactHref("a".repeat(199) + "😀😀");
  assert.equal(href, `${sans}${"a".repeat(199)}%F0%9F%98%80`);
  assert.equal(decodeURIComponent(href.slice(sans.length)), "a".repeat(199) + "😀");
  assert.equal(Array.from(decodeURIComponent(contactHref("é".repeat(500)).slice(sans.length))).length, 200);
  // Un objet réduit à un substitut puis à du blanc ne produit pas de paramètre vide.
  assert.equal(contactHref(" \t\n "), "https://github.com/alibenyezza/sirius-mezo/issues/new");
});

test("le lien mailto : bornes exactes des substituts UTF-16 (D800–DFFF) et des contrôles", () => {
  const sans = "https://github.com/alibenyezza/sirius-mezo/issues/new?title=";
  assert.equal(contactHref("\ud7ff"), `${sans}%ED%9F%BF`, "juste sous D800 : conservé");
  assert.equal(contactHref("\ud800"), `${sans}%EF%BF%BD`);
  assert.equal(contactHref("\udfff"), `${sans}%EF%BF%BD`, "borne haute DFFF remplacée");
  assert.equal(contactHref("\ue000"), `${sans}%EE%80%80`, "juste au-dessus de DFFF : conservé");
  assert.equal(contactHref("a\u001fb"), `${sans}a%20b`, "0x1f est un contrôle");
  assert.equal(contactHref("a b"), `${sans}a%20b`, "0x20 est une espace ordinaire");
  assert.equal(contactHref("a\u009fb"), `${sans}a%20b`, "0x9f est un contrôle C1");
  assert.equal(contactHref("a\u00a0b"), `${sans}a%C2%A0b`, "0xa0 n'est pas un contrôle");
  assert.equal(contactHref("  x  "), `${sans}x`, "espaces retirés");
  assert.equal(contactHref("a".repeat(199) + " b"), `${sans}${"a".repeat(199)}`, "espace finale retirée après coupure");
});

test("le lien mailto retire les contrôles : CR, LF, tabulation, DEL et contrôles C1", () => {
  const sans = "https://github.com/alibenyezza/sirius-mezo/issues/new?title=";
  const href = contactHref("a\r\nBcc: x");
  assert.equal(href, `${sans}a%20%20Bcc%3A%20x`);
  assert.doesNotMatch(href, /%0D|%0A|%09/i);
  assert.equal(contactHref("a\u007fb\u0085c\u0000d"), `${sans}a%20b%20c%20d`);
});

// --- Les constantes lues par les textes doivent pouvoir être importées côté client. ---

const root = fileURLToPath(new URL("../../../", import.meta.url));
const FORBIDDEN_PACKAGES = new Set(["server-only", "pg", "better-sqlite3", "@prisma/client", "@phala/dstack-sdk", "@phala/dcap-qvl"]);
const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));

function resolveLocal(specifier: string, from: string): string | null {
  const base = specifier.startsWith("@/") ? join(root, "src", specifier.slice(2)) : resolve(dirname(from), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Spécificateurs réellement chargés à l'exécution (les imports de types sont effacés). */
function runtimeImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (!clause.name && bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly)));
      if (!typeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
        found.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function reachable(entries: string[]): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of runtimeImports(file)) {
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const local = resolveLocal(specifier, file);
        assert.ok(local, `import local introuvable : ${specifier} (depuis ${file})`);
        queue.push(local);
      } else {
        packages.add(specifier.replace(/^node:/, ""));
      }
    }
  }
  return { files, packages };
}

test("les modules des textes communs n'atteignent ni server-only ni module Node ni accès base", () => {
  const entries = [
    join(root, "src/lib/copy/disclaimers.ts"),
    join(root, "src/components/ui/DisclaimerNote.tsx"),
    join(root, "src/components/ui/StatusPill.tsx"),
    join(root, "src/components/datasets/PriceBreakdown.tsx"),
    join(root, "src/components/datasets/DatasetCard.tsx"),
  ];
  const { files, packages } = reachable(entries);
  // Les trois sources de constantes sont bien dans le graphe : le test regarde les bons fichiers.
  for (const expected of ["src/lib/tee/contract.ts", "src/lib/sirius/metrics.ts", "src/lib/tee/train.ts"]) {
    assert.ok([...files].some((file) => file.endsWith(expected)), `${expected} absent du graphe`);
  }
  for (const name of packages) {
    assert.ok(!FORBIDDEN_PACKAGES.has(name), `paquet réservé au serveur atteint : ${name}`);
    assert.ok(!BUILTINS.has(name.split("/")[0]), `module Node atteint : ${name}`);
  }
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /import\s+["']server-only["']/, file);
  }
});
