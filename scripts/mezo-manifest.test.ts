import assert from "node:assert/strict";
import { test } from "node:test";
import type { Abi } from "viem";
import {
  escrowFeatures,
  legacyEscrowAddresses,
  nextManifest,
  previousDeployments,
  reuseKybAddress,
  type DeploymentManifestFile,
} from "./mezo-manifest";

const KYB = "0xf0ab86b45202c1600cb54b49cbd35bd3e4bb5392";
const OLD_ESCROW = "0xd14a0af1581bd7bd80d9da0f775c1c254967abda";
const OLD_DATASETS = "0x2f7482e7cf68e9babda9e31b566ffcbaa3a9b969";
const OLDER_ESCROW = "0xefb89e4c5d32581bf09122cb6f4cc60558a27f67";
const NEW_ESCROW = `0x${"a1".repeat(20)}`;
const NEW_DATASETS = `0x${"b2".repeat(20)}`;
const DEPLOYER = "0xF1b3C80fF7ffa2D6f609D51dC5483e8e8da036c1";
const SIGNER = "0x2d017fb59077456E87C6f0E719dd75B03a910c8a";
const HASH = `0x${"ab".repeat(32)}`;

/** Manifeste tel qu'il existe aujourd'hui : un `previous` sous forme d'objet, une vérification, une preuve. */
function saved(): DeploymentManifestFile {
  return {
    network: "mezo-testnet",
    chainId: 31611,
    explorer: "https://explorer.test.mezo.org",
    deployedAt: "2026-10-26T13:05:23.199Z",
    deployer: DEPLOYER,
    lockAuthorizer: SIGNER,
    settlementToken: { symbol: "MUSD", address: `0x${"c3".repeat(20)}`, decimals: 18, codeHash: HASH },
    contracts: { escrow: OLD_ESCROW, kyb: KYB, datasets: OLD_DATASETS, kybMode: "open", escrowVersion: "sirius-escrow-usdc-v6" },
    verification: { verifiedAt: "2026-10-31T17:06:18.864Z", contracts: { escrow: { verified: true } } },
    demo: { provider: `0x${"d4".repeat(20)}`, borrower: SIGNER, datasetId: "mezo-demo-energy-consumption", amountMusd: "2", transactions: { mint: HASH, lock: HASH } },
    previous: { escrow: OLDER_ESCROW, kyb: `0x${"e5".repeat(20)}`, datasets: `0x${"f6".repeat(20)}`, lockAuthorizer: DEPLOYER, transactions: { lock: HASH } },
    evidence: [{ label: "Wave 2", kind: "tx", value: HASH }],
  };
}

function deployment() {
  return {
    chainId: 31611,
    explorer: "https://explorer.test.mezo.org",
    deployedAt: "2026-11-01T09:00:00.000Z",
    deployer: DEPLOYER,
    lockAuthorizer: SIGNER,
    settlementToken: saved().settlementToken,
    contracts: { escrow: NEW_ESCROW, kyb: KYB, datasets: NEW_DATASETS, kybMode: "open", escrowVersion: "sirius-escrow-usdc-v6", escrowFeatures: ["lockWithSignature"] },
  };
}

test("registre KYB : l'adresse explicite prime, puis celle du manifeste, sauf si un registre neuf est demandé", () => {
  assert.equal(reuseKybAddress({ SIRIUS_REUSE_KYB_ADDRESS: NEW_ESCROW }, saved()), NEW_ESCROW);
  assert.equal(reuseKybAddress({}, saved()), KYB);
  assert.equal(reuseKybAddress({ SIRIUS_FRESH_KYB: "true" }, saved()), undefined);
  assert.equal(reuseKybAddress({}, null), undefined);
  assert.throws(() => reuseKybAddress({ SIRIUS_REUSE_KYB_ADDRESS: "0x1234" }, null), /SIRIUS_REUSE_KYB_ADDRESS/);
});

