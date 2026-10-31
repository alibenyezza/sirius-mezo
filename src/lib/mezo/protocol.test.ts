import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAddress } from "viem";
import { MEZO_TOKEN_ADDRESS, MUSD_GAS_COMPENSATION, MUSD_MIN_NET_DEBT, MUSD_PROTOCOL, musdProtocol } from "./protocol";

describe("adresses du protocole MUSD", () => {
  it("fournit une adresse valide et distincte pour chaque contrat des deux réseaux", () => {
    for (const network of ["testnet", "mainnet"] as const) {
      const addresses = musdProtocol(network);
      const values = Object.values(addresses);
      assert.equal(values.length, Object.keys(MUSD_PROTOCOL[network]).length);
      for (const value of values) assert.ok(isAddress(value, { strict: true }), `${network}: ${value}`);
      assert.equal(new Set(values.map((v) => v.toLowerCase())).size, values.length);
    }
  });

  it("ne confond pas testnet et mainnet", () => {
    assert.notEqual(musdProtocol("testnet").stabilityPool, musdProtocol("mainnet").stabilityPool);
    assert.notEqual(musdProtocol("testnet").savingsVault, musdProtocol("mainnet").savingsVault);
  });

  it("expose les constantes du protocole en wei", () => {
    assert.equal(MUSD_MIN_NET_DEBT, BigInt(1800) * BigInt(10) ** BigInt(18));
    assert.equal(MUSD_GAS_COMPENSATION, BigInt(200) * BigInt(10) ** BigInt(18));
    assert.ok(isAddress(MEZO_TOKEN_ADDRESS));
  });
});
