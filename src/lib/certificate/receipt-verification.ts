import "server-only";
import { createPublicClient, getAddress, http, parseAbi, recoverMessageAddress, type Address, type Hex } from "viem";
import { EVM_CHAINS } from "@/lib/evm/networks";
import { receiptMessage } from "@/lib/tee/receipt-message";
import type { ReceiptVerificationView } from "./presentation";

/**
 * Vérifie un reçu d'exécution hors enclave : le signataire EIP-191 du hash attesté doit être
 * le `lockAuthorizer` de l'escrow, lu on-chain (immuable, donc mis en cache par escrow).
 * Une lecture RPC impossible laisse `lockAuthorizer` à null : la page dit « non vérifié »,
 * jamais « vérifié ».
 */

const lockAuthorizerAbi = parseAbi(["function lockAuthorizer() view returns (address)"]);
const authorizers = new Map<string, Address>();

async function readLockAuthorizer(chainId: number, escrow: string): Promise<Address | null> {
  const key = `${chainId}:${escrow.toLowerCase()}`;
  const cached = authorizers.get(key);
  if (cached) return cached;
  const chain = Object.values(EVM_CHAINS).find((candidate) => candidate.id === chainId);
  if (!chain) return null;
  try {
    const client = createPublicClient({ chain, transport: http(undefined, { timeout: 8_000 }) });
    const value = await client.readContract({ address: getAddress(escrow), abi: lockAuthorizerAbi, functionName: "lockAuthorizer" });
    authorizers.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export async function verifyExecutionReceipt(input: {
  payloadHash: string;
  signature: string;
  chainId: number;
  escrow: string;
}): Promise<ReceiptVerificationView> {
  let signer: Address | null = null;
  try {
    signer = await recoverMessageAddress({ message: receiptMessage(input.payloadHash), signature: input.signature as Hex });
  } catch {
    signer = null;
  }
  const lockAuthorizer = await readLockAuthorizer(input.chainId, input.escrow);
  const matches = signer && lockAuthorizer ? getAddress(signer) === getAddress(lockAuthorizer) : null;
  return { signer, lockAuthorizer, escrow: getAddress(input.escrow), matches: signer === null ? false : matches };
}