test("manifeste : l'ancien trio devient la première entrée de previous, l'objet historique suit", () => {
  const next = nextManifest(saved(), deployment());
  assert.equal(next.contracts.escrow, NEW_ESCROW);
  assert.deepEqual(next.contracts.escrowFeatures, ["lockWithSignature"]);
  assert.equal(next.deployedAt, "2026-11-01T09:00:00.000Z");
  const previous = previousDeployments(next);
  assert.equal(previous.length, 2);
  assert.equal(previous[0].escrow, OLD_ESCROW);
  assert.equal(previous[0].datasets, OLD_DATASETS);
  assert.equal(previous[0].lockAuthorizer, SIGNER);
  assert.equal(previous[0].deployedAt, "2026-10-26T13:05:23.199Z");
  assert.equal(previous[0].escrowVersion, "sirius-escrow-usdc-v6");
  assert.deepEqual(previous[0].transactions, { mint: HASH, lock: HASH });
  assert.equal(previous[1].escrow, OLDER_ESCROW);
  assert.equal(previous[1].lockAuthorizer, DEPLOYER);
  assert.deepEqual(previous[1].transactions, { lock: HASH });
  assert.ok(Array.isArray(next.previous));
});

test("manifeste : la vérification et la démo sont remises à zéro, les preuves sont conservées", () => {
  const next = nextManifest(saved(), deployment());
  assert.equal(next.verification, undefined);
  assert.equal(next.demo, undefined);
  assert.deepEqual(next.evidence, [{ label: "Wave 2", kind: "tx", value: HASH }]);
  assert.equal(next.network, "mezo-testnet");
});

test("manifeste : un previous déjà en tableau est prolongé, le plus récent en premier", () => {
  const first = nextManifest(saved(), deployment());
  const again = nextManifest(first, { ...deployment(), deployedAt: "2026-11-02T09:00:00.000Z", contracts: { ...deployment().contracts, escrow: `0x${"99".repeat(20)}` } });
  assert.deepEqual(previousDeployments(again).map((entry) => entry.escrow), [NEW_ESCROW, OLD_ESCROW, OLDER_ESCROW]);
});

test("manifeste : sans manifeste précédent, ni previous ni evidence ; un trio identique n'est pas historisé", () => {
  const fresh = nextManifest(null, deployment());
  assert.equal(fresh.previous, undefined);
  assert.equal(fresh.evidence, undefined);
  const same = nextManifest(saved(), { ...deployment(), contracts: saved().contracts });
  assert.deepEqual(previousDeployments(same).map((entry) => entry.escrow), [OLDER_ESCROW]);
});

test("anciens escrows : ajoutés sans doublon ni casse, jamais l'escrow courant", () => {
  assert.equal(legacyEscrowAddresses(undefined, [OLD_ESCROW], NEW_ESCROW), OLD_ESCROW);
  assert.equal(legacyEscrowAddresses(`${OLDER_ESCROW}, ${OLD_ESCROW.toUpperCase().replace("0X", "0x")}`, [OLD_ESCROW], NEW_ESCROW), `${OLDER_ESCROW},${OLD_ESCROW.toUpperCase().replace("0X", "0x")}`);
  assert.equal(legacyEscrowAddresses(`${OLD_ESCROW},${NEW_ESCROW}`, [NEW_ESCROW], NEW_ESCROW), OLD_ESCROW);
  assert.equal(legacyEscrowAddresses("garbage,,", [], NEW_ESCROW), "");
});

test("fonctionnalités de l'escrow : lues dans l'ABI, vides pour un escrow sans lockWithSignature", () => {
  const withFeature = [
    { type: "function", name: "lock", stateMutability: "nonpayable", inputs: [], outputs: [] },
    { type: "function", name: "lockWithSignature", stateMutability: "nonpayable", inputs: [], outputs: [] },
    { type: "event", name: "LoanLocked", inputs: [] },
  ] as unknown as Abi;
  assert.deepEqual(escrowFeatures(withFeature), ["lockWithSignature"]);
  assert.deepEqual(escrowFeatures(withFeature.slice(0, 1)), []);
});
