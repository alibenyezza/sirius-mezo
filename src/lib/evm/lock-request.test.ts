import assert from "node:assert/strict";
import { test } from "node:test";
import { concatHex, hashTypedData, keccak256, recoverTypedDataAddress, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  LOCK_REQUEST_TYPE_STRING, NO_PERMIT, eip712DomainSeparator, lockRequestDigest, lockRequestStructHash,
  lockRequestTypedData, musdPermitTypedData, permitFromSignature, type LockRequest,
} from "./lock-request";

// Compte déterministe : la clé n'a aucune valeur, elle ne sert qu'au test.
const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const account = privateKeyToAccount(PRIVATE_KEY);
const ESCROW = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x3333333333333333333333333333333333333333";
const CHAIN_ID = 31611;

const REQUEST: LockRequest = {
  borrower: account.address,
  provider: "0x2222222222222222222222222222222222222222",
  amount: BigInt("25000000000000000000"),
  hashlock: keccak256(toHex("hashlock")),
  challengeDays: 7,
  loanIdHash: keccak256(toHex("loan")),
  datasetId: keccak256(toHex("dataset")),
  trainingProfile: keccak256(toHex("sirius.training-profile.v1:linear_regression:1.0.0")),
  nonce: BigInt(0),
  deadline: BigInt(1_800_000_000),
};

/**
 * Vecteur figé. `LOCK_REQUEST_TYPEHASH` est la constante Solidity de `SiriusEscrow.sol` ;
 * le digest est celui que le contrat passe à `ecrecover`. La preuve côté chaîne est dans
 * `contracts/test/escrow-signature.test.ts`, qui signe avec ce même helper et fait
 * accepter la signature par le contrat compilé.
 */
const LOCK_REQUEST_TYPEHASH = "0x77c3737a42420ef84e4a1f05c41efffb133f0d7e3b13d9bcb5046e736b6171b9";
const EXPECTED_DIGEST = "0x30da540d78cd9e1cc9344b6136e311bdee3668f56c32a11f23b2f197703c06e3";

test("la signature du borrower se recompose à son adresse", async () => {
  const typedData = lockRequestTypedData({ chainId: CHAIN_ID, escrow: ESCROW, request: REQUEST });
  const signature = await account.signTypedData(typedData);
  assert.equal(await recoverTypedDataAddress({ ...typedData, signature }), account.address);

  // Un autre escrow, une autre chaîne ou un autre champ : l'adresse recomposée change.
  for (const variant of [
    lockRequestTypedData({ chainId: CHAIN_ID, escrow: TOKEN, request: REQUEST }),
    lockRequestTypedData({ chainId: 31612, escrow: ESCROW, request: REQUEST }),
    lockRequestTypedData({ chainId: CHAIN_ID, escrow: ESCROW, request: { ...REQUEST, amount: REQUEST.amount + BigInt(1) } }),
    lockRequestTypedData({ chainId: CHAIN_ID, escrow: ESCROW, request: { ...REQUEST, nonce: BigInt(1) } }),
  ]) {
    assert.notEqual(await recoverTypedDataAddress({ ...variant, signature }), account.address);
  }
});

test("le hashStruct et le digest reproduisent le calcul du contrat", () => {
  assert.equal(keccak256(toHex(LOCK_REQUEST_TYPE_STRING)), LOCK_REQUEST_TYPEHASH);
  const typedData = lockRequestTypedData({ chainId: CHAIN_ID, escrow: ESCROW, request: REQUEST });

  // Recomposition manuelle « à la Solidity » : 0x1901 ‖ domainSeparator ‖ keccak256(abi.encode(TYPEHASH, request)).
  const manual = keccak256(concatHex([
    "0x1901",
    eip712DomainSeparator("SiriusEscrow", "6", CHAIN_ID, ESCROW),
    lockRequestStructHash(REQUEST),
  ]));
  assert.equal(manual, EXPECTED_DIGEST);
  assert.equal(hashTypedData(typedData), EXPECTED_DIGEST);
  assert.equal(lockRequestDigest({ chainId: CHAIN_ID, escrow: ESCROW, request: REQUEST }), EXPECTED_DIGEST);
});

test("les adresses sont normalisées en EIP-55 avant signature", () => {
  const lower = lockRequestTypedData({
    chainId: CHAIN_ID, escrow: ESCROW.toLowerCase(),
    request: { ...REQUEST, borrower: REQUEST.borrower.toLowerCase(), provider: REQUEST.provider.toLowerCase() },
  });
  assert.equal(hashTypedData(lower), EXPECTED_DIGEST);
  assert.equal(lower.message.borrower, account.address);
});

test("le permit ERC-2612 se signe sous le domaine du jeton et se recompose au propriétaire", async () => {
  const typedData = musdPermitTypedData({
    chainId: CHAIN_ID, token: TOKEN, tokenName: "Mezo USD", tokenVersion: "1",
    owner: account.address, spender: ESCROW, value: BigInt(25), nonce: BigInt(0), deadline: BigInt(1_800_000_000),
  });
  assert.equal(typedData.domain.name, "Mezo USD");
  assert.equal(typedData.domain.verifyingContract, TOKEN);
  assert.deepEqual(typedData.types.Permit.map((field) => `${field.type} ${field.name}`), [
    "address owner", "address spender", "uint256 value", "uint256 nonce", "uint256 deadline",
  ]);
  const signature = await account.signTypedData(typedData);
  assert.equal(await recoverTypedDataAddress({ ...typedData, signature }), account.address);

  // Struct Permit attendu par le contrat : v ∈ {27, 28}, r et s sur 32 octets.
  const permit = permitFromSignature(signature, BigInt(25), BigInt(1_800_000_000));
  assert.ok(permit.v === 27 || permit.v === 28);
  assert.equal(permit.r.length, 66);
  assert.equal(permit.s.length, 66);
  assert.equal(permit.value, BigInt(25));
  assert.equal(permit.deadline, BigInt(1_800_000_000));
  assert.equal(concatHex([permit.r, permit.s, toHex(permit.v, { size: 1 })]), signature as Hex);
  assert.equal(NO_PERMIT.deadline, BigInt(0));
});
