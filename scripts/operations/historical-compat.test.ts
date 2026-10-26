// B2.1 — Compatibilité historique épinglée. Chaque test fixe le comportement d'un lecteur face à un
// format ancien : si quelqu'un le casse, ce test échoue. La matrice complète est dans
// docs/HISTORICAL-COMPATIBILITY.md ; les lecteurs déjà couverts ailleurs n'y sont pas dupliqués.
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { test } from "node:test";
import * as viem from "viem";
import * as appError from "../../src/lib/app-error";
import { siriusescrowAbi } from "../../src/lib/evm/abi/siriusescrow";
import { siriusescrowv7Abi } from "../../src/lib/evm/abi/siriusescrowv7";
import * as address from "../../src/lib/evm/address";
import * as networks from "../../src/lib/evm/networks";
import { parseDownloadedModel } from "../../src/lib/models/registry";
import { loadModule, serverOnly } from "./module-testkit";

const CURRENT = "0xc6a27dd5fdfdeda069b5634ca8d44416dfdb3f4f";
const OLD = "0xae326acee10138d47623dc0caf9d8b4e970090b1";
const BORROWER = "0x37f98be7c9d48b5d39e449616e7c70e37e29db13";
const PROVIDER = "0x930f5a13d65b3e7e07431a38da30229562e3318b";
const MASTER = Buffer.alloc(32, 5).toString("base64");
const ZERO32 = `0x${"0".repeat(64)}`;

type Encryption = typeof import("../../src/lib/crypto/encryption");
type Receipts = typeof import("../../src/lib/runner/receipt");
type Escrow = typeof import("../../src/lib/evm/escrow");

function receiptsUnderMasterKey() {
  const env = { SIRIUS_MASTER_KEY: MASTER, EVM_NETWORK: "testnet", SIRIUS_ESCROW_ADDRESS: CURRENT, SIRIUS_LEGACY_ESCROW_ADDRESSES: OLD };
  const encryption = loadModule<Encryption>("src/lib/crypto/encryption.ts", { "server-only": serverOnly, "node:crypto": crypto }, { process: { env } });
  const receipts = loadModule<Receipts>("src/lib/runner/receipt.ts", {
    "server-only": serverOnly, "node:crypto": crypto, "@/lib/app-error": appError, "@/lib/crypto/encryption": encryption,
    "@/lib/tee/evm-binding": { evmEscrowBinding: () => ({ chainId: 31611, escrow: CURRENT }) },
    "@/lib/evm/history": { trustedEscrowBinding: (binding: { chainId: number; escrow: string }) => {
      if (![CURRENT, OLD].includes(binding.escrow.toLowerCase())) throw new appError.AppError("Déploiement historique non autorisé", 409);
      return { chainId: binding.chainId, escrow: binding.escrow.toLowerCase() };
    } },
  }, { process: { env } });
  /** Reçu historique, signé comme l'ancien runner le faisait : clé HMAC dérivée du libellé de sa version. */
  const historical = (payload: Record<string, unknown>, keyVersion: 2 | 3 = 2) => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const key = encryption.deriveKey(encryption.getMasterKey(), `runner-receipt:hmac:v${keyVersion}`);
    return `${body}.${crypto.createHmac("sha256", key).update(body).digest("base64url")}`;
  };
  return { receipts, historical };
}

test("un reçu d'entraînement v2 relivre encore son modèle, mais seulement pour son propre job", () => {
  const { receipts, historical } = receiptsUnderMasterKey();
  const token = historical({ version: 2, kind: "training", jobId: "job-hist", datasetId: "ds-1", owner: PROVIDER, modelCid: "bafy-hist" });
  const receipt = receipts.verifyTrainingReceipt(token, "job-hist");
  assert.equal(receipt.version, 2);
  assert.equal(receipt.modelCid, "bafy-hist");
  assert.equal("modelId" in receipt, false, "aucun profil n'est inventé pour un reçu v2");
  assert.throws(() => receipts.verifyTrainingReceipt(token, "autre-job"), /hors scope/);
  // Un reçu v2 signé avec la clé v3 n'est pas un reçu historique : les deux clés restent distinctes.
  assert.throws(() => receipts.verifyTrainingReceipt(historical({ version: 2, kind: "training", jobId: "job-hist" }, 3), "job-hist"), /Reçu runner invalide/);
  const fresh = receipts.issueTrainingReceipt({ jobId: "job-new", datasetId: "ds-1", owner: PROVIDER, modelCid: "bafy-new", modelId: "linear_regression", modelVersion: "1.0.0" });
  assert.equal(receipts.verifyTrainingReceipt(fresh, "job-new").version, 3);
});

