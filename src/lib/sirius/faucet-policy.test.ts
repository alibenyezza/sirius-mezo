import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseEther, parseUnits } from "viem";
import { translateEnglish } from "@/lib/i18n/english";
import {
  deciderDistribution,
  demandesRestantes,
  doitEnvoyerBtc,
  doitEnvoyerMusd,
  etatReserveBtc,
  etatReserveMusd,
  messageReserveMusdEpuisee,
  MONTANT_BTC,
  MONTANT_MUSD,
  montantBtcWei,
  montantMusdAtomic,
  PLAFOND_MUSD_DESTINATAIRE,
  RESERVE_BTC_ALERTE,
  RESERVE_BTC_MINIMALE,
  RESERVE_MUSD_ALERTE_DEMANDES,
  SEUIL_BTC,
  type SoldesDistribution,
} from "./faucet-policy";

/** MUSD expose 18 décimales sur Mezo. */
const DECIMALS = 18;
const DISTRIBUTEUR = "0x6c02387335BfA4AB07E91F9c4dc83D0296d4C643";
const musd = (value: string) => parseUnits(value, DECIMALS);

/** Un visiteur neuf face à un distributeur bien pourvu. */
function soldes(overrides: Partial<SoldesDistribution> = {}): SoldesDistribution {
  return { reserveMusd: musd("150"), reserveBtc: parseEther("0.008"), soldeMusd: BigInt(0), soldeBtc: BigInt(0), ...overrides };
}

const decider = (overrides: Partial<SoldesDistribution> = {}) =>
  deciderDistribution(soldes(overrides), { decimals: DECIMALS, distributeur: DISTRIBUTEUR });

test("montants : dix MUSD par demande, un peu de BTC pour le gas, en unités du jeton", () => {
  assert.equal(MONTANT_MUSD, "10");
  assert.equal(montantMusdAtomic(DECIMALS), BigInt(10) * BigInt(10) ** BigInt(18));
  assert.equal(montantMusdAtomic(6), BigInt(10_000_000));
  assert.equal(montantBtcWei(), parseEther(MONTANT_BTC));
  assert.ok(montantBtcWei() > SEUIL_BTC, "le versement remet le visiteur au-dessus du seuil de gas");
  assert.ok(RESERVE_BTC_MINIMALE > montantBtcWei(), "la réserve minimale couvre au moins un versement et son gas");
  assert.ok(RESERVE_BTC_ALERTE > RESERVE_BTC_MINIMALE);
});

test("réserve MUSD : demandes restantes arrondies vers le bas, alerte avant épuisement", () => {
  assert.equal(demandesRestantes(musd("150"), DECIMALS), 15);
  assert.equal(demandesRestantes(musd("49.999"), DECIMALS), 4);
  assert.equal(demandesRestantes(musd("9.999"), DECIMALS), 0);
  assert.equal(demandesRestantes(BigInt(0), DECIMALS), 0);
  assert.equal(demandesRestantes(-BigInt(1), DECIMALS), 0);

  assert.equal(etatReserveMusd(musd("150"), DECIMALS), "ok");
  assert.equal(etatReserveMusd(musd(String(RESERVE_MUSD_ALERTE_DEMANDES * 10)), DECIMALS), "ok");
  assert.equal(etatReserveMusd(musd("49.999"), DECIMALS), "basse");
  assert.equal(etatReserveMusd(musd("10"), DECIMALS), "basse");
  assert.equal(etatReserveMusd(musd("9.999"), DECIMALS), "epuisee");
  assert.equal(etatReserveMusd(BigInt(0), DECIMALS), "epuisee");
});

test("réserve BTC : alerte sous 0,004, refus sous 0,0005", () => {
  assert.equal(etatReserveBtc(parseEther("0.008")), "ok");
  assert.equal(etatReserveBtc(RESERVE_BTC_ALERTE), "ok");
  assert.equal(etatReserveBtc(RESERVE_BTC_ALERTE - BigInt(1)), "basse");
  assert.equal(etatReserveBtc(RESERVE_BTC_MINIMALE), "basse");
  assert.equal(etatReserveBtc(RESERVE_BTC_MINIMALE - BigInt(1)), "epuisee");
  assert.equal(etatReserveBtc(BigInt(0)), "epuisee");
});

test("on ne verse qu'à qui en manque : MUSD jusqu'à 50 inclus, BTC sous le seuil de gas", () => {
  assert.equal(PLAFOND_MUSD_DESTINATAIRE, "50");
  assert.equal(doitEnvoyerMusd(BigInt(0), DECIMALS), true);
  assert.equal(doitEnvoyerMusd(musd("50"), DECIMALS), true);
  assert.equal(doitEnvoyerMusd(musd("50") + BigInt(1), DECIMALS), false);
  assert.equal(doitEnvoyerMusd(musd("1000"), DECIMALS), false);

  assert.equal(doitEnvoyerBtc(BigInt(0)), true);
  assert.equal(doitEnvoyerBtc(SEUIL_BTC - BigInt(1)), true);
  assert.equal(doitEnvoyerBtc(SEUIL_BTC), false);
});

