import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contractSourceUrl,
  demoTransactions,
  explorerApiBase,
  parseDeploymentManifest,
  readDeploymentManifest,
} from "./deployment-manifest";

const ADDRESS = "0xd14a0af1581bd7bd80d9da0f775c1c254967abda";
const HASH = `0x${"ab".repeat(32)}`;

function minimal() {
  return {
    network: "mezo-testnet",
    chainId: 31611,
    explorer: "https://explorer.test.mezo.org",
    deployedAt: "2026-10-26T13:05:23.199Z",
    deployer: ADDRESS,
    lockAuthorizer: ADDRESS,
    settlementToken: { symbol: "MUSD", address: ADDRESS, decimals: 18 },
    contracts: { escrow: ADDRESS, kyb: ADDRESS, datasets: ADDRESS },
  };
}

test("manifeste : le fichier du dépôt est valide et porte les cinq transactions de démonstration dans l'ordre", () => {
  const manifest = readDeploymentManifest();
  assert.equal(manifest.chainId, 31611);
  assert.equal(manifest.network, "mezo-testnet");
  assert.deepEqual(
    demoTransactions(manifest).map((transaction) => transaction.key),
    ["mint", "approve", "lock", "release", "withdrawFor"],
  );
  assert.equal(manifest.demo?.amountMusd, "2");
  assert.ok(Array.isArray(manifest.previous));
  assert.equal(manifest.previous?.[0].escrow.length, 42);
});

test("manifeste : previous est accepté en objet ou en tableau et toujours exposé en tableau, le plus récent en premier", () => {
  const entry = { escrow: ADDRESS, kyb: ADDRESS, datasets: ADDRESS, lockAuthorizer: ADDRESS, transactions: { lock: HASH } };
  const single = parseDeploymentManifest({ ...minimal(), previous: entry });
  assert.deepEqual(single.previous, [entry]);

  const newer = { ...entry, deployedAt: "2026-10-26T13:05:23.199Z", escrowVersion: "sirius-escrow-usdc-v6", transactions: { mint: HASH, withdrawFor: HASH } };
  const list = parseDeploymentManifest({ ...minimal(), previous: [newer, entry] });
  assert.equal(list.previous?.length, 2);
  assert.equal(list.previous?.[0].deployedAt, "2026-10-26T13:05:23.199Z");
  assert.equal(list.previous?.[0].transactions?.mint, HASH);
  assert.equal(list.previous?.[1].deployedAt, undefined);
  assert.throws(() => parseDeploymentManifest({ ...minimal(), previous: [{ ...entry, escrow: "0xnope" }] }));
});

test("manifeste : les fonctionnalités de l'escrow sont lues quand elles sont déclarées", () => {
  const manifest = parseDeploymentManifest({ ...minimal(), contracts: { ...minimal().contracts, escrowFeatures: ["lockWithSignature"] } });
  assert.deepEqual(manifest.contracts.escrowFeatures, ["lockWithSignature"]);
  assert.equal(parseDeploymentManifest(minimal()).contracts.escrowFeatures, undefined);
  assert.throws(() => parseDeploymentManifest({ ...minimal(), contracts: { ...minimal().contracts, escrowFeatures: "lockWithSignature" } }));
});

test("manifeste : les blocs optionnels peuvent manquer, la liste de transactions est alors vide", () => {
  const manifest = parseDeploymentManifest(minimal());
  assert.equal(manifest.demo, undefined);
  assert.equal(manifest.previous, undefined);
  assert.equal(manifest.verification, undefined);
  assert.equal(manifest.evidence, undefined);
  assert.deepEqual(demoTransactions(manifest), []);
});

test("manifeste : une adresse ou un hash malformé est refusé plutôt qu'affiché comme preuve", () => {
  assert.throws(() => parseDeploymentManifest({ ...minimal(), deployer: "0x1234" }));
  assert.throws(() => parseDeploymentManifest({
    ...minimal(),
    demo: { provider: ADDRESS, borrower: ADDRESS, datasetId: "x", amountMusd: "2", transactions: { lock: "0xnope" } },
  }));
  assert.throws(() => parseDeploymentManifest({
    ...minimal(),
    evidence: [{ label: "Wave 2", kind: "block", value: HASH }],
  }));
});

test("manifeste : la vérification et les preuves supplémentaires sont lues quand elles sont présentes", () => {
  const manifest = parseDeploymentManifest({
    ...minimal(),
    verification: {
      explorer: "https://explorer.test.mezo.org",
      verifiedAt: "2026-10-31T10:00:00.000Z",
      contracts: { escrow: { verified: true, url: "https://explorer.test.mezo.org/address/x?tab=contract" }, kyb: { verified: false } },
    },
    evidence: [{ label: "Wave 2 lock", kind: "tx", value: HASH, note: "second cycle", date: "2026-11-02" }],
  });
  assert.equal(manifest.verification?.contracts.escrow?.verified, true);
  assert.equal(manifest.verification?.contracts.datasets, undefined);
  assert.equal(manifest.evidence?.[0].kind, "tx");
  assert.equal(contractSourceUrl(manifest, "escrow"), "https://explorer.test.mezo.org/address/x?tab=contract");
  assert.equal(contractSourceUrl(manifest, "kyb"), `https://explorer.test.mezo.org/address/${ADDRESS}?tab=contract`);
});

test("manifeste : l'hôte de l'API Blockscout est dérivé de l'explorateur", () => {
  assert.equal(explorerApiBase("https://explorer.test.mezo.org"), "https://api.explorer.test.mezo.org");
  assert.equal(explorerApiBase("https://explorer.mezo.org/"), "https://api.explorer.mezo.org");
});
