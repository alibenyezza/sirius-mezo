import { AppError } from "@/lib/app-error";
import type { EvmNetwork } from "@/lib/evm/networks";
import type { EvmTransactionRequest } from "@/lib/evm/transaction";
import {
  approveMusdTransaction,
  claimSavingsYieldTransaction,
  depositSavingsTransaction,
  provideToStabilityPoolTransaction,
  withdrawFromStabilityPoolTransaction,
  withdrawSavingsTransaction,
} from "./earn-transactions";
import { musdProtocol } from "./protocol";

/**
 * Traduction pure d'une action « earn » en suite de transactions à signer par le wallet :
 * une approbation MUSD d'abord quand l'allowance du lieu ne couvre pas le dépôt, puis
 * l'action elle-même. Module sans réseau, testé seul.
 */

export const EARN_ACTIONS = ["provide", "withdraw-sp", "deposit-savings", "withdraw-savings", "claim-yield"] as const;
export type EarnAction = (typeof EARN_ACTIONS)[number];

export interface EarnActionRequest {
  action: EarnAction;
  amount: bigint;
}

export interface EarnStep {
  label: "approve" | EarnAction;
  transaction: EvmTransactionRequest;
}

const MAX_DIGITS = 36;

export function parseEarnAction(action: string | null, amount: string | null): EarnActionRequest | null {
  if (action === null || action === "") return null;
  if (!(EARN_ACTIONS as readonly string[]).includes(action)) throw new AppError("Action earn inconnue", 400);
  const needsAmount = action !== "claim-yield";
  if (!needsAmount) return { action: action as EarnAction, amount: BigInt(0) };
  if (!amount || !/^\d+$/.test(amount) || amount.length > MAX_DIGITS) throw new AppError("Montant invalide : entier atomique attendu", 400);
  const value = BigInt(amount);
  if (value <= BigInt(0)) throw new AppError("Montant nul", 400);
  return { action: action as EarnAction, amount: value };
}

export function earnActionTransactions(
  request: EarnActionRequest,
  position: { musdBalance: string; allowances: { stabilityPool: string; savingsVault: string } },
  network: EvmNetwork,
): EarnStep[] {
  const { action, amount } = request;
  const venues = musdProtocol(network);
  switch (action) {
    case "provide": {
      if (BigInt(position.musdBalance) < amount) throw new AppError("Solde MUSD insuffisant", 409);
      const steps: EarnStep[] = [];
      if (BigInt(position.allowances.stabilityPool) < amount) steps.push({ label: "approve", transaction: approveMusdTransaction(venues.stabilityPool, amount) });
      steps.push({ label: action, transaction: provideToStabilityPoolTransaction(amount, network) });
      return steps;
    }
    case "withdraw-sp":
      return [{ label: action, transaction: withdrawFromStabilityPoolTransaction(amount, network) }];
    case "deposit-savings": {
      if (BigInt(position.musdBalance) < amount) throw new AppError("Solde MUSD insuffisant", 409);
      const steps: EarnStep[] = [];
      if (BigInt(position.allowances.savingsVault) < amount) steps.push({ label: "approve", transaction: approveMusdTransaction(venues.savingsVault, amount) });
      steps.push({ label: action, transaction: depositSavingsTransaction(amount, network) });
      return steps;
    }
    case "withdraw-savings":
      return [{ label: action, transaction: withdrawSavingsTransaction(amount, network) }];
    case "claim-yield":
      return [{ label: action, transaction: claimSavingsYieldTransaction(network) }];
  }
}
