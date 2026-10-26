import assert from "node:assert/strict";
import { test } from "node:test";
import { checkReleaseEnvironments, MAINNET_STABLECOIN, MAINNET_USDC } from "./release-check.mjs";

/** MUSD (Mezo) sur Mezo mainnet, forme checksummée telle qu'un opérateur la colle. */
const MUSD_CHECKSUMMED = "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186";
/** Ancien USDC natif de Mezo mainnet, refusé depuis le passage à MUSD. */
const LEGACY_USDC = "0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8";

function environments() {
  const common = { EVM_NETWORK: "testnet", SIRIUS_BILLING_VERSION: "7", SIRIUS_EVM_FINALITY: "finalized",
    SIRIUS_EVM_CONFIRMATIONS: "2", TEE_MODE: "phala", SIRIUS_LOCK_AUTHORIZER: `0x${"11".repeat(20)}`,
    RUNNER_TRANSPORT_SECRET: "synthetic".repeat(8) };
  for (const [index, suffix] of ["ESCROW", "DATASET", "KYB", "MUSD"].entries()) common[`SIRIUS_${suffix}_ADDRESS`] = `0x${String(index + 2).repeat(40)}`;
  const client = { ...common, SIRIUS_REQUIRE_PHALA: "true", RUNNER_URL: "https://runner.example",
    DATABASE_URL: "postgresql://test:synthetic@db.example/test", SIRIUS_EXPECTED_MRTD: "11".repeat(48),
    SIRIUS_EXPECTED_COMPOSE_HASH: "33".repeat(32),
    SIRIUS_EXPECTED_MASTER_KEY_CHAIN_SHA256: "44".repeat(32), NEXT_PUBLIC_SIRIUS_INGRESS_KEY_SHA256: "55".repeat(32) };
  const next = { ...client, NEXT_PUBLIC_EVM_NETWORK: "testnet" };
  for (const suffix of ["ESCROW", "DATASET", "KYB", "MUSD"]) next[`NEXT_PUBLIC_SIRIUS_${suffix}_ADDRESS`] = common[`SIRIUS_${suffix}_ADDRESS`];
  return [next, { ...client }, { ...common, RUNNER_BUDGET_FILE: "/budget.sqlite", RUNNER_BILLING_POLICY_FILE: "/billing.json" }];
}
test("le préflight refuse les divergences de contrat, de finalité et de secrets sans les afficher", () => {
  const env = environments();
  assert.equal(checkReleaseEnvironments(...env).configurationReady, true);
  env[1].SIRIUS_ESCROW_ADDRESS = `0x${"ab".repeat(20)}`;
  env[1].SIRIUS_EVM_FINALITY = "confirmations";
  env[1].RUNNER_TRANSPORT_SECRET = "SECRET_NE_PAS_AFFICHER";
  const result = checkReleaseEnvironments(...env);
  assert.equal(result.configurationReady, false);
  assert.ok(result.issues.includes("divergence.SIRIUS_ESCROW_ADDRESS"));
  assert.ok(result.issues.includes("divergence.SIRIUS_EVM_FINALITY"));
  assert.ok(!JSON.stringify(result).includes(env[1].RUNNER_TRANSPORT_SECRET));
});
test("A-02 : SIRIUS_EXPECTED_RTMR3 n'est ni exigé ni comparé entre Next et le reaper (RTMR3 n'est plus épinglé)", () => {
  const env = environments();
  assert.ok(env.every((role) => !("SIRIUS_EXPECTED_RTMR3" in role)));
  assert.equal(checkReleaseEnvironments(...env).configurationReady, true);
  env[0].SIRIUS_EXPECTED_RTMR3 = "22".repeat(48);
  env[1].SIRIUS_EXPECTED_RTMR3 = "23".repeat(48);
  const result = checkReleaseEnvironments(...env);
  assert.equal(result.configurationReady, true);
  assert.ok(!result.issues.some((issue) => issue.includes("RTMR3")));
});
test("les clés de déploiement et les master keys n’entrent dans aucun service actif", () => {
  const env = environments();
  env[2].MEZO_DEPLOYER_KEY = "synthetic";
  env[0].SIRIUS_MASTER_KEY = "synthetic";
  assert.equal(checkReleaseEnvironments(...env).configurationReady, false);
});

function mainnetEnvironments() {
  const [next, reaper, runner] = environments();
  const usdc = MUSD_CHECKSUMMED;
  for (const env of [next, reaper, runner]) { env.EVM_NETWORK = "mainnet"; env.SIRIUS_USDC_ADDRESS = usdc; }
  Object.assign(next, { NEXT_PUBLIC_EVM_NETWORK: "mainnet", NEXT_PUBLIC_SIRIUS_USDC_ADDRESS: usdc,
    SIRIUS_MAX_LOAN_USDC: "50", SIRIUS_MAX_EXPOSURE_USDC: "500", NEXT_PUBLIC_WEB3AUTH_NETWORK: "sapphire_mainnet" });
  return [next, reaper, runner];
}

