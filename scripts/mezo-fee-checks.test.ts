import assert from "node:assert/strict";
import test from "node:test";
import { feeConfigErrors } from "./mezo-fee-checks";

const OK = {
  feeBps: BigInt(200), incentiveBps: BigInt(5000), discountedBps: BigInt(100), minVeMezoPower: BigInt(1),
  treasury: `0x${"ab".repeat(20)}`, deployer: `0x${"cd".repeat(20)}`,
};

test("accepte la configuration par défaut et l'absence de frais", () => {
  assert.deepEqual(feeConfigErrors(OK), []);
  assert.deepEqual(feeConfigErrors({ ...OK, feeBps: BigInt(0), treasury: null }), []);
});

test("refuse chaque paramètre hors bornes avant toute transaction", () => {
  assert.equal(feeConfigErrors({ ...OK, feeBps: BigInt(1001) }).length, 1);
  assert.match(feeConfigErrors({ ...OK, incentiveBps: BigInt(10001) })[0], /INCENTIVE/);
  assert.match(feeConfigErrors({ ...OK, discountedBps: BigInt(200) })[0], /DISCOUNT/);
  assert.match(feeConfigErrors({ ...OK, minVeMezoPower: BigInt(0) })[0], /MIN_VEMEZO/);
  assert.match(feeConfigErrors({ ...OK, treasury: `0x${"0".repeat(40)}` })[0], /TREASURY/);
  assert.match(feeConfigErrors({ ...OK, treasury: null })[0], /TREASURY/);
});
