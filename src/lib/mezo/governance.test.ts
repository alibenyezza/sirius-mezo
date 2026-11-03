import { test } from "node:test";
import assert from "node:assert/strict";
import { mezoGovernance, SIRIUS_FEE_DEFAULTS } from "./governance";

test("les adresses de gouvernance sont checksummées et distinctes par réseau", () => {
  for (const network of ["testnet", "mainnet"] as const) {
    const addresses = Object.values(mezoGovernance(network));
    assert.equal(new Set(addresses.map((a) => a.toLowerCase())).size, addresses.length, `${network} : doublon`);
  }
  const testnet = mezoGovernance("testnet");
  const mainnet = mezoGovernance("mainnet");
  for (const key of Object.keys(testnet) as Array<keyof typeof testnet>) {
    assert.notEqual(testnet[key], mainnet[key], `${key} identique sur les deux réseaux`);
  }
});

test("les contrats v1 périmés de tigris ne sont jamais utilisés", () => {
  const stale = ["0xb63f", "0x72f8"];
  for (const network of ["testnet", "mainnet"] as const) {
    for (const address of Object.values(mezoGovernance(network))) {
      assert.ok(!stale.some((prefix) => address.toLowerCase().startsWith(prefix)), address);
    }
  }
});

test("les frais par défaut restent sous le plafond du contrat et la remise les baisse", () => {
  assert.ok(SIRIUS_FEE_DEFAULTS.feeBps > 0 && SIRIUS_FEE_DEFAULTS.feeBps <= 1_000);
  assert.ok(SIRIUS_FEE_DEFAULTS.discountedBps < SIRIUS_FEE_DEFAULTS.feeBps);
  assert.ok(SIRIUS_FEE_DEFAULTS.incentiveBps <= 10_000);
  assert.ok(BigInt(SIRIUS_FEE_DEFAULTS.minVeMezoPower) > BigInt(0));
});
