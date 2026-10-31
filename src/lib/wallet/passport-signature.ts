import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  hashMessage,
  keccak256,
  parseAbiParameters,
  serializeErc6492Signature,
  sha256,
  stringToBytes,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";
import normalizeSafeSignature from "@mezo-org/orangekit-smart-account/dist/src/lib/utils/normalizeSafeSignature";

/**
 * Signature d'un message par un compte Mezo Passport.
 *
 * Un wallet Bitcoin connecté par Passport n'a pas de clé EVM : Mezo lui associe un smart
 * account — un Safe dont l'unique propriétaire est un contrat `BitcoinSafeOwner` qui
 * vérifie des signatures Bitcoin (BIP-137). Le Safe répond à ERC-1271 par son fallback
 * handler : `isValidSignature(hash, signature)` reconstruit le « SafeMessage » EIP-712 du
 * hash, puis demande au propriétaire de valider la signature de ce condensé.
 *
 * Le propriétaire, lui, attend une signature Bitcoin du *texte hexadécimal* du condensé
 * (64 caractères, sans `0x`), ce que signale le bit haut de `v`. C'est exactement ce que
 * fait le SDK pour les transactions Safe ; on reproduit ici la même enveloppe pour un
 * message arbitraire, afin que `verifyMessage` de viem — côté serveur — puisse valider
 * la connexion et la délégation runner sans rien savoir de Bitcoin.
 *
 * Le smart account n'existe on-chain qu'après sa première transaction. ERC-6492 permet
 * de signer avant : la signature embarque l'appel de déploiement, et le vérificateur
 * universel le simule dans un `eth_call` avant d'interroger le compte.
 *
 * Module pur : ni React, ni `window`, ni réseau. Les lectures on-chain (adresse du
 * propriétaire) et la signature Bitcoin sont fournies par l'appelant.
 */

/** Fabrique OrangeKit des smart accounts, même adresse sur le testnet et le mainnet Mezo. */
export const ORANGEKIT_SAFE_FACTORY: Address = "0x7E80bd5A2E8Fca0B160254D43aC9f43AC2cC1052";

export const orangeKitSafeFactoryAbi = [
  {
    type: "function",
    name: "predictAddresses",
    stateMutability: "view",
    inputs: [{ name: "truncatedBitcoinAddress", type: "bytes20" }],
    outputs: [
      { name: "safe", type: "address" },
      { name: "bitcoinSafeOwner", type: "address" },
    ],
  },
  {
    type: "function",
    name: "deploySafe",
    stateMutability: "nonpayable",
    inputs: [{ name: "truncatedBitcoinAddress", type: "bytes20" }],
    outputs: [
      { name: "safe", type: "address" },
      { name: "bitcoinSafeOwner", type: "address" },
    ],
  },
] as const;

// Safe v1.4.1 : `EIP712Domain(uint256 chainId,address verifyingContract)` et `SafeMessage(bytes message)`.
const SAFE_DOMAIN_TYPEHASH = keccak256(stringToBytes("EIP712Domain(uint256 chainId,address verifyingContract)"));
const SAFE_MESSAGE_TYPEHASH = keccak256(stringToBytes("SafeMessage(bytes message)"));

/** Préfixe des messages signés par un wallet Bitcoin (0x18 = longueur du texte qui suit). */
const BITCOIN_MESSAGE_PREFIX = "\u0018Bitcoin Signed Message:\n";

/**
 * Condensé qu'un Safe v1.4.1 soumet à son propriétaire pour un hash ERC-1271.
 *
 * Reproduit `CompatibilityFallbackHandler.encodeMessageDataForSafe` puis son keccak :
 * `0x1901 ‖ domainSeparator(safe) ‖ keccak(SAFE_MESSAGE_TYPEHASH ‖ keccak(dataHash))`.
 */
export function safeMessageHash({ safe, chainId, dataHash }: { safe: Address; chainId: number; dataHash: Hex }): Hex {
  const domainSeparator = keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, uint256, address"), [SAFE_DOMAIN_TYPEHASH, BigInt(chainId), safe]),
  );
  const safeMessage = keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, bytes32"), [SAFE_MESSAGE_TYPEHASH, keccak256(dataHash)]),
  );
  return keccak256(encodePacked(["bytes1", "bytes1", "bytes32", "bytes32"], ["0x19", "0x01", domainSeparator, safeMessage]));
}

