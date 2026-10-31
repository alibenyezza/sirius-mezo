import assert from "node:assert/strict";
import { test } from "node:test";
import { mezoFeatures } from "./features";

test("chaque intégration Mezo est coupée par défaut et ne s'active que sur « true »", () => {
  assert.deepEqual(mezoFeatures({}), { gaslessLock: false, borrowAndBuy: false, earn: false });
  assert.deepEqual(
    mezoFeatures({ SIRIUS_GASLESS_LOCK: " true ", SIRIUS_BORROW_AND_BUY: "yes", SIRIUS_MEZO_EARN: "true" }),
    { gaslessLock: true, borrowAndBuy: false, earn: true },
  );
});
