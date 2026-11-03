import { test } from "node:test";
import assert from "node:assert/strict";
import { feeAtomic, formatBps, providerNetAtomic } from "./platform-fee-math";

test("les frais suivent l'arrondi de l'escrow : vers le bas, le reste au fournisseur", () => {
  const ten = BigInt("10000000000000000000");
  assert.equal(feeAtomic(ten, 200), BigInt("200000000000000000"));
  assert.equal(providerNetAtomic(ten, 200), BigInt("9800000000000000000"));
  assert.equal(feeAtomic(BigInt(49), 200), BigInt(0));
  assert.equal(providerNetAtomic(BigInt(49), 200), BigInt(49));
  assert.equal(feeAtomic(ten, 0), BigInt(0));
});

test("un taux hors bornes est refusé", () => {
  assert.throws(() => feeAtomic(BigInt(1), -1), RangeError);
  assert.throws(() => feeAtomic(BigInt(1), 10_001), RangeError);
  assert.throws(() => feeAtomic(BigInt(1), 1.5), RangeError);
});

test("le taux s'affiche en pourcentage", () => {
  assert.equal(formatBps(200, "en-US"), "2 %");
  assert.equal(formatBps(50, "en-US"), "0.5 %");
});
