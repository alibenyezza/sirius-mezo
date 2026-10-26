import assert from "node:assert/strict";
import { test } from "node:test";
import { superviseSession } from "./phala-watchdog.mjs";

const session = { version: 1, appId: "12".repeat(20), cvmId: "cvm-test", profile: "sirius", startedAt: 1000, stopAt: 10000 };
test("le superviseur ne démarre rien et exige une activation explicite pour arrêter", () => {
  let stops = 0;
  const operations = { get: () => ({ app_id: session.appId, status: "running" }), stop: () => { stops++; } };
  assert.equal(superviseSession(session, operations, true, 9999).stopRequired, false);
  assert.equal(superviseSession(session, operations, false, 10000).stopRequired, true);
  assert.equal(stops, 0);
  assert.equal(superviseSession(session, operations, true, 10000).stopRequested, true);
  assert.equal(stops, 1);
  assert.equal(superviseSession(session, { ...operations, get: () => ({ app_id: session.appId, status: "stopped" }) }, true, 11000).stopRequired, false);
  assert.equal(stops, 1);
});
test("une reprise conserve l’échéance initiale et refuse une autre CVM", () => {
  assert.throws(() => superviseSession(session, { get: () => ({ app_id: "34".repeat(20), status: "running" }), stop: () => assert.fail() }, true, 11000));
  assert.equal(superviseSession(session, { get: () => ({ app_id: session.appId, status: "running" }), stop: () => {} }, false, 20000).deadline, session.stopAt);
});
