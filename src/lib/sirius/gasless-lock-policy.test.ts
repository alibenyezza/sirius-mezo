import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "@/lib/app-error";
import { lockRequestTypedData } from "@/lib/evm/lock-request";
import { parseLockRelayBody, serializeLockRequest, typedDataForWallet } from "./gasless-lock-policy";

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

test("charges à signer : sérialisables en JSON, entiers en chaînes décimales pour le wallet", () => {
  const typed = typedDataForWallet(lockRequestTypedData({ chainId: 31611, escrow: `0x${"77".repeat(20)}`, request }));
  const wire = JSON.parse(JSON.stringify(typed)) as { message: Record<string, unknown>; domain: { chainId: unknown } };
  assert.equal(wire.message.amount, "2000000000000000000");
  assert.equal(wire.message.nonce, "3");
  assert.equal(wire.message.challengeDays, 7);
  assert.equal(wire.domain.chainId, 31611);
});
