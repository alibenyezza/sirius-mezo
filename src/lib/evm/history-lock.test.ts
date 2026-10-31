import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData } from "viem";
import { AppError } from "@/lib/app-error";
import { siriusescrowAbi } from "./abi/siriusescrow";
import { loanIdHash } from "./loan-key";
import { assertLoanLockTransaction } from "./history";

process.env.SIRIUS_ESCROW_ADDRESS ??= `0x${"ee".repeat(20)}`;

const escrow = `0x${"ee".repeat(20)}`;
const borrower = `0x${"11".repeat(20)}` as const;
const relayer = `0x${"99".repeat(20)}` as const;
const provider = `0x${"22".repeat(20)}` as const;
const bytes = (fill: string) => `0x${fill.repeat(32)}` as const;
const authorization = { deadline: 1_800_000_000, signature: `0x${"ab".repeat(65)}` as const };

function relayedLock(loanId: string, signer: `0x${string}`) {
  return encodeFunctionData({
    abi: siriusescrowAbi,
    functionName: "lockWithSignature",
    args: [
      {
        borrower: signer, provider, amount: BigInt(100), hashlock: bytes("33"), challengeDays: 7,
        loanIdHash: loanIdHash(loanId), datasetId: bytes("55"), trainingProfile: bytes("66"),
        nonce: BigInt(0), deadline: BigInt(1_800_000_000),
      },
      `0x${"cd".repeat(65)}`,
      { value: BigInt(0), deadline: BigInt(0), v: 0, r: bytes("00"), s: bytes("00") },
      authorization,
    ],
  });
}

test("un lock relayé est accepté quand la demande signée porte l'emprunteur et le prêt", () => {
  assert.doesNotThrow(() => assertLoanLockTransaction(
    { from: relayer, to: escrow, input: relayedLock("loan-1", borrower) },
    { loanId: "loan-1", borrower, escrow },
  ));
});

test("un lock relayé pour un autre emprunteur ou un autre prêt est refusé", () => {
  assert.throws(() => assertLoanLockTransaction(
    { from: relayer, to: escrow, input: relayedLock("loan-1", relayer) },
    { loanId: "loan-1", borrower, escrow },
  ), (error: unknown) => error instanceof AppError && error.status === 409);
  assert.throws(() => assertLoanLockTransaction(
    { from: relayer, to: escrow, input: relayedLock("loan-2", borrower) },
    { loanId: "loan-1", borrower, escrow },
  ), (error: unknown) => error instanceof AppError && error.status === 409);
});

test("un lock direct exige toujours que l'expéditeur soit l'emprunteur", () => {
  const direct = encodeFunctionData({
    abi: siriusescrowAbi,
    functionName: "lock",
    args: [provider, BigInt(100), bytes("33"), 7, loanIdHash("loan-1"), bytes("55"), bytes("66"), authorization],
  });
  assert.doesNotThrow(() => assertLoanLockTransaction({ from: borrower, to: escrow, input: direct }, { loanId: "loan-1", borrower, escrow }));
  assert.throws(() => assertLoanLockTransaction({ from: relayer, to: escrow, input: direct }, { loanId: "loan-1", borrower, escrow }),
    (error: unknown) => error instanceof AppError && error.status === 409);
});
