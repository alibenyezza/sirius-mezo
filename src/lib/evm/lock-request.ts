import { concatHex, encodeAbiParameters, getAddress, keccak256, parseSignature, toHex, type Hex } from "viem";

/**
 * Données typées EIP-712 du lock par signature (`SiriusEscrow.lockWithSignature`, v6).
 *
 * Purement local : aucun appel réseau, aucune clé. Le domaine (`SiriusEscrow` / `6`) et la
 * liste des champs recopient `contracts/src/SiriusEscrow.sol` ; le contrat reconstruit le
 * même digest depuis `LOCK_REQUEST_TYPEHASH` et `abi.encode(request)`. Un champ ajouté
 * ou déplacé d'un seul côté invalide toutes les signatures : la conformité est vérifiée
 * par `lock-request.test.ts` (recomposition manuelle) et par les tests Hardhat (le
 * contrat accepte une signature produite ici).
 */

export const LOCK_REQUEST_DOMAIN = { name: "SiriusEscrow", version: "6" } as const;

export const LOCK_REQUEST_TYPES = {
  LockRequest: [
    { name: "borrower", type: "address" },
    { name: "provider", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "hashlock", type: "bytes32" },
    { name: "challengeDays", type: "uint8" },
    { name: "loanIdHash", type: "bytes32" },
    { name: "datasetId", type: "bytes32" },
    { name: "trainingProfile", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Chaîne de type EIP-712, telle que hachée dans `LOCK_REQUEST_TYPEHASH` côté Solidity. */
export const LOCK_REQUEST_TYPE_STRING =
  "LockRequest(address borrower,address provider,uint256 amount,bytes32 hashlock,uint8 challengeDays," +
  "bytes32 loanIdHash,bytes32 datasetId,bytes32 trainingProfile,uint256 nonce,uint256 deadline)";

/** Struct ERC-2612, identique pour tout jeton `permit` conforme (MUSD compris). */
export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface LockRequest {
  borrower: string;
  provider: string;
  amount: bigint;
  hashlock: Hex;
  challengeDays: number;
  loanIdHash: Hex;
  datasetId: Hex;
  trainingProfile: Hex;
  /** Doit valoir `escrow.lockNonces(borrower)` au moment de la soumission. */
  nonce: bigint;
  /** Horodatage Unix (secondes) : le contrat refuse dès `block.timestamp >= deadline`. */
  deadline: bigint;
}

/** Message tel qu'envoyé au wallet et tel que passé au contrat (adresses en forme EIP-55). */
export function normalizeLockRequest(request: LockRequest) {
  return {
    borrower: getAddress(request.borrower),
    provider: getAddress(request.provider),
    amount: request.amount,
    hashlock: request.hashlock,
    challengeDays: request.challengeDays,
    loanIdHash: request.loanIdHash,
    datasetId: request.datasetId,
    trainingProfile: request.trainingProfile,
    nonce: request.nonce,
    deadline: request.deadline,
  } as const;
}

/** Payload `signTypedData` du borrower pour `lockWithSignature`. */
export function lockRequestTypedData({ chainId, escrow, request }: { chainId: number; escrow: string; request: LockRequest }) {
  return {
    domain: { ...LOCK_REQUEST_DOMAIN, chainId, verifyingContract: getAddress(escrow) },
    types: LOCK_REQUEST_TYPES,
    primaryType: "LockRequest",
    message: normalizeLockRequest(request),
  } as const;
}

/**
 * `hashStruct(LockRequest)` recomposé comme le contrat le fait : `keccak256(abi.encode(TYPEHASH, request))`.
 * Sert de contre-vérification indépendante de l'encodeur EIP-712 de viem.
 */
export function lockRequestStructHash(request: LockRequest): Hex {
  const message = normalizeLockRequest(request);
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" },
      { type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" },
    ],
    [
      keccak256(toHex(LOCK_REQUEST_TYPE_STRING)), message.borrower, message.provider, message.amount, message.hashlock,
      message.challengeDays, message.loanIdHash, message.datasetId, message.trainingProfile, message.nonce, message.deadline,
    ],
  ));
}

/** Séparateur de domaine EIP-712 d'un contrat (`name`, `version`, chainId, adresse), sans viem typed-data. */
export function eip712DomainSeparator(name: string, version: string, chainId: number, contract: string): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [
      keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
      keccak256(toHex(name)), keccak256(toHex(version)), BigInt(chainId), getAddress(contract),
    ],
  ));
}

/** Digest final `0x1901 ‖ domainSeparator ‖ hashStruct`, celui que le contrat passe à `ecrecover`. */
export function lockRequestDigest({ chainId, escrow, request }: { chainId: number; escrow: string; request: LockRequest }): Hex {
  const domain = eip712DomainSeparator(LOCK_REQUEST_DOMAIN.name, LOCK_REQUEST_DOMAIN.version, chainId, escrow);
  return keccak256(concatHex(["0x1901", domain, lockRequestStructHash(request)]));
}

export interface PermitInput {
  chainId: number;
  /** Adresse du jeton (contrat vérificateur du permit). */
  token: string;
  /** `name()` du jeton, tel qu'il entre dans son `DOMAIN_SEPARATOR()`. */
  tokenName: string;
  /** Version du domaine EIP-712 du jeton (souvent "1" ; à lire dans le contrat, pas à deviner). */
  tokenVersion: string;
  owner: string;
  spender: string;
  value: bigint;
  /** `token.nonces(owner)` au moment de la signature. */
  nonce: bigint;
  deadline: bigint;
}

/** Payload `signTypedData` d'un permit ERC-2612 (MUSD sur Mezo, ou le jeton de test). */
export function musdPermitTypedData(input: PermitInput) {
  return {
    domain: { name: input.tokenName, version: input.tokenVersion, chainId: input.chainId, verifyingContract: getAddress(input.token) },
    types: PERMIT_TYPES,
    primaryType: "Permit",
    message: {
      owner: getAddress(input.owner),
      spender: getAddress(input.spender),
      value: input.value,
      nonce: input.nonce,
      deadline: input.deadline,
    },
  } as const;
}

/** Struct `Permit` attendu par `lockWithSignature`, découpé depuis la signature 65 octets du wallet. */
export function permitFromSignature(signature: Hex, value: bigint, deadline: bigint) {
  const { r, s, v, yParity } = parseSignature(signature);
  const recovery = v !== undefined ? Number(v) : (yParity ?? 0) + 27;
  return { value, deadline, v: recovery, r, s } as const;
}

/** Struct `Permit` nul : « pas de permit », le contrat s'appuie sur l'allowance existante. */
export const NO_PERMIT = {
  value: BigInt(0),
  deadline: BigInt(0),
  v: 0,
  r: `0x${"00".repeat(32)}` as Hex,
  s: `0x${"00".repeat(32)}` as Hex,
} as const;
