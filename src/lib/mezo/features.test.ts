import assert from "node:assert/strict";
import { test } from "node:test";
import { mezoFeatures } from "./features";

test("chaque intégration Mezo est coupée par défaut et ne s'active que sur « true »", () => {
  assert.deepEqual(mezoFeatures({}), { gaslessLock: false, borrowAndBuy: false, earn: false, payWithBtc: false });
  assert.deepEqual(
    mezoFeatures({ SIRIUS_GASLESS_LOCK: " true ", SIRIUS_BORROW_AND_BUY: "yes", SIRIUS_MEZO_EARN: "true" }),
    { gaslessLock: true, borrowAndBuy: false, earn: true, payWithBtc: false },
  );
});

test("le paiement en BTC exige l'interrupteur et l'adresse du checkout", () => {
  const checkout = `0x${"ab".repeat(20)}`;
  assert.equal(mezoFeatures({ SIRIUS_PAY_WITH_BTC: "true" }).payWithBtc, false);
  assert.equal(mezoFeatures({ SIRIUS_CHECKOUT_ADDRESS: checkout }).payWithBtc, false);
  assert.equal(mezoFeatures({ SIRIUS_PAY_WITH_BTC: "true", SIRIUS_CHECKOUT_ADDRESS: checkout }).payWithBtc, true);
  assert.equal(mezoFeatures({ SIRIUS_PAY_WITH_BTC: "true", NEXT_PUBLIC_SIRIUS_CHECKOUT_ADDRESS: checkout }).payWithBtc, true);
});
