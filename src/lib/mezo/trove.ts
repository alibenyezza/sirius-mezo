import "server-only";
import { erc20Abi, getAddress, parseAbi, type Address } from "viem";
import { getPublicClient } from "@/lib/evm/client";
import { ZERO_ADDRESS } from "@/lib/evm/address";
import { resolveServerNetwork, type EvmNetwork } from "@/lib/evm/networks";
import { MAINNET_STABLECOIN_ADDRESS, TESTNET_STABLECOIN_ADDRESS } from "@/lib/evm/stablecoin";
import {
  borrowerOperationsAbi,
  borrowerOperationsSignaturesAbi,
  hintHelpersAbi,
  priceFeedAbi,
  sortedTrovesAbi,
  troveManagerAbi,
} from "./abi";
import { MUSD_BORROWING_RATE_BPS, MUSD_CCR, MUSD_MCR, musdProtocol } from "./protocol";
import { drawQuote, nominalIcr, type DrawQuote } from "./trove-math";

/**
 * Lectures on-chain du trove MUSD d'un compte. Aucune écriture ici : le tirage de
 * MUSD se fait par signature EIP-712 (`./draw-typed-data.ts`) relayée ailleurs.
 *
 * Les montants sont rendus en chaînes décimales (1e18) : `JSON.stringify` ne sait pas
 * sérialiser un bigint, et une route les renvoie tels quels au navigateur.
 */

/** `ITroveManager.Status`, dans l'ordre de l'enum Solidity. */
export const TROVE_STATUS = ["nonExistent", "active", "closedByOwner", "closedByLiquidation", "closedByRedemption"] as const;
export type TroveStatus = (typeof TROVE_STATUS)[number];

/** Marge appliquée au-dessus du MCR avant d'autoriser un tirage : 10 % (ratio ≥ 1,21). */
export const DRAW_SAFETY_MARGIN_BPS = 1_000;

const MUSD_TOKEN: Record<EvmNetwork, Address> = {
  mainnet: getAddress(MAINNET_STABLECOIN_ADDRESS),
  testnet: getAddress(TESTNET_STABLECOIN_ADDRESS),
};

export interface TrovePosition {
  hasTrove: boolean;
  status: TroveStatus;
  /** Collatéral BTC du trove, 1e18. */
  coll: string;
  /** Dette totale (principal + intérêts courus + redistributions), 1e18. */
  debt: string;
  /** Prix BTC/USD de l'oracle, 1e18. */
  price: string;
  /** Ratio de collatéralisation courant (1e18) ; « 0 » sans trove actif. */
  icr: string;
  /** Solde MUSD du compte, 1e18. */
  musdBalance: string;
  /** Nonce EIP-712 de `BorrowerOperationsSignatures` pour ce compte. */
  nonce: string;
}

function currentNetwork(network?: EvmNetwork): EvmNetwork {
  return network ?? resolveServerNetwork().network;
}

export async function readTrovePosition(account: Address, network?: EvmNetwork): Promise<TrovePosition> {
  const net = currentNetwork(network);
  const client = getPublicClient();
  const protocol = musdProtocol(net);
  const borrower = getAddress(account);

  const [price, rawStatus, entire, musdBalance, nonce] = await Promise.all([
    client.readContract({ address: protocol.priceFeed, abi: priceFeedAbi, functionName: "fetchPrice" }),
    client.readContract({ address: protocol.troveManager, abi: troveManagerAbi, functionName: "getTroveStatus", args: [borrower] }),
    client.readContract({ address: protocol.troveManager, abi: troveManagerAbi, functionName: "getEntireDebtAndColl", args: [borrower] }),
    client.readContract({ address: MUSD_TOKEN[net], abi: erc20Abi, functionName: "balanceOf", args: [borrower] }),
    client.readContract({ address: protocol.borrowerOperationsSignatures, abi: borrowerOperationsSignaturesAbi, functionName: "getNonce", args: [borrower] }),
  ]);

  const status: TroveStatus = TROVE_STATUS[rawStatus] ?? "nonExistent";
  const hasTrove = status === "active";
  const [coll, principal, interest, pendingCollateral, pendingPrincipal, pendingInterest] = entire;
  const totalColl = coll + pendingCollateral;
  const totalDebt = principal + interest + pendingPrincipal + pendingInterest;

  const icr = hasTrove
    ? await client.readContract({ address: protocol.troveManager, abi: troveManagerAbi, functionName: "getCurrentICR", args: [borrower, price] })
    : BigInt(0);

  return {
    hasTrove,
    status,
    coll: totalColl.toString(),
    debt: totalDebt.toString(),
    price: price.toString(),
    icr: icr.toString(),
    musdBalance: musdBalance.toString(),
    nonce: nonce.toString(),
  };
}