test("une configuration mainnet complète passe, et une configuration testnet est refusée en mode mainnet", () => {
  assert.equal(checkReleaseEnvironments(...mainnetEnvironments(), "mainnet").configurationReady, true);
  const testnet = checkReleaseEnvironments(...environments(), "mainnet");
  assert.equal(testnet.configurationReady, false);
  assert.ok(testnet.issues.includes("next.EVM_NETWORK"));
  assert.equal(checkReleaseEnvironments(...mainnetEnvironments()).configurationReady, false);
});

test("le jeton mainnet de la vérification de sortie est l'MUSD de Mezo, en minuscules, avec son alias historique", () => {
  assert.equal(MAINNET_STABLECOIN, MUSD_CHECKSUMMED.toLowerCase());
  assert.equal(MAINNET_USDC, MAINNET_STABLECOIN);
});

test("le mode mainnet accepte le MUSD sous toute casse pour chaque rôle, et rien d'autre", () => {
  for (const [role, index] of [["next", 0], ["reaper", 1], ["runner", 2]]) {
    for (const token of [LEGACY_USDC, LEGACY_USDC.toLowerCase(), `0x${"5".repeat(40)}`, ""]) {
      const env = mainnetEnvironments();
      env[index].SIRIUS_USDC_ADDRESS = token;
      if (index === 0) env[0].NEXT_PUBLIC_SIRIUS_USDC_ADDRESS = token;
      const result = checkReleaseEnvironments(...env, "mainnet");
      assert.equal(result.configurationReady, false, `${role} ${token}`);
      assert.ok(result.issues.includes(`${role}.SIRIUS_USDC_ADDRESS.mainnet`), `${role} ${token}`);
    }
  }
  const env = mainnetEnvironments();
  for (const e of env) e.SIRIUS_USDC_ADDRESS = MUSD_CHECKSUMMED.toLowerCase();
  env[0].NEXT_PUBLIC_SIRIUS_USDC_ADDRESS = MUSD_CHECKSUMMED;
  assert.equal(checkReleaseEnvironments(...env, "mainnet").configurationReady, true);
  // Hors mainnet, aucun jeton n'est imposé : la configuration testnet garde son jeton d'essai.
  assert.equal(checkReleaseEnvironments(...environments()).configurationReady, true);
});

test("le mode mainnet refuse l'ancien USDC, la démo, le faucet, le KYB ouvert et les plafonds absents", () => {
  const cases = [
    [(env) => { env[2].SIRIUS_USDC_ADDRESS = `0x${"5".repeat(40)}`; }, "runner.SIRIUS_USDC_ADDRESS.mainnet"],
    [(env) => { env[2].SIRIUS_USDC_ADDRESS = LEGACY_USDC; }, "runner.SIRIUS_USDC_ADDRESS.mainnet"],
    [(env) => { env[1].SIRIUS_USDC_ADDRESS = LEGACY_USDC.toLowerCase(); }, "reaper.SIRIUS_USDC_ADDRESS.mainnet"],
    [(env) => { env[0].SIRIUS_DEPLOYMENT_MODE = "demo"; }, "next.demo-mode"],
    [(env) => { env[0].SIRIUS_FAUCET_KEY = "x"; }, "next.faucet-key"],
    [(env) => { env[1].SIRIUS_KYB_MODE = "open"; }, "reaper.SIRIUS_KYB_MODE.open"],
    [(env) => { delete env[0].SIRIUS_MAX_EXPOSURE_USDC; }, "next.SIRIUS_MAX_EXPOSURE_USDC"],
    [(env) => { env[0].SIRIUS_LEGACY_ESCROW_ADDRESSES = `0x${"9".repeat(40)}`; }, "next.SIRIUS_LEGACY_ESCROW_ADDRESSES.inherited"],
    [(env) => { env[0].NEXT_PUBLIC_WEB3AUTH_NETWORK = "sapphire_devnet"; }, "next.NEXT_PUBLIC_WEB3AUTH_NETWORK"],
  ];
  for (const [change, issue] of cases) {
    const env = mainnetEnvironments();
    change(env);
    assert.ok(checkReleaseEnvironments(...env, "mainnet").issues.includes(issue), issue);
  }
});

