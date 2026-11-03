import "server-only";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  parseEther,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { prisma } from "@/lib/db";
import { siriuscheckoutAbi } from "@/lib/evm/abi/siriuscheckout";
import { siriusdatasetregistryAbi } from "@/lib/evm/abi/siriusdatasetregistry";
import { siriusescrowAbi } from "@/lib/evm/abi/siriusescrow";
import { siriusfeerouterAbi } from "@/lib/evm/abi/siriusfeerouter";
import { getPublicClient } from "@/lib/evm/client";
import { datasetIdHash } from "@/lib/evm/dataset-key";
import { loanIdHash } from "@/lib/evm/loan-key";
import { readDeploymentManifest } from "@/lib/sirius/deployment-manifest";

/**
 * « Try to break it » : des attaques rejouées en direct contre les contrats déployés.
 *
 * Chaque attaque est une simulation (`eth_call`) depuis une adresse d'attaquant fictive, sur
 * l'état courant de la chaîne : rien n'est signé, rien n'est envoyé, aucun gas n'est dépensé.
 * Le contrat répond par son erreur ; la page affiche exactement ce qu'il a répondu. Une attaque
 * qui passerait serait affichée comme telle, en rouge : la page ne trie pas les résultats.
 */

/** Adresse d'attaquant fictive : aucune clé n'existe pour elle. */
export const ATTACKER: Address = "0x00000000000000000000000000000000000bad01";

export type AttackOutcome =
  | { status: "refused"; error: string }
  | { status: "accepted" }
  | { status: "unavailable"; reason: string };

export interface AttackResult {
  id: string;
  title: string;
  attempt: string;
  contract: string;
  address: Address;
  call: string;
  outcome: AttackOutcome;
}

export interface AttackReport {
  block: string;
  checkedAt: string;
  results: AttackResult[];
}

interface Attack {
  id: string;
  title: string;
  attempt: string;
  contract: string;
  address: Address;
  call: string;
  run: () => Promise<AttackOutcome>;
}

const ownerAbi = parseAbi(["function owner() view returns (address)", "function sweep(address to) returns (uint256)"]);

function revertName(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.data?.errorName ?? reverted.reason ?? "reverted";
    }
    const message = error.shortMessage || error.message;
    if (/revert/i.test(message)) return "reverted (no matching function)";
    throw error;
  }
  throw error;
}

/** Simule un appel ; une erreur du contrat devient « refusé », une erreur réseau remonte. */
async function simulate(input: {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  account?: Address;
  value?: bigint;
}): Promise<AttackOutcome> {
  const client = getPublicClient();
  const account = input.account ?? ATTACKER;
  try {
    await client.simulateContract({
      address: input.address,
      abi: input.abi,
      functionName: input.functionName,
      args: input.args ?? [],
      account,
      ...(input.value !== undefined ? { value: input.value } : {}),
      // L'attaquant reçoit du BTC fictif pour que le refus vienne du contrat, pas du solde.
      stateOverride: [{ address: account, balance: parseEther("1") }],
    } as Parameters<typeof client.simulateContract>[0]);
    return { status: "accepted" };
  } catch (error) {
    return { status: "refused", error: revertName(error) };
  }
}

async function rawCall(to: Address, data: Hex, value?: bigint): Promise<AttackOutcome> {
  const client = getPublicClient();
  try {
    await client.call({
      to,
      data,
      account: ATTACKER,
      ...(value !== undefined ? { value } : {}),
      stateOverride: [{ address: ATTACKER, balance: parseEther("1") }],
    });
    return { status: "accepted" };
  } catch (error) {
    return { status: "refused", error: revertName(error) };
  }
}

function randomBytes32(label: string): Hex {
  return keccak256(toHex(`sirius.break.${label}.${Date.now()}`));
}

/** Une signature bien formée (65 octets, s bas, v = 27) qui ne vient d'aucune clé connue. */
const FORGED_SIGNATURE: Hex = `0x${"11".repeat(32)}${"22".repeat(32)}1b`;
/** Même signature avec s dans la moitié haute de l'ordre de la courbe : malléable. */
const HIGH_S_SIGNATURE: Hex = `0x${"11".repeat(32)}${"f".repeat(63)}01b`;