test("un reçu de dataset v2 est refusé : un dataset scellé sous l'ancien format doit être réimporté", () => {
  const { receipts, historical } = receiptsUnderMasterKey();
  const dataset = { datasetId: "ds-1", cid: "bafy-ds", wrappedKey: "wk", merkleRoot: "root", priceUsdcAtomic: "10", challengeDays: 7,
    modelId: "linear_regression" as const, modelVersion: "1.0.0" as const };
  const legacy = historical({ version: 2, kind: "dataset", datasetId: "ds-1", owner: PROVIDER, cid: "bafy-ds",
    wrappedKeyHash: crypto.createHash("sha256").update("wk").digest("hex"), merkleRoot: "root", priceUsdcAtomic: "10", challengeDays: 7 });
  assert.throws(() => receipts.verifyDatasetReceipt(legacy, dataset), /Reçu runner invalide/);
  assert.equal(receipts.verifyDatasetReceipt(receipts.issueDatasetReceipt(PROVIDER, dataset), dataset).version, 3);
});

test("un reçu de prêt v2 ne sert qu'à relivrer un modèle déjà réglé, sur un escrow historique déclaré", () => {
  const { receipts, historical } = receiptsUnderMasterKey();
  const payload = { version: 2, kind: "loan", loanId: "loan-hist", datasetId: "ds-1", borrower: BORROWER, provider: PROVIDER, modelCid: "bafy-l",
    loanKey: `0x${"ab".repeat(32)}`, chainId: 31611, escrow: OLD, amountUsdcAtomic: "10", challengeDays: 7, deliveryPublicKey: "k",
    releaseEnvelopeHash: "f".repeat(64), attestationHash: "a".repeat(64) };
  const token = historical(payload);
  assert.throws(() => receipts.verifyLoanReceipt(token, "loan-hist"), appError.AppError);
  assert.equal(receipts.verifyLoanDeliveryReceipt(token, "loan-hist").escrow, OLD);
  assert.throws(() => receipts.verifyLoanDeliveryReceipt(historical({ ...payload, escrow: `0x${"99".repeat(20)}` }), "loan-hist"), /non autorisé/);
});

function escrowUnder(version: string, loan: Record<string, unknown> | null) {
  const env = { EVM_NETWORK: "testnet", SIRIUS_ESCROW_ADDRESS: CURRENT, SIRIUS_LEGACY_ESCROW_ADDRESSES: OLD };
  const client = { readContract: async ({ functionName }: { functionName: string }) => {
    if (functionName === "VERSION") return version;
    if (functionName === "getLoan") { if (!loan) return { status: 0 }; return loan; }
    throw new Error(`Lecture inattendue : ${functionName}`);
  } };
  const binding = { evmEscrowBinding: () => ({ chainId: 31611, escrow: CURRENT }) };
  const history = loadModule<typeof import("../../src/lib/evm/history")>("src/lib/evm/history.ts", {
    "server-only": serverOnly, viem, "@/lib/app-error": appError, "@/lib/tee/evm-binding": binding, "./address": address,
    "./client": { getPublicClient: () => client }, "./loan-key": { loanIdHash: () => ZERO32 },
    "./abi/siriusescrow": { siriusescrowAbi }, "./abi/siriusescrowv7": { siriusescrowv7Abi },
  }, { process: { env } });
  const stub = (...names: string[]) => Object.fromEntries(names.map((name) => [name, () => { throw new Error(`${name} ne doit pas être appelé`); }]));
  return loadModule<Escrow>("src/lib/evm/escrow.ts", {
    "server-only": serverOnly, viem, "@/lib/app-error": appError, "./runner-account": stub("settlementAccount"),
    "./abi/siriusescrow": { siriusescrowAbi }, "./abi/siriusescrowv7": { siriusescrowv7Abi }, "@/lib/billing/quote": stub("quoteTermsHash"),
    "./address": address, "./abi/siriusdatasetregistry": { siriusdatasetregistryAbi: [] }, "./addresses": stub("datasetRegistryAddress", "escrowAddress"),
    "./client": { getPublicClient: () => client }, "./dataset-key": stub("datasetIdHash"), "./loan-key": { loanIdHash: () => ZERO32 }, "./networks": networks,
    "@/lib/models/registry": stub("trainingProfileHash"), "@/lib/tee/evm-binding": binding, "./history": history,
    "./lock-authorization": { lockAuthorizationTypedData: () => { throw new Error(); }, LOCK_AUTHORIZATION_TTL_SECONDS: 300 },
    "@/lib/runner/budget": stub("runnerBudget"), "@/lib/runner/budget-transaction": stub("sendBudgetedTransaction"),
    "@/lib/runner/transaction-recovery": stub("reconcileRunnerTransactions"), "@/lib/runner/gas-policy": stub("boundedGas", "lowGasBalanceAlert"),
    "@/lib/runner/fee-replacement": stub("resignWithFreshFees"),
    "@/lib/runner/transaction-journal": stub("sealRunnerTransaction"), "./finality": stub("assertCanonicalReceipt", "confirmedBlock"),
  }, { process: { env } });
}

