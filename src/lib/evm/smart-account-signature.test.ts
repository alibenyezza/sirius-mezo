import assert from "node:assert/strict";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { AppError } from "@/lib/app-error";
import {
  contractSignatureShape,
  resetContractSignatureCache,
  verifyWalletOrContractSignature,
  type ContractSignatureCheck,
} from "./smart-account-signature";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const ADDRESS = account.address.toLowerCase();
const SAFE = "0x3333333333333333333333333333333333333333";
const MESSAGE = "Sirius authentication\nNetwork: testnet";
// Une enveloppe ERC-6492 quelconque : ce qui compte ici est sa taille, pas son contenu.
const CONTRACT_SIGNATURE = `0x${"ab".repeat(300)}`;
const enabled = () => true;
const disabled = () => false;
const unauthorized = (error: unknown) => error instanceof AppError && error.status === 401;

test("la forme d'une signature contractuelle : plus de 65 octets, au plus 4096", () => {
  assert.equal(contractSignatureShape(`0x${"ab".repeat(65)}`), null);
  assert.equal(contractSignatureShape(`0x${"ab".repeat(66)}`), `0x${"ab".repeat(66)}`);
  assert.equal(contractSignatureShape(`0x${"ab".repeat(4096)}`), `0x${"ab".repeat(4096)}`);
  assert.equal(contractSignatureShape(`0x${"ab".repeat(4097)}`), null);
  assert.equal(contractSignatureShape("0xabc"), null);
  assert.equal(contractSignatureShape(`0x${"zz".repeat(100)}`), null);
  assert.equal(contractSignatureShape(null), null);
});

test("sans le drapeau, rien ne change : vérification EOA pure, aucun vérificateur appelé", async () => {
  resetContractSignatureCache();
  let calls = 0;
  const verify = async () => {
    calls += 1;
    return true;
  };
  const signature = await account.signMessage({ message: MESSAGE });
  assert.equal(
    await verifyWalletOrContractSignature({ address: ADDRESS, message: MESSAGE, signature }, { enabled: disabled, verify }),
    ADDRESS,
  );
  await assert.rejects(
    verifyWalletOrContractSignature({ address: SAFE, message: MESSAGE, signature: CONTRACT_SIGNATURE }, { enabled: disabled, verify }),
    unauthorized,
  );
  assert.equal(calls, 0);
});

test("avec le drapeau, une EOA valide n'interroge pas la chaîne ; un smart account, si", async () => {
  resetContractSignatureCache();
  const seen: ContractSignatureCheck[] = [];
  const verify = async (check: ContractSignatureCheck) => {
    seen.push(check);
    return true;
  };
  const signature = await account.signMessage({ message: MESSAGE });
  assert.equal(await verifyWalletOrContractSignature({ address: ADDRESS, message: MESSAGE, signature }, { enabled, verify }), ADDRESS);
  assert.equal(seen.length, 0);
  assert.equal(
    await verifyWalletOrContractSignature({ address: SAFE, message: MESSAGE, signature: CONTRACT_SIGNATURE }, { enabled, verify }),
    SAFE,
  );
  // L'adresse revendiquée est normalisée avant d'être soumise au compte.
  assert.equal(
    await verifyWalletOrContractSignature(
      { address: SAFE.toUpperCase().replace("0X", "0x"), message: `${MESSAGE}2`, signature: CONTRACT_SIGNATURE },
      { enabled, verify },
    ),
    SAFE,
  );
  assert.deepEqual(seen, [
    { address: SAFE, message: MESSAGE, signature: CONTRACT_SIGNATURE },
    { address: SAFE, message: `${MESSAGE}2`, signature: CONTRACT_SIGNATURE },
  ]);
});

test("une signature de 65 octets qui ne correspond pas reste refusée localement, même avec le drapeau", async () => {
  resetContractSignatureCache();
  let calls = 0;
  const verify = async () => {
    calls += 1;
    return true;
  };
  const signature = await account.signMessage({ message: MESSAGE });
  await assert.rejects(
    verifyWalletOrContractSignature({ address: SAFE, message: MESSAGE, signature }, { enabled, verify }),
    unauthorized,
  );
  await assert.rejects(
    verifyWalletOrContractSignature({ address: ADDRESS, message: `${MESSAGE}!`, signature }, { enabled, verify }),
    unauthorized,
  );
  await assert.rejects(
    verifyWalletOrContractSignature({ address: "pas-une-adresse", message: MESSAGE, signature: CONTRACT_SIGNATURE }, { enabled, verify }),
    unauthorized,
  );
  assert.equal(calls, 0);
});

test("refus du compte → 401, chaîne injoignable → 503, et un succès est mémorisé", async () => {
  resetContractSignatureCache();
  const input = { address: SAFE, message: MESSAGE, signature: CONTRACT_SIGNATURE };
  await assert.rejects(verifyWalletOrContractSignature(input, { enabled, verify: async () => false }), unauthorized);
  await assert.rejects(
    verifyWalletOrContractSignature(input, {
      enabled,
      verify: async () => {
        throw new Error("rpc hors ligne");
      },
    }),
    (error: unknown) => error instanceof AppError && error.status === 503,
  );
  let calls = 0;
  const verify = async () => {
    calls += 1;
    return true;
  };
  assert.equal(await verifyWalletOrContractSignature(input, { enabled, verify }), SAFE);
  assert.equal(await verifyWalletOrContractSignature(input, { enabled, verify }), SAFE);
  assert.equal(calls, 1);
  // Un autre message ou une autre signature n'hérite pas du souvenir.
  assert.equal(await verifyWalletOrContractSignature({ ...input, message: `${MESSAGE}3` }, { enabled, verify }), SAFE);
  assert.equal(calls, 2);
});
