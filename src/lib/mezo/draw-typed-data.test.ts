import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodeAbiParameters,
  hashStruct,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  toHex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { musdProtocol } from "./protocol";
import {
  WITHDRAW_MUSD_TYPE_STRING,
  WITHDRAW_MUSD_TYPEHASH,
  withdrawMusdTypedData,
  withdrawMusdTypes,
} from "./draw-typed-data";

// Compte déterministe : la clé n'a aucune valeur, elle ne sert qu'au test.
const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const signer = privateKeyToAccount(PRIVATE_KEY);
const RECIPIENT: Address = "0x1111111111111111111111111111111111111111";
const VERIFYING = musdProtocol("testnet").borrowerOperationsSignatures;

const input = {
  chainId: 31611,
  verifyingContract: VERIFYING,
  amount: BigInt(10) * BigInt(10) ** BigInt(18),
  borrower: signer.address,
  recipient: RECIPIENT,
  nonce: BigInt(0),
  deadline: BigInt(1_800_000_000),
};

describe("withdrawMusdTypedData", () => {
  it("le type hash est celui du contrat BorrowerOperationsSignatures", () => {
    assert.equal(keccak256(toHex(WITHDRAW_MUSD_TYPE_STRING)), WITHDRAW_MUSD_TYPEHASH);
    assert.equal(WITHDRAW_MUSD_TYPEHASH, "0x7b2d4b9993925281c28bad62320bf41cf88086cf7b75457ab8f922fc0edcc14a");
  });

  it("construit le domaine et le message attendus, sans les hints d'insertion", () => {
    const payload = withdrawMusdTypedData(input);
    assert.deepEqual(payload.domain, {
      name: "BorrowerOperationsSignatures",
      version: "1",
      chainId: 31611,
      verifyingContract: VERIFYING,
    });
    assert.equal(payload.primaryType, "WithdrawMUSD");
    assert.deepEqual(payload.types, withdrawMusdTypes);
    assert.deepEqual(Object.keys(payload.message), ["amount", "borrower", "recipient", "nonce", "deadline"]);
    assert.deepEqual(payload.message, {
      amount: input.amount,
      borrower: signer.address,
      recipient: RECIPIENT,
      nonce: BigInt(0),
      deadline: input.deadline,
    });
  });

  it("hashStruct égale keccak256(abi.encode(TYPEHASH, amount, borrower, recipient, nonce, deadline))", () => {
    const payload = withdrawMusdTypedData(input);
    const expected = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
        [WITHDRAW_MUSD_TYPEHASH, input.amount, input.borrower, input.recipient, input.nonce, input.deadline],
      ),
    );
    assert.equal(hashStruct({ data: payload.message, primaryType: "WithdrawMUSD", types: payload.types }), expected);
  });

  it("une signature du payload est recouvrée au signataire", async () => {
    const payload = withdrawMusdTypedData(input);
    const signature = await signer.signTypedData(payload);
    const recovered = await recoverTypedDataAddress({ ...payload, signature });
    assert.equal(recovered, signer.address);
  });

  it("changer le nonce, la chaîne ou le contrat vérifieur change le digest", () => {
    const base = hashTypedData(withdrawMusdTypedData(input));
    assert.notEqual(hashTypedData(withdrawMusdTypedData({ ...input, nonce: BigInt(1) })), base);
    assert.notEqual(hashTypedData(withdrawMusdTypedData({ ...input, chainId: 31612 })), base);
    assert.notEqual(
      hashTypedData(withdrawMusdTypedData({ ...input, verifyingContract: musdProtocol("mainnet").borrowerOperationsSignatures })),
      base,
    );
  });

  it("refuse une chaîne ou des entiers invalides", () => {
    assert.throws(() => withdrawMusdTypedData({ ...input, chainId: 0 }), RangeError);
    assert.throws(() => withdrawMusdTypedData({ ...input, amount: BigInt(-1) }), RangeError);
    assert.throws(() => withdrawMusdTypedData({ ...input, deadline: BigInt(-1) }), RangeError);
  });
});
