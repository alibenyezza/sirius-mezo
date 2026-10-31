import type { Address, Hex, TypedDataDomain } from "viem";

/**
 * Charge utile EIP-712 attendue par `BorrowerOperationsSignatures.withdrawMUSDWithSignature`
 * (mezo-org/musd). Le contrat hache `abi.encodePacked(TYPEHASH, abi.encode(amount, borrower,
 * recipient), nonce, deadline)`, ce qui, tout étant aligné sur 32 octets, revient à
 * `abi.encode` des six champs : la structure déclarée ici est donc exactement la sienne.
 *
 * Les hints d'insertion (`_upperHint`, `_lowerHint`) ne sont *pas* signés : ils sont
 * fournis par le relayeur au moment d'émettre la transaction. Le nonce vient de
 * `getNonce(borrower)` ; il est consommé à chaque appel réussi.
 *
 * Module pur : aucun accès réseau, aucune clé. La signature se fait côté wallet.
 */

export const WITHDRAW_MUSD_TYPE_STRING =
  "WithdrawMUSD(uint256 amount,address borrower,address recipient,uint256 nonce,uint256 deadline)";

/** `keccak256(WITHDRAW_MUSD_TYPE_STRING)`, valeur de `WITHDRAW_MUSD_TYPEHASH` dans le contrat. */
export const WITHDRAW_MUSD_TYPEHASH: Hex = "0x7b2d4b9993925281c28bad62320bf41cf88086cf7b75457ab8f922fc0edcc14a";

export const WITHDRAW_MUSD_DOMAIN_NAME = "BorrowerOperationsSignatures";
export const WITHDRAW_MUSD_DOMAIN_VERSION = "1";

export const withdrawMusdTypes = {
  WithdrawMUSD: [
    { name: "amount", type: "uint256" },
    { name: "borrower", type: "address" },
    { name: "recipient", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface WithdrawMusdInput {
  chainId: number;
  /** Proxy `BorrowerOperationsSignatures` du réseau visé. */
  verifyingContract: Address;
  /** MUSD à tirer (1e18). */
  amount: bigint;
  /** Propriétaire du trove, qui signe. */
  borrower: Address;
  /** Destinataire du MUSD tiré (peut différer du borrower). */
  recipient: Address;
  /** `getNonce(borrower)` au moment de signer. */
  nonce: bigint;
  /** Horodatage Unix (secondes) au-delà duquel la signature est refusée. */
  deadline: bigint;
}

export interface WithdrawMusdTypedData {
  domain: TypedDataDomain & { name: string; version: string; chainId: number; verifyingContract: Address };
  types: typeof withdrawMusdTypes;
  primaryType: "WithdrawMUSD";
  message: {
    amount: bigint;
    borrower: Address;
    recipient: Address;
    nonce: bigint;
    deadline: bigint;
  };
}

export function withdrawMusdTypedData(input: WithdrawMusdInput): WithdrawMusdTypedData {
  if (!Number.isInteger(input.chainId) || input.chainId <= 0) throw new RangeError("chainId must be a positive integer");
  for (const [name, value] of [["amount", input.amount], ["nonce", input.nonce], ["deadline", input.deadline]] as const) {
    if (value < BigInt(0)) throw new RangeError(`${name} must be non-negative`);
  }
  return {
    domain: {
      name: WITHDRAW_MUSD_DOMAIN_NAME,
      version: WITHDRAW_MUSD_DOMAIN_VERSION,
      chainId: input.chainId,
      verifyingContract: input.verifyingContract,
    },
    types: withdrawMusdTypes,
    primaryType: "WithdrawMUSD",
    message: {
      amount: input.amount,
      borrower: input.borrower,
      recipient: input.recipient,
      nonce: input.nonce,
      deadline: input.deadline,
    },
  };
}
