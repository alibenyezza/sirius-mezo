import "server-only";
import { zeroAddress, type Address } from "viem";
import { getPublicClient } from "@/lib/evm/client";
import { escrowAddress } from "@/lib/evm/addresses";
import { siriusescrowAbi } from "@/lib/evm/abi/siriusescrow";
import { siriusmezofeepolicyAbi } from "@/lib/evm/abi/siriusmezofeepolicy";
import type { PlatformFee } from "./platform-fee-math";

/**
 * Frais de plateforme lus sur l'escrow configuré : la chaîne fait foi, pas l'environnement.
 * Un escrow sans frais, ou plus ancien que la fonction `feeBps`, rend `null`. Mis en cache
 * cinq minutes : ces valeurs sont immuables pour un escrow donné.
 */

const TTL_MS = 5 * 60_000;
let cached: { escrow: Address; at: number; value: PlatformFee | null } | null = null;

export async function readPlatformFee(): Promise<PlatformFee | null> {
  let escrow: Address;
  try {
    escrow = escrowAddress();
  } catch {
    return null;
  }
  if (cached && cached.escrow === escrow && Date.now() - cached.at < TTL_MS) return cached.value;

  let value: PlatformFee | null = null;
  try {
    const client = getPublicClient();
    const [baseBps, policy] = await Promise.all([
      client.readContract({ address: escrow, abi: siriusescrowAbi, functionName: "feeBps" }),
      client.readContract({ address: escrow, abi: siriusescrowAbi, functionName: "feePolicy" }),
    ]);
    if (baseBps > BigInt(0)) {
      let discountedBps: number | null = null;
      let minVeMezoPower: string | null = null;
      if (policy !== zeroAddress) {
        const [discounted, minPower] = await Promise.all([
          client.readContract({ address: policy, abi: siriusmezofeepolicyAbi, functionName: "discountedBps" }),
          client.readContract({ address: policy, abi: siriusmezofeepolicyAbi, functionName: "minPower" }),
        ]);
        if (discounted < baseBps) {
          discountedBps = Number(discounted);
          minVeMezoPower = minPower.toString();
        }
      }
      value = { baseBps: Number(baseBps), discountedBps, minVeMezoPower };
    }
  } catch {
    // Escrow antérieur aux frais (pas de `feeBps`) ou RPC muet : aucun frais annoncé.
    value = null;
  }
  cached = { escrow, at: Date.now(), value };
  return value;
}
