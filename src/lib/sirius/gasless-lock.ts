import "server-only";
import { BaseError, ContractFunctionRevertedError, createWalletClient, decodeFunctionData, http, type Hex } from "viem";
import { AppError } from "@/lib/errors";
import { addressesEqual, normalizeAddress } from "@/lib/evm/address";
import { escrowAddress, usdcAddress } from "@/lib/evm/addresses";
import { siriusescrowAbi } from "@/lib/evm/abi/siriusescrow";
import { getPublicClient } from "@/lib/evm/client";
import { resolveServerNetwork } from "@/lib/evm/networks";
import { settlementAccount } from "@/lib/evm/runner-account";
import {
  lockRequestTypedData,
  musdPermitTypedData,
  NO_PERMIT,
  permitFromSignature,
  type LockRequest,
} from "@/lib/evm/lock-request";
import { finalizeLoan, renewLoanLock } from "./borrower";
import { musdPermitDomainAbi } from "./gasless-lock-abi";
import { parseLockRelayBody, serializeLockRequest, type LockRelayBody } from "./gasless-lock-policy";

/**
 * Paiement d'un prêt en une signature : `SiriusEscrow.lockWithSignature` (v6).
 *
 * L'acheteur signe hors chaîne deux messages EIP-712 — un `permit` MUSD (ERC-2612, que le
 * MUSD de Mezo implémente) et une `LockRequest` qui reprend les termes du prêt — et c'est le
 * compte de règlement de Sirius qui soumet la transaction et paie le gas en BTC. L'acheteur
 * n'a donc besoin ni de BTC ni d'une transaction d'approbation : du MUSD et un wallet.
 *
 * Ce module ne fait pas confiance au client pour les termes. À chaque étape, les termes sont
 * reconstruits côté serveur (`renewLoanLock`, qui rejoue toutes les vérifications du parcours
 * classique et obtient une autorisation fraîche du signataire de lock), puis comparés champ à
 * champ à ce que l'acheteur a signé. Le contrat vérifie de son côté la signature de
 * l'acheteur, le nonce, l'échéance et l'autorisation de Sirius : le relayeur ne peut rien
 * altérer, seulement payer le gas.
 *
 * Interrupteur `SIRIUS_GASLESS_LOCK=true`. Réservé à l'escrow v6 sans devis compute (le v7
 * signe ses termes autrement). L'escrow déployé doit exposer `lockNonces` : un escrow v6
 * antérieur à cette fonction fait répondre 409, jamais une transaction qui échoue.
 */

const PERMIT_VERSION_FALLBACK = "1";

export function gaslessLockEnabled(): boolean {
  return process.env.SIRIUS_GASLESS_LOCK?.trim() === "true";
}

function requireEnabled(): void {
  if (!gaslessLockEnabled()) throw new AppError("Paiement par signature désactivé sur cette instance", 404);
}

/** Termes du lock tels que le parcours classique les encoderait, lus dans son calldata. */
async function lockTermsFor(loanId: string, borrower: string) {
  const renewed = await renewLoanLock(loanId, borrower);
  if (renewed.billingQuote) throw new AppError("Paiement par signature réservé à l’escrow v6", 409);
  const call = decodeFunctionData({ abi: siriusescrowAbi, data: renewed.lockTransaction.data });
  if (call.functionName !== "lock") throw new AppError("Transaction de lock inattendue", 500);
  const [provider, amount, hashlock, challengeDays, loanIdHash, datasetId, trainingProfile, authorization] = call.args;
  return {
    terms: { provider, amount, hashlock, challengeDays, loanIdHash, datasetId, trainingProfile },
    authorization: { deadline: authorization.deadline, signature: authorization.signature as Hex },
    authorizationDeadline: renewed.authorizationDeadline,
  };
}

async function readEscrowNonce(borrower: `0x${string}`): Promise<bigint> {
  try {
    return await getPublicClient().readContract({ address: escrowAddress(), abi: siriusescrowAbi, functionName: "lockNonces", args: [borrower] });
  } catch {
    throw new AppError("L’escrow déployé n’accepte pas encore le lock par signature", 409);
  }
}

async function readPermitContext(owner: `0x${string}`) {
  const client = getPublicClient();
  const token = usdcAddress();
  const [nonce, name] = await Promise.all([
    client.readContract({ address: token, abi: musdPermitDomainAbi, functionName: "nonces", args: [owner] }),
    client.readContract({ address: token, abi: musdPermitDomainAbi, functionName: "name" }),
  ]);
  // Le domaine EIP-712 du jeton fait foi quand il est publié (EIP-5267) ; sinon version « 1 ».
  let version = PERMIT_VERSION_FALLBACK;
  try {
    const domain = await client.readContract({ address: token, abi: musdPermitDomainAbi, functionName: "eip712Domain" });
    if (domain[1] !== name) throw new AppError("Domaine EIP-712 du jeton incohérent", 500);
    version = domain[2];
  } catch (error) {
    if (error instanceof AppError) throw error;
  }
  return { token, nonce, name, version };
}

