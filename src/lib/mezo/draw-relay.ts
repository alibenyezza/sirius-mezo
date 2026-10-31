import "server-only";
import { BaseError, ContractFunctionRevertedError, createWalletClient, http, type Address, type Hex } from "viem";
import { AppError } from "@/lib/errors";
import { normalizeAddress } from "@/lib/evm/address";
import { getPublicClient } from "@/lib/evm/client";
import { EVM_CHAIN_IDS, resolveServerNetwork } from "@/lib/evm/networks";
import { settlementAccount } from "@/lib/evm/runner-account";
import { borrowerOperationsSignaturesAbi } from "./abi";
import { musdProtocol } from "./protocol";
import { readDrawQuote } from "./trove";
import { parseDrawRelayBody, validateDrawTiming } from "./draw-relay-policy";

/**
 * « Emprunter et acheter » : tirage de MUSD sur le trove de l'acheteur, relayé par Sirius.
 *
 * L'acheteur signe hors chaîne un message `WithdrawMUSD` (EIP-712, domaine de
 * `BorrowerOperationsSignatures`) qui fixe le montant, le destinataire (lui-même), son nonce
 * et une échéance. Le compte de règlement de Sirius soumet `withdrawMUSDWithSignature` et
 * paie le gas en BTC ; le protocole MUSD augmente la dette du trove du montant plus les
 * frais d'emprunt (0,1 %) et frappe le MUSD **vers l'acheteur**. Le relayeur ne touche
 * jamais ces fonds : il ne peut que payer la transaction ou ne pas la soumettre.
 *
 * Avant d'envoyer, le serveur rejoue le devis (`readDrawQuote`) : trove actif, ratio de
 * collatéralisation après tirage au-dessus du seuil de sécurité, nonce identique à celui du
 * contrat. Les indices de tri (`upperHint`, `lowerHint`) ne sont pas signés : ils n'influent
 * que sur le gas, et sont recalculés ici. Une simulation précède l'envoi : un refus
 * déterministe du protocole ne coûte aucun gas.
 */

function revertReason(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) return reverted.reason ?? reverted.data?.errorName ?? null;
  return error.shortMessage ?? null;
}

export async function relayWithdrawMusd(borrower: string, body: unknown) {
  if (process.env.SIRIUS_BORROW_AND_BUY?.trim() !== "true") throw new AppError("Introuvable", 404);
  const account = normalizeAddress(borrower) as Address;
  const payload = parseDrawRelayBody(body);
  validateDrawTiming(payload.deadline, Math.floor(Date.now() / 1000));

  const { network, chain, rpcUrl } = resolveServerNetwork();
  const { position, quote, hints } = await readDrawQuote(account, payload.amount, network);
  if (!quote.allowed) throw new AppError(quote.reason ?? "Tirage refusé", 409);
  if (BigInt(position.nonce) !== payload.nonce) throw new AppError("Signature de tirage déjà consommée ou périmée", 409);

  const protocol = musdProtocol(network);
  const relayer = settlementAccount();
  const publicClient = getPublicClient();
  let simulation;
  try {
    simulation = await publicClient.simulateContract({
      address: protocol.borrowerOperationsSignatures,
      abi: borrowerOperationsSignaturesAbi,
      functionName: "withdrawMUSDWithSignature",
      args: [payload.amount, hints.upperHint, hints.lowerHint, account, account, payload.signature, payload.deadline],
      account: relayer,
    });
  } catch (error) {
    const reason = revertReason(error);
    throw new AppError(reason ? `Tirage refusé par le protocole MUSD : ${reason}` : "Tirage refusé par le protocole MUSD", 409);
  }
  const wallet = createWalletClient({ account: relayer, chain, transport: http(rpcUrl) });
  const txHash: Hex = await wallet.writeContract(simulation.request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
  if (receipt.status !== "success") throw new AppError("Tirage rejeté par la chaîne", 502);
  const after = await readDrawQuote(account, BigInt(0), network);
  return {
    txHash,
    chainId: EVM_CHAIN_IDS[network],
    amount: payload.amount.toString(),
    fee: quote.fee,
    position: after.position,
  };
}
