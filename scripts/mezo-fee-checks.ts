import { getAddress, parseAbi, type Address, type PublicClient } from "viem";
import { mezoGovernance } from "../src/lib/mezo/governance";

/**
 * Lectures seules des contrats Mezo dont dépendent les frais Sirius : le gauge BTC/MUSD est
 * vivant et pointe sur le bribe attendu, MUSD est whitelisté et déjà récompense de ce
 * bribe, le bribe a des votes, veMEZO et veBTC répondent. Partagé par `mezo-fee-check.ts`
 * et par le déploiement, qui refuse d'envoyer quoi que ce soit si une ligne échoue.
 */

export const MEZO_MUSD: Record<"testnet" | "mainnet", Address> = {
  testnet: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  mainnet: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186",
};

const voterAbi = parseAbi([
  "function ve() view returns (address)",
  "function gauges(address pool) view returns (address)",
  "function gaugeToBribe(address gauge) view returns (address)",
  "function isAlive(address gauge) view returns (bool)",
  "function isWhitelistedToken(address token) view returns (bool)",
]);
const bribeAbi = parseAbi(["function isReward(address token) view returns (bool)", "function totalSupply() view returns (uint256)"]);
const veAbi = parseAbi(["function name() view returns (string)", "function totalVotingPower() view returns (uint256)"]);

export type FeeCheck = { label: string; ok: boolean; detail: string };

export async function mezoFeeChecks(client: PublicClient, network: "testnet" | "mainnet"): Promise<FeeCheck[]> {
  const g = mezoGovernance(network);
  const musd = MEZO_MUSD[network];
  const same = (a: string, b: string) => getAddress(a) === getAddress(b);

  const [ve, gauge, alive, whitelisted, veMezoName, veBtcName, veMezoPower] = await Promise.all([
    client.readContract({ address: g.poolsVoter, abi: voterAbi, functionName: "ve" }),
    client.readContract({ address: g.poolsVoter, abi: voterAbi, functionName: "gauges", args: [g.btcMusdPool] }),
    client.readContract({ address: g.poolsVoter, abi: voterAbi, functionName: "isAlive", args: [g.btcMusdGauge] }),
    client.readContract({ address: g.poolsVoter, abi: voterAbi, functionName: "isWhitelistedToken", args: [musd] }),
    client.readContract({ address: g.veMezo, abi: veAbi, functionName: "name" }),
    client.readContract({ address: g.veBtc, abi: veAbi, functionName: "name" }),
    client.readContract({ address: g.veMezo, abi: veAbi, functionName: "totalVotingPower" }),
  ]);
  const bribe = await client.readContract({ address: g.poolsVoter, abi: voterAbi, functionName: "gaugeToBribe", args: [gauge] });
  const [isReward, votes] = await Promise.all([
    client.readContract({ address: bribe, abi: bribeAbi, functionName: "isReward", args: [musd] }),
    client.readContract({ address: bribe, abi: bribeAbi, functionName: "totalSupply" }),
  ]);

  return [
    { label: "PoolsVoter.ve() est veBTC", ok: same(ve, g.veBtc), detail: ve },
    { label: "gauge du pool BTC/MUSD", ok: same(gauge, g.btcMusdGauge), detail: gauge },
    { label: "gauge vivant", ok: alive, detail: String(alive) },
    { label: "bribe du gauge", ok: same(bribe, g.btcMusdBribe), detail: bribe },
    { label: "MUSD whitelisté", ok: whitelisted, detail: String(whitelisted) },
    { label: "MUSD déjà récompense du bribe", ok: isReward, detail: String(isReward) },
    { label: "le bribe a des votes", ok: votes > BigInt(0), detail: votes.toString() },
    { label: "veMEZO répond", ok: veMezoName === "veMEZO", detail: `${veMezoName}, pouvoir total ${veMezoPower}` },
    { label: "veBTC répond", ok: veBtcName === "veBTC", detail: veBtcName },
  ];
}

/**
 * Validation pure des paramètres de frais, avant toute lecture réseau ou transaction.
 * Renvoie les messages d'erreur (vide = configuration cohérente).
 */
export function feeConfigErrors(input: {
  feeBps: bigint;
  incentiveBps: bigint;
  discountedBps: bigint;
  minVeMezoPower: bigint;
  treasury: string | null;
  deployer: string;
}): string[] {
  const errors: string[] = [];
  if (input.feeBps < BigInt(0) || input.feeBps > BigInt(1_000)) errors.push("SIRIUS_FEE_BPS doit être entre 0 et 1000 (10 %)");
  if (input.feeBps === BigInt(0)) return errors;
  if (input.incentiveBps < BigInt(0) || input.incentiveBps > BigInt(10_000)) errors.push("SIRIUS_FEE_INCENTIVE_BPS doit être entre 0 et 10000");
  if (input.discountedBps < BigInt(0) || input.discountedBps >= input.feeBps) {
    errors.push("SIRIUS_FEE_DISCOUNT_BPS doit être inférieur à SIRIUS_FEE_BPS, sinon la remise veMEZO ne sert à rien");
  }
  if (input.minVeMezoPower <= BigInt(0)) errors.push("SIRIUS_FEE_MIN_VEMEZO_POWER doit être positif");
  if (!input.treasury || !/^0x[0-9a-fA-F]{40}$/.test(input.treasury) || /^0x0{40}$/.test(input.treasury)) {
    errors.push("SIRIUS_FEE_TREASURY doit être une adresse non nulle");
  }
  return errors;
}
