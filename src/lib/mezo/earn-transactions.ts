import { encodeFunctionData, getAddress, type Address } from "viem";
import { erc20Abi } from "@/lib/evm/abi/erc20";
import { usdcAddress } from "@/lib/evm/addresses";
import type { EvmNetwork } from "@/lib/evm/networks";
import type { EvmTransactionRequest } from "@/lib/evm/transaction";
import { savingsVaultAbi, stabilityPoolAbi } from "./earn-abi";
import { musdProtocol } from "./protocol";

/**
 * Constructeurs de calldata pour les deux lieux de rendement MUSD (pool de stabilité et coffre
 * sMUSD). Fonctions pures, sans client ni portefeuille : elles rendent `{ to, data }` comme
 * `src/lib/evm/transaction.ts`, à signer et envoyer ailleurs.
 *
 * Les montants sont en unités atomiques (MUSD : 18 décimales), reçus en chaîne décimale ou en
 * bigint. Le jeton de règlement est lu par `usdcAddress()` (nom historique : MUSD sur Mezo).
 *
 * Piège testnet : `withdrawFromSP(montant > 0)` revert tant qu'un trove est sous le MCR ;
 * `withdrawFromSP(0)` reste accepté et ne fait que réclamer les gains.
 */

type Amount = string | bigint;

function atomic(amount: Amount): bigint {
  return typeof amount === "bigint" ? amount : BigInt(amount);
}

/** Approbation MUSD vers un dépensier arbitraire (pool de stabilité ou coffre). */
export function approveMusdTransaction(spender: Address, amount: Amount): EvmTransactionRequest {
  return {
    to: usdcAddress(),
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [getAddress(spender), atomic(amount)] }),
  };
}

export function provideToStabilityPoolTransaction(amount: Amount, network: EvmNetwork): EvmTransactionRequest {
  return {
    to: musdProtocol(network).stabilityPool,
    data: encodeFunctionData({ abi: stabilityPoolAbi, functionName: "provideToSP", args: [atomic(amount)] }),
  };
}

export function withdrawFromStabilityPoolTransaction(amount: Amount, network: EvmNetwork): EvmTransactionRequest {
  return {
    to: musdProtocol(network).stabilityPool,
    data: encodeFunctionData({ abi: stabilityPoolAbi, functionName: "withdrawFromSP", args: [atomic(amount)] }),
  };
}

export function depositSavingsTransaction(amount: Amount, network: EvmNetwork): EvmTransactionRequest {
  return {
    to: musdProtocol(network).savingsVault,
    data: encodeFunctionData({ abi: savingsVaultAbi, functionName: "deposit", args: [atomic(amount)] }),
  };
}

export function withdrawSavingsTransaction(amount: Amount, network: EvmNetwork): EvmTransactionRequest {
  return {
    to: musdProtocol(network).savingsVault,
    data: encodeFunctionData({ abi: savingsVaultAbi, functionName: "withdraw", args: [atomic(amount)] }),
  };
}

export function claimSavingsYieldTransaction(network: EvmNetwork): EvmTransactionRequest {
  return {
    to: musdProtocol(network).savingsVault,
    data: encodeFunctionData({ abi: savingsVaultAbi, functionName: "claimYield", args: [] }),
  };
}
