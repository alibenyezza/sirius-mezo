import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, getAddress } from "viem";
import { erc20Abi } from "@/lib/evm/abi/erc20";
import { savingsVaultAbi, stabilityPoolAbi } from "./earn-abi";
import {
  approveMusdTransaction,
  claimSavingsYieldTransaction,
  depositSavingsTransaction,
  provideToStabilityPoolTransaction,
  withdrawFromStabilityPoolTransaction,
  withdrawSavingsTransaction,
} from "./earn-transactions";
import { musdProtocol } from "./protocol";

// Adresse MUSD testnet, celle que l'application lit par `usdcAddress()`.
const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
process.env.SIRIUS_USDC_ADDRESS = MUSD;

const AMOUNT = "1500000000000000000"; // 1,5 MUSD
const testnet = musdProtocol("testnet");
const mainnet = musdProtocol("mainnet");

test("l'approbation MUSD vise le jeton de règlement et le dépensier demandé, en casse canonique", () => {
  const spender = testnet.stabilityPool.toLowerCase() as `0x${string}`;
  const tx = approveMusdTransaction(spender, AMOUNT);
  assert.equal(tx.to, getAddress(MUSD));
  const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
  assert.equal(decoded.functionName, "approve");
  assert.deepEqual(decoded.args, [testnet.stabilityPool, BigInt(AMOUNT)]);

  // Un bigint est accepté tel quel.
  assert.equal(approveMusdTransaction(testnet.savingsVault, BigInt(AMOUNT)).data, approveMusdTransaction(testnet.savingsVault, AMOUNT).data);
});

test("pool de stabilité : dépôt et retrait encodés vers le proxy du réseau demandé", () => {
  const provide = provideToStabilityPoolTransaction(AMOUNT, "testnet");
  assert.equal(provide.to, testnet.stabilityPool);
  const provideDecoded = decodeFunctionData({ abi: stabilityPoolAbi, data: provide.data });
  assert.equal(provideDecoded.functionName, "provideToSP");
  assert.deepEqual(provideDecoded.args, [BigInt(AMOUNT)]);

  const withdraw = withdrawFromStabilityPoolTransaction("0", "mainnet");
  assert.equal(withdraw.to, mainnet.stabilityPool);
  assert.notEqual(withdraw.to, testnet.stabilityPool);
  const withdrawDecoded = decodeFunctionData({ abi: stabilityPoolAbi, data: withdraw.data });
  assert.equal(withdrawDecoded.functionName, "withdrawFromSP");
  assert.deepEqual(withdrawDecoded.args, [BigInt(0)]);
});

test("coffre sMUSD : dépôt, retrait et réclamation du rendement", () => {
  const deposit = depositSavingsTransaction(AMOUNT, "testnet");
  assert.equal(deposit.to, testnet.savingsVault);
  const depositDecoded = decodeFunctionData({ abi: savingsVaultAbi, data: deposit.data });
  assert.equal(depositDecoded.functionName, "deposit");
  assert.deepEqual(depositDecoded.args, [BigInt(AMOUNT)]);

  const withdraw = withdrawSavingsTransaction(AMOUNT, "mainnet");
  assert.equal(withdraw.to, mainnet.savingsVault);
  const withdrawDecoded = decodeFunctionData({ abi: savingsVaultAbi, data: withdraw.data });
  assert.equal(withdrawDecoded.functionName, "withdraw");
  assert.deepEqual(withdrawDecoded.args, [BigInt(AMOUNT)]);

  const claim = claimSavingsYieldTransaction("testnet");
  assert.equal(claim.to, testnet.savingsVault);
  const claimDecoded = decodeFunctionData({ abi: savingsVaultAbi, data: claim.data });
  assert.equal(claimDecoded.functionName, "claimYield");
  assert.equal(claimDecoded.args, undefined);
  // Sélecteur de `claimYield()` seul, sans argument.
  assert.equal(claim.data.length, 10);
});

test("un montant non numérique est refusé avant tout encodage", () => {
  assert.throws(() => depositSavingsTransaction("1.5", "testnet"), SyntaxError);
  assert.throws(() => provideToStabilityPoolTransaction("abc", "testnet"), SyntaxError);
});
