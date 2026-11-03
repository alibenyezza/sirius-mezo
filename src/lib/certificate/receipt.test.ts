import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMessageAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { receiptMessage, RECEIPT_SIGNATURE } from "../tee/receipt-message";
import { presentVerification, SIGNED_HEADLINE } from "./presentation";

const HASH = "ab".repeat(32);
const ESCROW = "0x00000000000000000000000000000000000000e5";

test("le reçu signe les 32 octets bruts du hash attesté, et le signataire se retrouve", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const signature = await account.signMessage({ message: receiptMessage(HASH) });
  assert.match(signature, RECEIPT_SIGNATURE);
  assert.equal(await recoverMessageAddress({ message: receiptMessage(HASH.toUpperCase()), signature }), account.address);
  // Un autre hash ne rend pas le même signataire.
  assert.notEqual(await recoverMessageAddress({ message: receiptMessage("cd".repeat(32)), signature }), account.address);
});

test("un hash qui n'est pas un SHA-256 hexadécimal est refusé", () => {
  assert.throws(() => receiptMessage("1234"));
  assert.throws(() => receiptMessage(`0x${HASH}`));
});

test("signataire égal au lockAuthorizer : verdict signé, sans rien prétendre de matériel", () => {
  const presentation = presentVerification({
    status: "receipt",
    receipt: { signer: "0x2d017fb59077456E87C6f0E719dd75B03a910c8a", lockAuthorizer: "0x2d017fb59077456E87C6f0E719dd75B03a910c8a", escrow: ESCROW, matches: true },
  });
  assert.equal(presentation.verdict, "signed");
  assert.equal(presentation.headline, SIGNED_HEADLINE);
  const enclave = presentation.checks.find((check) => check.label === "Hardware enclave");
  assert.equal(enclave?.state, "unknown");
  const text = JSON.stringify(presentation);
  assert.doesNotMatch(text, /Phala|Intel TDX enclave|production/);
});

test("autre signataire : échec ; escrow illisible : incomplet, jamais vérifié", () => {
  const wrong = presentVerification({
    status: "receipt",
    receipt: { signer: "0x0000000000000000000000000000000000000001", lockAuthorizer: "0x0000000000000000000000000000000000000002", escrow: ESCROW, matches: false },
  });
  assert.equal(wrong.verdict, "failed");
  const unread = presentVerification({
    status: "receipt",
    receipt: { signer: "0x0000000000000000000000000000000000000001", lockAuthorizer: null, escrow: ESCROW, matches: null },
  });
  assert.equal(unread.verdict, "incomplete");
});