test("visiteur neuf, distributeur pourvu : MUSD et BTC, sans alerte ni refus", () => {
  assert.deepEqual(decider(), { envoyerMusd: true, envoyerBtc: true, alertes: [], refus: null });
});

test("compte déjà pourvu : rien n'est versé, et rien n'est refusé", () => {
  const decision = decider({ soldeMusd: musd("120"), soldeBtc: parseEther("0.01") });
  assert.deepEqual(decision, { envoyerMusd: false, envoyerBtc: false, alertes: [], refus: null });
});

test("compte pourvu en MUSD mais sans gas : le BTC seul, même si la réserve MUSD est vide", () => {
  const decision = decider({ soldeMusd: musd("60"), reserveMusd: BigInt(0) });
  assert.equal(decision.envoyerMusd, false);
  assert.equal(decision.envoyerBtc, true);
  assert.equal(decision.refus, null);
  assert.equal(decision.alertes.length, 1);
  assert.match(decision.alertes[0], /réserve MUSD basse : 0 MUSD, 0 demande/);
  assert.match(decision.alertes[0], new RegExp(DISTRIBUTEUR));
});

test("réserve MUSD vide et visiteur à sec : refus qui dit comment recharger, adresse incluse, jamais de clé", () => {
  const reserve = musd("4.5");
  const decision = decider({ reserveMusd: reserve });
  assert.equal(decision.refus, messageReserveMusdEpuisee(reserve, DECIMALS, DISTRIBUTEUR));
  assert.equal(
    decision.refus,
    `Réserve MUSD du distributeur épuisée (4.5 MUSD) — emprunte du MUSD contre du BTC de test sur https://testnet.mezo.org et envoie-le à ${DISTRIBUTEUR}`,
  );
  assert.equal(
    translateEnglish(decision.refus),
    `Faucet MUSD reserve is empty (4.5 MUSD) — borrow MUSD against test BTC at https://testnet.mezo.org and send it to ${DISTRIBUTEUR}`,
  );
  assert.doesNotMatch(decision.refus, /0x[0-9a-fA-F]{64}/);
});

test("réserve MUSD basse : la distribution continue, l'alerte compte les demandes restantes", () => {
  const decision = decider({ reserveMusd: musd("35") });
  assert.equal(decision.refus, null);
  assert.equal(decision.envoyerMusd, true);
  assert.deepEqual(decision.alertes.map((alerte) => /3 demande\(s\)/.test(alerte)), [true]);
  assert.match(decision.alertes[0], /testnet\.mezo\.org/);
});

test("réserve BTC épuisée : refus avant toute écriture, même pour un compte qui n'a pas besoin de gas", () => {
  const decision = decider({ reserveBtc: parseEther("0.0001"), soldeBtc: parseEther("1") });
  assert.equal(decision.refus, "Distributeur épuisé (0.0001 BTC) — préviens l'équipe pour qu'elle le recharge");
  assert.equal(translateEnglish(decision.refus), "Faucet depleted (0.0001 BTC) — contact the team to refill it");
  assert.equal(decision.alertes.length, 1);
  assert.match(decision.alertes[0], /réserve BTC basse : 0.0001 BTC/);
});

test("réserve BTC basse : alerte sans refus ; les deux réserves basses donnent deux alertes", () => {
  const basse = decider({ reserveBtc: parseEther("0.002") });
  assert.equal(basse.refus, null);
  assert.equal(basse.alertes.length, 1);
  const deux = decider({ reserveBtc: parseEther("0.002"), reserveMusd: musd("20") });
  assert.equal(deux.refus, null);
  assert.equal(deux.alertes.length, 2);
});

test("le BTC prime sur le MUSD dans le refus : sans gas, le distributeur ne peut rien transférer", () => {
  const decision = decider({ reserveBtc: BigInt(0), reserveMusd: BigInt(0) });
  assert.match(decision.refus ?? "", /^Distributeur épuisé/);
});

test("le faucet transfère du MUSD depuis sa réserve ; il ne frappe plus rien", () => {
  const source = readFileSync(new URL("./faucet.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /functionName:\s*"mint"/);
  assert.match(source, /functionName:\s*"transfer"/);
  assert.match(source, /functionName:\s*"balanceOf"/);
  assert.match(source, /deciderDistribution\(/);
  assert.match(source, /AppError\(decision\.refus, 503\)/);
});
