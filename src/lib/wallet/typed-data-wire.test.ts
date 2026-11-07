import assert from "node:assert/strict";
import { test } from "node:test";
import { getTypesForEIP712Domain, serializeTypedData, type TypedDataDomain } from "viem";
import { lockRequestTypedData, musdPermitTypedData } from "@/lib/evm/lock-request";
import { withdrawMusdTypedData } from "@/lib/mezo/draw-typed-data";
import { typedDataJsonForWallet } from "./typed-data-wire";

const request = {
  borrower: `0x${"11".repeat(20)}`,
  provider: `0x${"22".repeat(20)}`,
  amount: BigInt("2000000000000000000"),
  hashlock: `0x${"33".repeat(32)}` as const,
  challengeDays: 7,
  loanIdHash: `0x${"44".repeat(32)}` as const,
  datasetId: `0x${"55".repeat(32)}` as const,
  trainingProfile: `0x${"66".repeat(32)}` as const,
  nonce: BigInt(3),
  deadline: BigInt(1_900_000_000),
};

const payloads = {
  lockRequest: lockRequestTypedData({ chainId: 31611, escrow: `0x${"77".repeat(20)}`, request }),
  permit: musdPermitTypedData({
    chainId: 31611, token: `0x${"88".repeat(20)}`, tokenName: "Mezo USD", tokenVersion: "1",
    owner: request.borrower, spender: `0x${"77".repeat(20)}`, value: request.amount, nonce: BigInt(0), deadline: request.deadline,
  }),
  withdrawMusd: withdrawMusdTypedData({
    chainId: 31611, verifyingContract: `0x${"99".repeat(20)}`, amount: request.amount,
    borrower: `0x${"11".repeat(20)}`, recipient: `0x${"11".repeat(20)}`, nonce: BigInt(1), deadline: request.deadline,
  }),
};

/** Ce que `signTypedData` de viem envoie au wallet (actions/wallet/signTypedData.ts). */
function viaViemSignTypedData(payload: { domain: TypedDataDomain; types: object }) {
  return serializeTypedData({ ...payload, types: { EIP712Domain: getTypesForEIP712Domain({ domain: payload.domain }), ...payload.types } } as never);
}

for (const [name, payload] of Object.entries(payloads)) {
  test(`données typées pour le wallet (${name}) : identiques à la sérialisation de viem, domaine EIP-712 déclaré`, () => {
    const actual = JSON.parse(typedDataJsonForWallet(payload)) as { types: Record<string, unknown>; domain: Record<string, unknown> };
    // Sans `EIP712Domain` dans `types`, MetaMask hache le domaine comme une structure vide :
    // la signature ne correspond plus au digest du contrat (`InvalidBorrowerSignature`).
    assert.deepEqual(actual.types.EIP712Domain, [
      { name: "name", type: "string" }, { name: "version", type: "string" },
      { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
    ]);
    assert.equal(actual.domain.chainId, 31611);
    assert.deepEqual(actual, JSON.parse(viaViemSignTypedData(payload)));
  });
}

test("données typées déjà sérialisées (entiers en chaînes, sans EIP712Domain) : même résultat", () => {
  const wire = JSON.parse(JSON.stringify(payloads.lockRequest, (_key, value) => typeof value === "bigint" ? value.toString() : value));
  assert.deepEqual(JSON.parse(typedDataJsonForWallet(wire)), JSON.parse(viaViemSignTypedData(payloads.lockRequest as never)));
});