test("finalité rapide : facultative et cohérente entre les rôles, bornes vérifiées, finalized toujours exigé", () => {
  // Absente partout : rien ne change.
  assert.equal(checkReleaseEnvironments(...mainnetEnvironments(), "mainnet").configurationReady, true);
  // Active partout avec les constantes du Compose (runner) recopiées dans son fichier privé.
  const enabled = mainnetEnvironments();
  for (const env of enabled) Object.assign(env, { SIRIUS_FAST_FINALITY: "true", SIRIUS_FAST_FINALITY_MAX_USDC: "25", SIRIUS_FAST_FINALITY_CONFIRMATIONS: "30" });
  enabled[0].SIRIUS_FAST_FINALITY_TOTAL_USDC = "100";
  const ok = checkReleaseEnvironments(...enabled, "mainnet");
  assert.equal(ok.configurationReady, true, JSON.stringify(ok.issues));
  // `false` explicite et absent se valent.
  const mixedOff = mainnetEnvironments();
  mixedOff[1].SIRIUS_FAST_FINALITY = "false";
  assert.equal(checkReleaseEnvironments(...mixedOff, "mainnet").configurationReady, true);
  // Retour arrière de niveau 1 : Next et le reaper à false pendant que le Compose garde ses constantes.
  const rolledBack = mainnetEnvironments();
  Object.assign(rolledBack[2], { SIRIUS_FAST_FINALITY: "true", SIRIUS_FAST_FINALITY_MAX_USDC: "25", SIRIUS_FAST_FINALITY_CONFIRMATIONS: "30" });
  rolledBack[0].SIRIUS_FAST_FINALITY = "false";
  const rb = checkReleaseEnvironments(...rolledBack, "mainnet");
  assert.equal(rb.configurationReady, true, JSON.stringify(rb.issues));
  // Seuil ou confirmations du runner différents de Next pendant que Next est à false : sans effet.
  rolledBack[2].SIRIUS_FAST_FINALITY_MAX_USDC = "10";
  assert.equal(checkReleaseEnvironments(...rolledBack, "mainnet").configurationReady, true);
  const cases = [
    // Direction nuisible : Next demande le palier rapide à une enclave qui l'ignore.
    [(env) => { env[0].SIRIUS_FAST_FINALITY = "true"; env[1].SIRIUS_FAST_FINALITY = "true"; }, "next.SIRIUS_FAST_FINALITY.runner-disabled"],
    [(env) => { env[0].SIRIUS_FAST_FINALITY = "true"; env[1].SIRIUS_FAST_FINALITY = "true"; }, "reaper.SIRIUS_FAST_FINALITY.runner-disabled"],
    // Next et le reaper doivent se lire pareil.
    [(env) => { env[0].SIRIUS_FAST_FINALITY = "true"; env[2].SIRIUS_FAST_FINALITY = "true"; }, "divergence.SIRIUS_FAST_FINALITY"],
    [(env) => { for (const e of env) e.SIRIUS_FAST_FINALITY = "true"; env[2].SIRIUS_FAST_FINALITY_MAX_USDC = "10"; }, "divergence.SIRIUS_FAST_FINALITY_MAX_USDC"],
    [(env) => { for (const e of env) e.SIRIUS_FAST_FINALITY = "true"; env[1].SIRIUS_FAST_FINALITY_CONFIRMATIONS = "12"; }, "divergence.SIRIUS_FAST_FINALITY_CONFIRMATIONS"],
    [(env) => { env[0].SIRIUS_FAST_FINALITY = "oui"; }, "next.SIRIUS_FAST_FINALITY"],
    [(env) => { env[2].SIRIUS_FAST_FINALITY_CONFIRMATIONS = "0"; }, "runner.SIRIUS_FAST_FINALITY_CONFIRMATIONS"],
    [(env) => { env[2].SIRIUS_FAST_FINALITY_CONFIRMATIONS = "101"; }, "runner.SIRIUS_FAST_FINALITY_CONFIRMATIONS"],
    [(env) => { env[0].SIRIUS_FAST_FINALITY_MAX_USDC = "0"; }, "next.SIRIUS_FAST_FINALITY_MAX_USDC"],
    [(env) => { env[0].SIRIUS_FAST_FINALITY_MAX_USDC = "150"; }, "next.SIRIUS_FAST_FINALITY_MAX_USDC.above-total"],
    [(env) => { env[0].SIRIUS_FAST_FINALITY_TOTAL_USDC = "-1"; }, "next.SIRIUS_FAST_FINALITY_TOTAL_USDC"],
    // Le palier rapide n'autorise jamais le mode confirmations nu.
    [(env) => { for (const e of env) Object.assign(e, { SIRIUS_FAST_FINALITY: "true", SIRIUS_EVM_FINALITY: "confirmations" }); }, "next.SIRIUS_EVM_FINALITY"],
  ];
  for (const [change, issue] of cases) {
    const env = mainnetEnvironments();
    change(env);
    assert.ok(checkReleaseEnvironments(...env, "mainnet").issues.includes(issue), issue);
  }
});

