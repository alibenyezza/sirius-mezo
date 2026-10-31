import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "@/lib/app-error";
import { DRAW_MAX_TTL_SECONDS, parseDrawRelayBody, validateDrawTiming } from "./draw-relay-policy";

const signature = `0x${"ab".repeat(65)}`;

test("le corps d'un tirage est typé et le montant strictement positif", () => {
  const parsed = parseDrawRelayBody({ amount: "10000000000000000000", nonce: "0", deadline: "1800000000", signature });
  assert.equal(parsed.amount, BigInt("10000000000000000000"));
  assert.equal(parsed.nonce, BigInt(0));
  assert.equal(parsed.signature, signature);
  for (const broken of [
    { amount: "0", nonce: "0", deadline: "1", signature },
    { amount: "1.5", nonce: "0", deadline: "1", signature },
    { amount: "1", nonce: "0", deadline: "1", signature: "0x12" },
    { amount: "1", nonce: "0", signature },
    null,
  ]) {
    assert.throws(() => parseDrawRelayBody(broken), (error: unknown) => error instanceof AppError && error.status === 400);
  }
});

test("l'échéance doit être future et bornée", () => {
  const now = 1_700_000_000;
  assert.doesNotThrow(() => validateDrawTiming(BigInt(now + 60), now));
  assert.throws(() => validateDrawTiming(BigInt(now), now), (error: unknown) => error instanceof AppError && error.status === 409);
  assert.throws(() => validateDrawTiming(BigInt(now + DRAW_MAX_TTL_SECONDS + 1), now), (error: unknown) => error instanceof AppError && error.status === 400);
});