async function liveContext() {
  const manifest = readDeploymentManifest();
  const escrow = getAddress(manifest.contracts.escrow);
  const datasets = getAddress(manifest.contracts.datasets);
  const [openLoan, settledLoan, dataset] = await Promise.all([
    prisma.loan.findFirst({
      where: { status: { in: ["ESCROWED", "TRAINING"] }, evmEscrowAddress: { equals: escrow, mode: "insensitive" }, evmLoanKey: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { evmLoanKey: true },
    }).catch(() => null),
    prisma.loan.findFirst({
      where: { status: "SETTLED", evmEscrowAddress: { equals: escrow, mode: "insensitive" }, evmLoanKey: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { evmLoanKey: true },
    }).catch(() => null),
    prisma.dataset.findFirst({
      where: { evmDatasetId: { not: null }, status: "LISTED" },
      orderBy: { createdAt: "desc" },
      select: { evmDatasetId: true },
    }).catch(() => null),
  ]);
  // Un titre vivant, lu sur la chaîne : celui du catalogue, sinon le dataset de démo du manifeste.
  let liveDataset: { id: Hex; provider: Address; trainingProfile: Hex } | null = null;
  const client = getPublicClient();
  let candidate = (dataset?.evmDatasetId ?? null) as Hex | null;
  if (!candidate && manifest.demo) {
    candidate = await client.readContract({
      address: datasets, abi: siriusdatasetregistryAbi, functionName: "datasetIdOf",
      args: [getAddress(manifest.demo.provider), datasetIdHash(manifest.demo.datasetId)],
    }).catch(() => null);
  }
  if (candidate) {
    try {
      const onChain = await client.readContract({ address: datasets, abi: siriusdatasetregistryAbi, functionName: "getDataset", args: [candidate] });
      if (onChain.destroyedAt === 0 && onChain.mintedAt !== 0) {
        liveDataset = { id: candidate, provider: getAddress(onChain.provider), trainingProfile: onChain.trainingProfile };
      }
    } catch {
      liveDataset = null;
    }
  }
  return {
    manifest,
    escrow,
    datasets,
    checkout: manifest.contracts.checkout ? getAddress(manifest.contracts.checkout) : null,
    feeRouter: manifest.contracts.feeRouter ? getAddress(manifest.contracts.feeRouter) : null,
    openLoanKey: (openLoan?.evmLoanKey ?? null) as Hex | null,
    settledLoanKey: (settledLoan?.evmLoanKey ?? null) as Hex | null,
    liveDataset,
  };
}

function lockRequestFor(borrower: Address, provider: Address, datasetId: Hex, trainingProfile: Hex, nonce: bigint, deadline: bigint) {
  return {
    borrower,
    provider,
    amount: parseEther("1"),
    hashlock: randomBytes32("hashlock"),
    challengeDays: 7,
    loanIdHash: loanIdHash(`break-${Date.now()}`),
    datasetId,
    trainingProfile,
    nonce,
    deadline,
  };
}

const NO_PERMIT = { value: BigInt(0), deadline: BigInt(0), v: 0, r: `0x${"00".repeat(32)}` as Hex, s: `0x${"00".repeat(32)}` as Hex };

function buildAttacks(ctx: Awaited<ReturnType<typeof liveContext>>, now: bigint): Attack[] {
  const { escrow, datasets, checkout, feeRouter, openLoanKey, settledLoanKey, liveDataset } = ctx;
  const victim = getAddress(ctx.manifest.demo?.borrower ?? ctx.manifest.lockAuthorizer);
  const provider = liveDataset?.provider ?? getAddress(ctx.manifest.demo?.provider ?? ctx.manifest.deployer);
  const datasetId = liveDataset?.id ?? randomBytes32("dataset");
  const profile = liveDataset?.trainingProfile ?? randomBytes32("profile");
  const authorization = { deadline: Number(now) + 120, signature: FORGED_SIGNATURE };
  const attacks: Attack[] = [
    {
      id: "release-without-result",
      title: "Take the buyer's MUSD without delivering the model",
      attempt: "Release an open loan to the provider with a made-up training result.",
      contract: "SiriusEscrow", address: escrow, call: "release(loanKey, fakePreimage)",
      run: () => openLoanKey
        ? simulate({ address: escrow, abi: siriusescrowAbi as Abi, functionName: "release", args: [openLoanKey, randomBytes32("preimage")] })
        : Promise.resolve({ status: "unavailable", reason: "No open loan on the current escrow right now." }),
    },
    {
      id: "refund-early",
      title: "Pull the money back before the deadline",
      attempt: "Refund an open loan while the provider can still deliver.",
      contract: "SiriusEscrow", address: escrow, call: "refund(loanKey)",
      run: () => openLoanKey
        ? simulate({ address: escrow, abi: siriusescrowAbi as Abi, functionName: "refund", args: [openLoanKey] })
        : Promise.resolve({ status: "unavailable", reason: "No open loan on the current escrow right now." }),
    },
    {
      id: "release-twice",
      title: "Get paid twice for the same run",
      attempt: "Release a loan that has already been settled.",
      contract: "SiriusEscrow", address: escrow, call: "release(settledLoanKey, preimage)",
      run: () => settledLoanKey
        ? simulate({ address: escrow, abi: siriusescrowAbi as Abi, functionName: "release", args: [settledLoanKey, randomBytes32("preimage")] })
        : Promise.resolve({ status: "unavailable", reason: "No settled loan on the current escrow yet." }),
    },
    {
      id: "forged-authorization",
      title: "Lock a purchase Sirius never approved",
      attempt: "Call lock with valid terms on a live dataset but a forged Sirius authorization.",
      contract: "SiriusEscrow", address: escrow, call: "lock(provider, 1 MUSD, …, forgedAuthorization)",
      run: () => simulate({
        address: escrow, abi: siriusescrowAbi as Abi, functionName: "lock",
        args: [provider, parseEther("1"), randomBytes32("hashlock"), 7, loanIdHash(`break-${now}`), datasetId, profile, authorization],
      }),
    },
    {
      id: "forged-buyer-signature",
      title: "Spend a buyer's MUSD with a signature they never made",
      attempt: "Relay a lock request in the buyer's name with a signature from another key.",
      contract: "SiriusEscrow", address: escrow, call: "lockWithSignature(request, forgedSignature, …)",
      run: async () => {
        const nonce = await getPublicClient().readContract({ address: escrow, abi: siriusescrowAbi, functionName: "lockNonces", args: [victim] }).catch(() => null);
        if (nonce === null) return { status: "unavailable", reason: "This escrow predates signed locks." };
        return simulate({
          address: escrow, abi: siriusescrowAbi as Abi, functionName: "lockWithSignature",
          args: [lockRequestFor(victim, provider, datasetId, profile, nonce, now + BigInt(300)), FORGED_SIGNATURE, NO_PERMIT, authorization],
        });
      },
    },
    {
      id: "malleable-signature",
      title: "Replay a signature in its malleable twin form",
      attempt: "Submit a signature whose s value is in the upper half of the curve order.",
      contract: "SiriusEscrow", address: escrow, call: "lockWithSignature(request, highSSignature, …)",
      run: async () => {
        const nonce = await getPublicClient().readContract({ address: escrow, abi: siriusescrowAbi, functionName: "lockNonces", args: [victim] }).catch(() => null);
        if (nonce === null) return { status: "unavailable", reason: "This escrow predates signed locks." };
        return simulate({
          address: escrow, abi: siriusescrowAbi as Abi, functionName: "lockWithSignature",
          args: [lockRequestFor(victim, provider, datasetId, profile, nonce, now + BigInt(300)), HIGH_S_SIGNATURE, NO_PERMIT, authorization],
        });
      },
    },
    {
      id: "endless-request",
      title: "Keep a signed request alive forever",
      attempt: "Relay a lock request that stays valid for a whole year.",
      contract: "SiriusEscrow", address: escrow, call: "lockWithSignature(request{deadline: +365 days}, …)",
      run: async () => {
        const nonce = await getPublicClient().readContract({ address: escrow, abi: siriusescrowAbi, functionName: "lockNonces", args: [victim] }).catch(() => null);
        if (nonce === null) return { status: "unavailable", reason: "This escrow predates signed locks." };
        return simulate({
          address: escrow, abi: siriusescrowAbi as Abi, functionName: "lockWithSignature",
          args: [lockRequestFor(victim, provider, datasetId, profile, nonce, now + BigInt(365 * 86_400)), FORGED_SIGNATURE, NO_PERMIT, authorization],
        });
      },
    },
    {
      id: "withdraw-nothing",
      title: "Withdraw MUSD you were never owed",
      attempt: "Ask the escrow to pay out the attacker's credit.",
      contract: "SiriusEscrow", address: escrow, call: "withdraw()",
      run: () => simulate({ address: escrow, abi: siriusescrowAbi as Abi, functionName: "withdraw" }),
    },
    {
      id: "rebind-registry",
      title: "Point the dataset registry at a rogue escrow",
      attempt: "Re-bind the dataset registry to an escrow the attacker controls.",
      contract: "SiriusDatasetRegistry", address: datasets, call: "bindEscrow(attacker)",
      run: () => simulate({ address: datasets, abi: siriusdatasetregistryAbi as Abi, functionName: "bindEscrow", args: [ATTACKER] }),
    },
  ];
  if (checkout) {
    attacks.push(
      {
        id: "checkout-for-someone-else",
        title: "Open a loan in someone else's name with your BTC",
        attempt: "Pay with BTC for a lock request whose borrower is another wallet.",
        contract: "SiriusCheckout", address: checkout, call: "buyWithBtc{value}(min, request{borrower: victim}, …)",
        run: () => simulate({
          address: checkout, abi: siriuscheckoutAbi as Abi, functionName: "buyWithBtc", value: parseEther("0.0001"),
          args: [parseEther("1"), lockRequestFor(victim, provider, datasetId, profile, BigInt(0), now + BigInt(300)), FORGED_SIGNATURE, NO_PERMIT, authorization],
        }),
      },
      {
        id: "checkout-park-btc",
        title: "Park BTC in the checkout",
        attempt: "Send BTC straight to the checkout contract, outside a purchase.",
        contract: "SiriusCheckout", address: checkout, call: "send 0.0001 BTC",
        run: () => rawCall(checkout, "0x", parseEther("0.0001")),
      },
    );
  }
  if (feeRouter) {
    attacks.push({
      id: "router-admin",
      title: "Find an admin key on the fee router",
      attempt: "Call owner() and sweep(attacker): the router has neither, so the fees can only go to the treasury and the Mezo bribe.",
      contract: "SiriusFeeRouter", address: feeRouter, call: "sweep(attacker)",
      run: () => rawCall(feeRouter, encodeFunctionData({ abi: ownerAbi, functionName: "sweep", args: [ATTACKER] })),
    });
    attacks.push({
      id: "router-reenter",
      title: "Make the fee router pull from a fake escrow",
      attempt: "Call distribute with the attacker as source: only MUSD the router really holds is ever split.",
      contract: "SiriusFeeRouter", address: feeRouter, call: "distribute(attacker)",
      run: () => simulate({ address: feeRouter, abi: siriusfeerouterAbi as Abi, functionName: "distribute", args: [ATTACKER] }),
    });
  }
  return attacks;
}

/** Rejoue toutes les attaques sur le dernier bloc. Une panne RPC rend l'attaque « indisponible ». */
export async function runAttacks(): Promise<AttackReport> {
  const client = getPublicClient();
  const block = await client.getBlock();
  const ctx = await liveContext();
  const attacks = buildAttacks(ctx, block.timestamp);
  const results = await Promise.all(attacks.map(async ({ run, ...attack }): Promise<AttackResult> => {
    try {
      return { ...attack, outcome: await run() };
    } catch {
      return { ...attack, outcome: { status: "unavailable", reason: "The RPC did not answer; reload the page." } };
    }
  }));
  return { block: block.number.toString(), checkedAt: new Date(Number(block.timestamp) * 1000).toISOString(), results };
}
