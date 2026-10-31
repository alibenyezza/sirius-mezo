import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeFunctionData,
  hashMessage,
  hashTypedData,
  hexToBytes,
  parseErc6492Signature,
  recoverAddress,
  ripemd160,
  sha256,
  stringToBytes,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import {
  ORANGEKIT_SAFE_FACTORY,
  bitcoinMessageHash,
  buildPassportSignature,
  compressPublicKey,
  encodeSafeContractSignature,
  orangeKitSafeFactoryAbi,
  safeMessageHash,
} from "./passport-signature";

// Clé de test sans valeur : elle joue le rôle du wallet Bitcoin.
const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const SAFE = "0x1111111111111111111111111111111111111111" as const;
const OWNER = "0x2222222222222222222222222222222222222222" as const;
const CHAIN_ID = 31611;

/** HASH160 = RIPEMD160(SHA256(x)), la dérivation d'adresse Bitcoin que le contrat refait. */
function hash160(bytes: Hex): Hex {
  return ripemd160(sha256(bytes));
}

/** Un wallet Bitcoin P2WPKH : signature ECDSA du hash « Bitcoin Signed Message », v en tête dans la plage 39-40. */
async function signLikeBitcoinWallet(text: string): Promise<string> {
  const { r, s, yParity } = await sign({ hash: bitcoinMessageHash(text), privateKey: PRIVATE_KEY });
  return `0x${(39 + (yParity ?? 0)).toString(16)}${r.slice(2).padStart(64, "0")}${s.slice(2).padStart(64, "0")}`;
}

test("le condensé Safe est celui d'un SafeMessage EIP-712 (Safe v1.4.1)", () => {
  const dataHash = hashMessage("Sirius authentication");
  const expected = hashTypedData({
    domain: { chainId: CHAIN_ID, verifyingContract: SAFE },
    types: { SafeMessage: [{ name: "message", type: "bytes" }] },
    primaryType: "SafeMessage",
    message: { message: dataHash },
  });
  assert.equal(safeMessageHash({ safe: SAFE, chainId: CHAIN_ID, dataHash }), expected);
  // Le chainId et l'adresse du Safe entrent dans le domaine : les changer change le condensé.
  assert.notEqual(safeMessageHash({ safe: SAFE, chainId: 31612, dataHash }), expected);
  assert.notEqual(safeMessageHash({ safe: OWNER, chainId: CHAIN_ID, dataHash }), expected);
});

test("l'enveloppe Safe désigne le propriétaire puis une signature contractuelle de 129 octets", () => {
  const contractSignature = `81${"ab".repeat(129)}`;
  const bytes = hexToBytes(encodeSafeContractSignature(OWNER, contractSignature));
  assert.equal(bytes.length, 226);
  // {r: propriétaire}{s: position 65}{v: 0} puis la longueur 129 sur 32 octets et les données.
  assert.equal(toHex(bytes.slice(12, 32)), OWNER);
  assert.equal(BigInt(toHex(bytes.slice(32, 64))), BigInt(65));
  assert.equal(bytes[64], 0);
  assert.equal(BigInt(toHex(bytes.slice(65, 97))), BigInt(129));
  assert.equal(toHex(bytes.slice(97)), `0x${"ab".repeat(129)}`);
  assert.throws(() => encodeSafeContractSignature(OWNER, "ab"), /normalisée invalide/);
});

test("la signature Passport est vérifiable comme le fait BitcoinSafeOwner, et enveloppée ERC-6492", async () => {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const compressed = compressPublicKey(account.publicKey);
  const truncated = hash160(compressed);
  const message = "Sirius authentication\nNetwork: testnet";
  const signed: string[] = [];
  const wrapped = await buildPassportSignature({
    message,
    safe: SAFE,
    chainId: CHAIN_ID,
    owner: OWNER,
    truncatedBitcoinAddress: truncated,
    publicKey: compressed.slice(2),
    signBitcoinMessage: (text) => {
      signed.push(text);
      return signLikeBitcoinWallet(text);
    },
  });

  // Le wallet signe le condensé Safe du hash EIP-191 du message, en hexadécimal sans 0x.
  const digest = safeMessageHash({ safe: SAFE, chainId: CHAIN_ID, dataHash: hashMessage(message) });
  assert.deepEqual(signed, [digest.slice(2)]);

  // ERC-6492 : la fabrique OrangeKit, l'appel de déploiement du Safe, puis la signature Safe.
  const { address: factory, data, signature } = parseErc6492Signature(wrapped);
  assert.equal(factory, ORANGEKIT_SAFE_FACTORY);
  assert.ok(data);
  assert.deepEqual(decodeFunctionData({ abi: orangeKitSafeFactoryAbi, data }), { functionName: "deploySafe", args: [truncated] });

  // Ce que vérifie le contrat : v ≥ 128 (texte hexadécimal), plage 39-40 (P2WPKH), ecrecover, hash160.
  const bytes = hexToBytes(signature);
  assert.equal(toHex(bytes.slice(12, 32)), OWNER);
  const contractSignature = bytes.slice(97);
  assert.equal(contractSignature.length, 129);
  const r = toHex(contractSignature.slice(0, 32));
  const s = toHex(contractSignature.slice(32, 64));
  const v = contractSignature[64];
  assert.ok(v >= 128, "le bit haut de v demande au contrat de signer le texte hexadécimal");
  const bitcoinV = v - 128;
  assert.ok(bitcoinV === 39 || bitcoinV === 40, `v Bitcoin hors plage P2WPKH : ${bitcoinV}`);
  const uncompressed = toHex(new Uint8Array([4, ...contractSignature.slice(65, 129)]));
  assert.equal(uncompressed, account.publicKey);
  const recovered = await recoverAddress({
    hash: bitcoinMessageHash(digest.slice(2)),
    signature: { r, s, v: BigInt(bitcoinV - 12) },
  });
  assert.equal(recovered, account.address);
  assert.equal(hash160(compressPublicKey(uncompressed)), truncated);
});

test("le hash d'un message Bitcoin est le double SHA-256 du préfixe, du varint et du texte", () => {
  const text = "a".repeat(64);
  const preimage = new Uint8Array([...stringToBytes("\u0018Bitcoin Signed Message:\n"), 0x40, ...stringToBytes(text)]);
  assert.equal(bitcoinMessageHash(text), sha256(sha256(preimage)));
  assert.notEqual(bitcoinMessageHash(text), bitcoinMessageHash(`${text}b`));
});

test("la compression de clé publique garde x et code la parité de y", () => {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const compressed = compressPublicKey(account.publicKey);
  assert.equal(compressed.length, 2 + 66);
  assert.equal(compressed.slice(4), account.publicKey.slice(4, 68));
  assert.ok(compressed.startsWith("0x02") || compressed.startsWith("0x03"));
  assert.throws(() => compressPublicKey(compressed), /non compressée attendue/);
});