/** Encodage « varint » de Bitcoin pour la longueur d'un message. */
function bitcoinVarint(length: number): Uint8Array {
  if (length < 0xfd) return Uint8Array.of(length);
  if (length <= 0xffff) return Uint8Array.of(0xfd, length & 0xff, length >> 8);
  if (length <= 0xffff_ffff) {
    return Uint8Array.of(0xfe, length & 0xff, (length >> 8) & 0xff, (length >> 16) & 0xff, (length >>> 24) & 0xff);
  }
  throw new Error("Message Bitcoin trop long.");
}

/**
 * Hash qu'un wallet Bitcoin signe pour un message texte : `sha256d(prefixe ‖ varint ‖ texte)`.
 *
 * Sert aux tests, qui jouent le rôle du wallet ; le contrat `BitcoinSafeOwner` fait le
 * même calcul de son côté avant `ecrecover`.
 */
export function bitcoinMessageHash(message: string): Hex {
  const text = stringToBytes(message);
  const preimage = new Uint8Array([...stringToBytes(BITCOIN_MESSAGE_PREFIX), ...bitcoinVarint(text.length), ...text]);
  return sha256(toBytes(sha256(preimage)));
}

const CONTRACT_SIGNATURE_PATTERN = /^81[0-9a-f]{258}$/;

/**
 * Enveloppe Safe d'une signature de propriétaire contractuel.
 *
 * Safe lit `{r: propriétaire}{s: position 65}{v: 0}` puis, à la position 65, une
 * longueur sur 32 octets suivie des données. Les 31 derniers octets du mot de `v`
 * (du remplissage à zéro) et le premier octet de `contractSignature` (`0x81` = 129)
 * forment ensemble cette longueur ; suivent 129 octets : `r ‖ s ‖ v+128 ‖ x ‖ y`,
 * la clé publique non compressée du compte Bitcoin servant au contrôle d'adresse.
 */
export function encodeSafeContractSignature(owner: Address, contractSignature: string): Hex {
  if (!CONTRACT_SIGNATURE_PATTERN.test(contractSignature)) throw new Error("Signature Bitcoin normalisée invalide.");
  const staticPart = encodeAbiParameters(parseAbiParameters("address, uint256, uint8"), [owner, BigInt(65), 0]);
  return concatHex([staticPart, `0x${contractSignature}`]);
}

export interface PassportSignatureInput {
  /** Message EIP-191 tel que le serveur le vérifiera. */
  message: string;
  /** Adresse du smart account (le Safe) qui « signe ». */
  safe: Address;
  chainId: number;
  /** Propriétaire du Safe : le `BitcoinSafeOwner` prédit par la fabrique. */
  owner: Address;
  /** Adresse Bitcoin tronquée (20 octets), clé de dérivation du compte. */
  truncatedBitcoinAddress: Hex;
  /** Clé publique du compte Bitcoin, compressée ou non, hexadécimale. */
  publicKey: string;
  /** Signature Bitcoin BIP-137 d'un texte, `v` en tête, normalisée pour le type d'adresse. */
  signBitcoinMessage: (text: string) => Promise<string>;
}

/**
 * Signature ERC-6492 d'un message pour un compte Mezo Passport.
 *
 * Vérifiable par `publicClient.verifyMessage({ address: safe, message, signature })`,
 * que le Safe soit déjà déployé ou non.
 */
export async function buildPassportSignature(input: PassportSignatureInput): Promise<Hex> {
  const digest = safeMessageHash({ safe: input.safe, chainId: input.chainId, dataHash: hashMessage(input.message) });
  // Le propriétaire vérifie une signature Bitcoin du texte hexadécimal du condensé, sans `0x`.
  const bitcoinSignature = await input.signBitcoinMessage(digest.slice(2));
  const publicKey = input.publicKey.startsWith("0x") ? input.publicKey.slice(2) : input.publicKey;
  const contractSignature = await normalizeSafeSignature(bitcoinSignature, publicKey);
  const signature = encodeSafeContractSignature(input.owner, contractSignature);
  return serializeErc6492Signature({
    address: ORANGEKIT_SAFE_FACTORY,
    data: encodeFunctionData({ abi: orangeKitSafeFactoryAbi, functionName: "deploySafe", args: [input.truncatedBitcoinAddress] }),
    signature,
  });
}

/** Clé publique secp256k1 compressée (33 octets) depuis sa forme non compressée (65 octets). */
export function compressPublicKey(uncompressed: Hex): Hex {
  const bytes = toBytes(uncompressed);
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("Clé publique non compressée attendue.");
  const prefix = bytes[64] % 2 === 1 ? 3 : 2;
  return toHex(new Uint8Array([prefix, ...bytes.slice(1, 33)]));
}