test("accès instantané KYB : la clé automatique n'est admise que sur Next, avec le drapeau, et le vérificateur humain reste interdit", () => {
  const key = `0x${"ab".repeat(32)}`;
  // Sans la fonction, rien ne change : une configuration mainnet complète passe toujours.
  assert.equal(checkReleaseEnvironments(...mainnetEnvironments(), "mainnet").configurationReady, true);
  const enabled = mainnetEnvironments();
  Object.assign(enabled[0], { SIRIUS_KYB_AUTO_INVITE: "true", SIRIUS_KYB_AUTO_INVITE_KEY: key });
  const ok = checkReleaseEnvironments(...enabled, "mainnet");
  assert.equal(ok.configurationReady, true, JSON.stringify(ok.issues));
  assert.ok(!JSON.stringify(ok).includes(key));
  // Espaces autour des valeurs : lus comme à l'exécution, ils ne changent rien.
  const padded = mainnetEnvironments();
  Object.assign(padded[0], { SIRIUS_KYB_AUTO_INVITE: " true ", SIRIUS_KYB_AUTO_INVITE_KEY: ` ${key} ` });
  assert.equal(checkReleaseEnvironments(...padded, "mainnet").configurationReady, true);
  const sponsored = mainnetEnvironments();
  Object.assign(sponsored[0], { SIRIUS_KYB_AUTO_INVITE: "true", SIRIUS_KYB_AUTO_INVITE_KEY: key, SIRIUS_KYB_AUTO_SPONSOR: "true" });
  assert.equal(checkReleaseEnvironments(...sponsored, "mainnet").configurationReady, true);
  const blank = mainnetEnvironments();
  Object.assign(blank[0], { SIRIUS_KYB_AUTO_INVITE: " ", SIRIUS_KYB_AUTO_INVITE_KEY: "  " });
  assert.equal(checkReleaseEnvironments(...blank, "mainnet").configurationReady, true);
  const cases = [
    [(env) => { env[0].SIRIUS_KYB_AUTO_INVITE = "true"; }, "next.SIRIUS_KYB_AUTO_INVITE_KEY"],
    [(env) => { Object.assign(env[0], { SIRIUS_KYB_AUTO_INVITE: "true", SIRIUS_KYB_AUTO_INVITE_KEY: "0xabc" }); }, "next.SIRIUS_KYB_AUTO_INVITE_KEY"],
    [(env) => { env[0].SIRIUS_KYB_AUTO_INVITE_KEY = key; }, "next.SIRIUS_KYB_AUTO_INVITE_KEY.without-flag"],
    [(env) => { Object.assign(env[0], { SIRIUS_KYB_AUTO_INVITE: "false", SIRIUS_KYB_AUTO_INVITE_KEY: key }); }, "next.SIRIUS_KYB_AUTO_INVITE_KEY.without-flag"],
    [(env) => { Object.assign(env[0], { SIRIUS_KYB_AUTO_INVITE: "1", SIRIUS_KYB_AUTO_INVITE_KEY: key }); }, "next.SIRIUS_KYB_AUTO_INVITE"],
    [(env) => { Object.assign(env[0], { SIRIUS_KYB_AUTO_INVITE: "true", SIRIUS_KYB_AUTO_INVITE_KEY: key, SIRIUS_KYB_AUTO_SPONSOR: "yes" }); }, "next.SIRIUS_KYB_AUTO_SPONSOR"],
    [(env) => { env[1].SIRIUS_KYB_AUTO_INVITE_KEY = key; }, "reaper.forbidden-secret-or-simulator"],
    [(env) => { env[2].SIRIUS_KYB_AUTO_INVITE_KEY = key; }, "runner.forbidden-secret-or-simulator"],
    [(env) => { Object.assign(env[0], { SIRIUS_KYB_AUTO_INVITE: "true", SIRIUS_KYB_AUTO_INVITE_KEY: key, SIRIUS_KYB_VERIFIER_KEY: key }); }, "next.forbidden-secret-or-simulator"],
  ];
  for (const [change, issue] of cases) {
    const env = mainnetEnvironments();
    change(env);
    const result = checkReleaseEnvironments(...env, "mainnet");
    assert.ok(result.issues.includes(issue), issue);
    assert.ok(!JSON.stringify(result).includes(key), issue);
  }
});
