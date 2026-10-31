import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData } from "viem";
import { AppError } from "@/lib/app-error";
import { erc20Abi } from "@/lib/evm/abi/erc20";
import { earnActionTransactions, parseEarnAction } from "./earn-actions";
import { stabilityPoolAbi } from "./earn-abi";
import { musdProtocol } from "./protocol";

process.env.SIRIUS_USDC_ADDRESS ??= "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";

const position = { musdBalance: "5000000000000000000", allowances: { stabilityPool: "0", savingsVault: "9000000000000000000" } };

test("l'action est validée et le montant exigé sauf pour la réclamation du rendement", () => {
  assert.equal(parseEarnAction(null, null), null);
  assert.deepEqual(parseEarnAction("claim-yield", null), { action: "claim-yield", amount: BigInt(0) });
  assert.deepEqual(parseEarnAction("provide", "10"), { action: "provide", amount: BigInt(10) });
  for (const [action, amount] of [["stake", "1"], ["provide", "0"], ["provide", "x"], ["provide", null]] as const) {
    assert.throws(() => parseEarnAction(action, amount), (error: unknown) => error instanceof AppError && error.status === 400);
  }
});

test("une approbation précède le dépôt seulement quand l'allowance ne couvre pas le montant", () => {
  const provide = earnActionTransactions({ action: "provide", amount: BigInt(1_000) }, position, "testnet");
  assert.deepEqual(provide.map((s) => s.label), ["approve", "provide"]);
  const approve = decodeFunctionData({ abi: erc20Abi, data: provide[0].transaction.data });
  assert.equal(approve.functionName, "approve");
  assert.equal(approve.args[0], musdProtocol("testnet").stabilityPool);
  assert.equal(provide[1].transaction.to, musdProtocol("testnet").stabilityPool);
  assert.equal(decodeFunctionData({ abi: stabilityPoolAbi, data: provide[1].transaction.data }).functionName, "provideToSP");

  const savings = earnActionTransactions({ action: "deposit-savings", amount: BigInt(1_000) }, position, "testnet");
  assert.deepEqual(savings.map((s) => s.label), ["deposit-savings"]);
  assert.equal(savings[0].transaction.to, musdProtocol("testnet").savingsVault);
});

test("un dépôt supérieur au solde est refusé avant toute signature", () => {
  assert.throws(
    () => earnActionTransactions({ action: "provide", amount: BigInt("6000000000000000000") }, position, "testnet"),
    (error: unknown) => error instanceof AppError && error.status === 409,
  );
  assert.equal(earnActionTransactions({ action: "withdraw-sp", amount: BigInt(1) }, position, "testnet").length, 1);
  assert.equal(earnActionTransactions({ action: "claim-yield", amount: BigInt(0) }, position, "testnet")[0].label, "claim-yield");
});