const LOAN_KEY = `0x${"ab".repeat(32)}` as const;
const legacyLoan = { provider: PROVIDER, amount: BigInt(10_000_000), borrower: BORROWER, deadline: BigInt(1_900_000_000), status: 1,
  hashlock: `0x${"11".repeat(32)}`, preimage: ZERO32, datasetId: `0x${"22".repeat(32)}` };

test("les prêts des escrows v4, v5, v6 et v7 se lisent chacun dans leur format, sans inventer de champ", async () => {
  // v4 : tuple sans profil d'entraînement, lu avec l'ABI historique ; le profil vaut zéro, jamais une valeur par défaut.
  const v4 = await escrowUnder("sirius-escrow-usdc-v4", legacyLoan).readLoan(LOAN_KEY, { chainId: 31611, escrow: OLD });
  assert.equal(v4?.amountUsdcAtomic, "10000000");
  assert.equal(v4?.trainingProfile, ZERO32);
  assert.equal("billing" in (v4 ?? {}), false);
  for (const version of ["sirius-escrow-usdc-v5", "sirius-escrow-usdc-v6"]) {
    const loan = await escrowUnder(version, { ...legacyLoan, trainingProfile: `0x${"33".repeat(32)}` }).readLoan(LOAN_KEY, { chainId: 31611, escrow: OLD });
    assert.equal(loan?.trainingProfile, `0x${"33".repeat(32)}`);
    assert.equal(loan?.provider, PROVIDER);
  }
  const v7 = await escrowUnder("sirius-escrow-usdc-v7", { ...legacyLoan, datasetAmount: BigInt(5), computeAmount: BigInt(7), maxFailureFee: BigInt(1),
    consumedCompute: BigInt(0), computeRecipient: PROVIDER, termsHash: `0x${"44".repeat(32)}`, lockedAt: BigInt(1), trainingProfile: `0x${"33".repeat(32)}` })
    .readLoan(LOAN_KEY, { chainId: 31611, escrow: CURRENT });
  assert.equal(v7?.amountUsdcAtomic, "12");
  assert.deepEqual([v7?.billing?.datasetAmount, v7?.billing?.computeAmount, v7?.billing?.maxFailureFee], ["5", "7", "1"]);
  assert.equal(await escrowUnder("sirius-escrow-usdc-v6", null).readLoan(LOAN_KEY, { chainId: 31611, escrow: OLD }), null);
  await assert.rejects(escrowUnder("sirius-escrow-usdc-v3", legacyLoan).readLoan(LOAN_KEY, { chainId: 31611, escrow: OLD }), /non supportée/);
  // Un escrow absent de la liste historique n'est jamais lu, même avec une version connue.
  await assert.rejects(escrowUnder("sirius-escrow-usdc-v6", legacyLoan).readLoan(LOAN_KEY, { chainId: 31611, escrow: `0x${"99".repeat(20)}` }), /non autorisé/);
});

test("le format historique du modèle linéaire s'ouvre tel quel, sans version ni MAE ajoutées", () => {
  const historical = { algo: "linear_regression", target: "y", features: ["a", "b"], coefficients: [0.1, 0.2, 0.3], metrics: { r2: 0.9, rmse: 1.5, n: 40 } };
  const parsed = parseDownloadedModel(historical);
  assert.equal("version" in parsed, false);
  assert.equal("mae" in parsed.metrics, false);
  assert.throws(() => parseDownloadedModel({ ...historical, version: "1.0.0" }), /invalide/);
  assert.throws(() => parseDownloadedModel({ ...historical, metrics: { ...historical.metrics, mae: 0.1 } }), /invalide/);
});