const systemAbi = parseAbi([
  "function checkRecoveryMode(uint256 price) view returns (bool)",
  "function getTroveMaxBorrowingCapacity(address borrower) view returns (uint256)",
  "function fetchPrice() view returns (uint256)",
]);

/**
 * État du système MUSD qui conditionne un tirage : Recovery Mode (au prix courant) et plafond
 * de dette du trove. Illisible : rien n'est supposé, le contrat tranchera.
 */
async function readSystemState(account: Address, net: EvmNetwork): Promise<{ recoveryMode?: boolean; ccr?: bigint; maxBorrowingCapacity?: bigint }> {
  const protocol = musdProtocol(net);
  const client = getPublicClient();
  try {
    const price = await client.readContract({ address: protocol.priceFeed, abi: systemAbi, functionName: "fetchPrice" });
    const [recoveryMode, maxBorrowingCapacity] = await Promise.all([
      client.readContract({ address: protocol.troveManager, abi: systemAbi, functionName: "checkRecoveryMode", args: [price] }),
      client.readContract({ address: protocol.troveManager, abi: systemAbi, functionName: "getTroveMaxBorrowingCapacity", args: [getAddress(account)] }),
    ]);
    return { recoveryMode, ccr: MUSD_CCR, maxBorrowingCapacity };
  } catch {
    return {};
  }
}

export interface InsertHints {
  upperHint: Address;
  lowerHint: Address;
}

/**
 * Hints d'insertion dans SortedTroves pour la dette et le collatéral *après* tirage.
 * Des hints faux ne bloquent pas la transaction : le contrat parcourt la liste depuis
 * le hint, ce qui coûte seulement plus de gas. D'où le repli sur l'adresse zéro.
 */
export async function computeInsertHints(newDebt: bigint, coll: bigint, network?: EvmNetwork): Promise<InsertHints> {
  const zero: InsertHints = { upperHint: ZERO_ADDRESS, lowerHint: ZERO_ADDRESS };
  try {
    const protocol = musdProtocol(currentNetwork(network));
    const client = getPublicClient();
    const nicr = nominalIcr(coll, newDebt);
    const numTrials = BigInt(15);
    // Graine déterministe : le parcours est pseudo-aléatoire, pas secret.
    const seed = BigInt(Date.now() % 1_000_000) + BigInt(1);
    const [hint] = await client.readContract({
      address: protocol.hintHelpers,
      abi: hintHelpersAbi,
      functionName: "getApproxHint",
      args: [nicr, numTrials, seed],
    });
    const [upperHint, lowerHint] = await client.readContract({
      address: protocol.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: "findInsertPosition",
      args: [nicr, hint, hint],
    });
    return { upperHint, lowerHint };
  } catch {
    return zero;
  }
}

export interface DrawQuoteView {
  amount: string;
  fee: string;
  newDebt: string;
  newIcr: string;
  threshold: string;
  allowed: boolean;
  reason: string | null;
}

export interface TroveDrawQuote {
  position: TrovePosition;
  quote: DrawQuoteView;
  hints: InsertHints;
}

function serializeQuote(amount: bigint, quote: DrawQuote): DrawQuoteView {
  return {
    amount: amount.toString(),
    fee: quote.fee.toString(),
    newDebt: quote.newDebt.toString(),
    newIcr: quote.newIcr.toString(),
    threshold: quote.threshold.toString(),
    allowed: quote.allowed,
    reason: quote.reason,
  };
}

/**
 * Position + devis d'un tirage de `amount` MUSD. Les frais viennent du contrat
 * (`getBorrowingFee`), pas du taux constant : si Mezo le change, le devis suit.
 */
export async function readDrawQuote(account: Address, amount: bigint, network?: EvmNetwork): Promise<TroveDrawQuote> {
  if (amount < BigInt(0)) throw new RangeError("amount must be non-negative");
  const net = currentNetwork(network);
  const client = getPublicClient();
  const protocol = musdProtocol(net);

  const [position, liveFee, systemState] = await Promise.all([
    readTrovePosition(account, net),
    client.readContract({ address: protocol.borrowerOperations, abi: borrowerOperationsAbi, functionName: "getBorrowingFee", args: [amount] }),
    readSystemState(account, net),
  ]);

  const coll = BigInt(position.coll);
  const debt = BigInt(position.debt);
  const price = BigInt(position.price);
  const quote = drawQuote({
    coll,
    debt,
    price,
    amount,
    feeRateBps: MUSD_BORROWING_RATE_BPS,
    fee: liveFee,
    mcr: MUSD_MCR,
    safetyMarginBps: DRAW_SAFETY_MARGIN_BPS,
    ...systemState,
  });

  const hints = quote.allowed ? await computeInsertHints(quote.newDebt, coll, net) : { upperHint: ZERO_ADDRESS, lowerHint: ZERO_ADDRESS };
  return { position, quote: serializeQuote(amount, quote), hints };
}
