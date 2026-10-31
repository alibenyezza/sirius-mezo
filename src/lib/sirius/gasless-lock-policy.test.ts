import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "@/lib/app-error";
import { parseLockRelayBody, serializeLockRequest } from "./gasless-lock-policy";

const request = {
  borrower: `0x${"11".repeat(20)}`,
  provider: `0x${"22".repeat(20)}`,
  amount: BigInt("2000000000000000000"),
  hashlock: `0x${"33".repeat(32)}` as const,
  challengeDays: 7,
  loanIdHash: `0x${"44".repeat(32)}` as const,
  datasetId: `0x${"55".repeat(32)}` as const,
  trainingProfile: `0x${"66".repeat(32)}` as const,
  nonce: BigInt(3),
  deadline: BigInt(1_800_000_000),
};
const signature = `0x${"ab".repeat(65)}` as const;

test("la demande de lock fait l'aller-retour JSON sans perdre les entiers", () => {
  const wire = serializeLockRequest(request);
  assert.equal(wire.amount, "2000000000000000000");
  assert.equal(wire.nonce, "3");
  const parsed = parseLockRelayBody({ request: wire, borrowerSignature: signature, permitSignature: signature });
  assert.deepEqual(parsed.request, request);
  assert.equal(parsed.borrowerSignature, signature);
  assert.equal(parsed.permitSignature, signature);
});

test("le permit est facultatif, tout le reste est obligatoire et typé", () => {
  const wire = serializeLockRequest(request);
  assert.equal(parseLockRelayBody({ request: wire, borrowerSignature: signature }).permitSignature, undefined);
  for (const broken of [
    { request: { ...wire, amount: "1e18" }, borrowerSignature: signature },
    { request: { ...wire, challengeDays: 31 }, borrowerSignature: signature },
    { request: { ...wire, borrower: "0x1234" }, borrowerSignature: signature },
    { request: wire, borrowerSignature: "0x1234" },
    { request: wire },
    null,
    "texte",
  ]) {
    assert.throws(() => parseLockRelayBody(broken), (error: unknown) => error instanceof AppError && error.status === 400);
  }
});
