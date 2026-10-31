import "server-only";
import { formatUnits, getAddress, type Address } from "viem";
import { erc20Abi } from "@/lib/evm/abi/erc20";
import { usdcAddress } from "@/lib/evm/addresses";
import { getPublicClient } from "@/lib/evm/client";
import type { EvmNetwork } from "@/lib/evm/networks";
import { savingsVaultAbi, stabilityPoolAbi } from "./earn-abi";
import { musdProtocol } from "./protocol";

/**
 * Lecture serveur, seule, de la position d'un compte sur les deux lieux de rendement MUSD :
 * pool de stabilité (dépôt composé, gain de collatéral en BTC natif) et coffre sMUSD (parts 1:1,
 * rendement réclamable). Aucune transaction n'est envoyée ici.
 *
 * Chaque lieu est lu dans son propre try/catch : une panne d'un contrat (RPC, proxy redéployé,
 * ABI décalé) ne vide pas l'autre, elle le marque `available: false`.
 *
 * Les bigints sont rendus en chaînes décimales (sérialisables) et en variante `formatted`
 * (18 décimales, 4 chiffres après la virgule au plus, zéros de fin retirés).
 */

/** Décimales de MUSD et de sMUSD ; le gain de collatéral est en BTC natif, 18 décimales aussi. */
const DECIMALS = 18;

export interface StabilityPoolPosition {
  available: true;
  /** Dépôt MUSD composé (net des liquidations absorbées). */
  deposit: string;
  /** Gain de collatéral en BTC natif, réclamable par `withdrawFromSP(0)`. */
  collateralGain: string;
  totalDeposits: string;
}

export interface SavingsPosition {
  available: true;
  /** Parts sMUSD, émises 1:1 contre le MUSD déposé. */
  shares: string;
  claimableYield: string;
  totalSupply: string;
}

export type Unavailable = { available: false; reason: string };

export interface EarnPosition {
  account: Address;
  network: EvmNetwork;
  musdBalance: string;
  allowances: { stabilityPool: string; savingsVault: string };
  stabilityPool: StabilityPoolPosition | Unavailable;
  savings: SavingsPosition | Unavailable;
  formatted: {
    musdBalance: string;
    allowances: { stabilityPool: string; savingsVault: string };
    stabilityPool: { deposit: string; collateralGain: string; totalDeposits: string } | null;
    savings: { shares: string; claimableYield: string; totalSupply: string } | null;
  };
}

/** `formatUnits` tronqué à 4 décimales, zéros de fin et point final retirés. */
export function formatEarnAmount(atomic: bigint | string, decimals = DECIMALS): string {
  const value = formatUnits(typeof atomic === "bigint" ? atomic : BigInt(atomic), decimals);
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, 4).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}

async function readStabilityPool(address: Address, owner: Address): Promise<StabilityPoolPosition | Unavailable> {
  const client = getPublicClient();
  try {
    const [deposit, collateralGain, totalDeposits] = await Promise.all([
      client.readContract({ address, abi: stabilityPoolAbi, functionName: "getCompoundedMUSDDeposit", args: [owner] }),
      client.readContract({ address, abi: stabilityPoolAbi, functionName: "getDepositorCollateralGain", args: [owner] }),
      client.readContract({ address, abi: stabilityPoolAbi, functionName: "getTotalMUSDDeposits" }),
    ]);
    return { available: true, deposit: deposit.toString(), collateralGain: collateralGain.toString(), totalDeposits: totalDeposits.toString() };
  } catch (error) {
    return { available: false, reason: reason(error) };
  }
}

async function readSavings(address: Address, owner: Address): Promise<SavingsPosition | Unavailable> {
  const client = getPublicClient();
  try {
    const [shares, claimableYield, totalSupply] = await Promise.all([
      client.readContract({ address, abi: savingsVaultAbi, functionName: "balanceOf", args: [owner] }),
      client.readContract({ address, abi: savingsVaultAbi, functionName: "claimableYield", args: [owner] }),
      client.readContract({ address, abi: savingsVaultAbi, functionName: "totalSupply" }),
    ]);
    return { available: true, shares: shares.toString(), claimableYield: claimableYield.toString(), totalSupply: totalSupply.toString() };
  } catch (error) {
    return { available: false, reason: reason(error) };
  }
}

export async function readEarnPosition(account: string, network: EvmNetwork): Promise<EarnPosition> {
  const client = getPublicClient();
  const owner = getAddress(account);
  const musd = usdcAddress();
  const { stabilityPool, savingsVault } = musdProtocol(network);

  // Jeton, puis les deux lieux : viem regroupe ces lectures parallèles en multicall.
  const [musdBalance, allowancePool, allowanceVault, pool, savings] = await Promise.all([
    client.readContract({ address: musd, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    client.readContract({ address: musd, abi: erc20Abi, functionName: "allowance", args: [owner, stabilityPool] }),
    client.readContract({ address: musd, abi: erc20Abi, functionName: "allowance", args: [owner, savingsVault] }),
    readStabilityPool(stabilityPool, owner),
    readSavings(savingsVault, owner),
  ]);

  return {
    account: owner,
    network,
    musdBalance: musdBalance.toString(),
    allowances: { stabilityPool: allowancePool.toString(), savingsVault: allowanceVault.toString() },
    stabilityPool: pool,
    savings,
    formatted: {
      musdBalance: formatEarnAmount(musdBalance),
      allowances: { stabilityPool: formatEarnAmount(allowancePool), savingsVault: formatEarnAmount(allowanceVault) },
      stabilityPool: pool.available
        ? { deposit: formatEarnAmount(pool.deposit), collateralGain: formatEarnAmount(pool.collateralGain), totalDeposits: formatEarnAmount(pool.totalDeposits) }
        : null,
      savings: savings.available
        ? { shares: formatEarnAmount(savings.shares), claimableYield: formatEarnAmount(savings.claimableYield), totalSupply: formatEarnAmount(savings.totalSupply) }
        : null,
    },
  };
}