/** Charges à signer par l'acheteur. L'échéance est celle de l'autorisation de lock (cinq minutes au plus). */
export async function prepareLockWithSignature(loanId: string, borrower: string) {
  requireEnabled();
  const borrowerAddress = normalizeAddress(borrower) as `0x${string}`;
  const { chain } = resolveServerNetwork();
  const escrow = escrowAddress();
  const { terms, authorizationDeadline } = await lockTermsFor(loanId, borrowerAddress);
  const [nonce, permit, allowance] = await Promise.all([
    readEscrowNonce(borrowerAddress),
    readPermitContext(borrowerAddress),
    getPublicClient().readContract({ address: usdcAddress(), abi: musdPermitDomainAbi, functionName: "allowance", args: [borrowerAddress, escrow] }),
  ]);
  const deadline = BigInt(authorizationDeadline);
  const request: LockRequest = { borrower: borrowerAddress, ...terms, nonce, deadline };
  return {
    loanId,
    chainId: chain.id,
    escrow,
    token: permit.token,
    request: serializeLockRequest(request),
    lockRequest: lockRequestTypedData({ chainId: chain.id, escrow, request }),
    permit: musdPermitTypedData({
      chainId: chain.id, token: permit.token, tokenName: permit.name, tokenVersion: permit.version,
      owner: borrowerAddress, spender: escrow, value: terms.amount, nonce: permit.nonce, deadline,
    }),
    // Une allowance déjà suffisante dispense du permit : une signature de moins.
    permitRequired: allowance < terms.amount,
    expiresAt: authorizationDeadline,
  };
}

function revertReason(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) return reverted.data?.errorName ?? reverted.reason ?? null;
  return error.shortMessage ?? null;
}

/**
 * Soumet le lock signé depuis le compte de règlement, puis enregistre le prêt comme le
 * parcours classique (`finalizeLoan` attend le reçu et relit le prêt on-chain).
 */
export async function relayLockWithSignature(loanId: string, borrower: string, body: unknown) {
  requireEnabled();
  const borrowerAddress = normalizeAddress(borrower) as `0x${string}`;
  const payload: LockRelayBody = parseLockRelayBody(body);
  if (!addressesEqual(payload.request.borrower, borrowerAddress)) throw new AppError("Demande de lock d’un autre compte", 403);

  const { terms, authorization } = await lockTermsFor(loanId, borrowerAddress);
  const signed = payload.request;
  const identical = addressesEqual(signed.provider, terms.provider)
    && signed.amount === terms.amount
    && signed.hashlock.toLowerCase() === terms.hashlock.toLowerCase()
    && signed.challengeDays === terms.challengeDays
    && signed.loanIdHash.toLowerCase() === terms.loanIdHash.toLowerCase()
    && signed.datasetId.toLowerCase() === terms.datasetId.toLowerCase()
    && signed.trainingProfile.toLowerCase() === terms.trainingProfile.toLowerCase();
  if (!identical) throw new AppError("Termes du lock modifiés depuis la signature : recommence", 409);
  if (signed.deadline <= BigInt(Math.floor(Date.now() / 1000))) throw new AppError("Demande de lock expirée : recommence", 409);
  const nonce = await readEscrowNonce(borrowerAddress);
  if (signed.nonce !== nonce) throw new AppError("Signature de lock déjà consommée ou périmée", 409);

  const request = { ...signed, borrower: borrowerAddress, provider: normalizeAddress(signed.provider) as `0x${string}` };
  const permit = payload.permitSignature ? permitFromSignature(payload.permitSignature, terms.amount, signed.deadline) : NO_PERMIT;
  const { chain, rpcUrl } = resolveServerNetwork();
  const account = settlementAccount();
  const publicClient = getPublicClient();
  let simulation;
  try {
    simulation = await publicClient.simulateContract({
      address: escrowAddress(),
      abi: siriusescrowAbi,
      functionName: "lockWithSignature",
      args: [request, payload.borrowerSignature, permit, { deadline: authorization.deadline, signature: authorization.signature }],
      account,
    });
  } catch (error) {
    const reason = revertReason(error);
    throw new AppError(reason ? `Lock par signature refusé par le contrat : ${reason}` : "Lock par signature refusé par le contrat", 409);
  }
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const txHash = await wallet.writeContract(simulation.request);
  const loan = await finalizeLoan(loanId, borrowerAddress, txHash);
  return { txHash, loan };
}
