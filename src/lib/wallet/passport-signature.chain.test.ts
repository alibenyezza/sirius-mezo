import assert from "node:assert/strict";
import { test } from "node:test";
import { hashMessage, ripemd160, sha256 } from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import { AppError } from "@/lib/app-error";
import {
  ORANGEKIT_SAFE_FACTORY,
  bitcoinMessageHash,
  buildPassportSignature,
  compressPublicKey,
  orangeKitSafeFactoryAbi,
} from "./passport-signature";

/**
 * Contrôle sur le testnet Mezo, à la demande : SIRIUS_PASSPORT_CHAIN_CHECK=true.
 *
 * Une clé de test joue le wallet Bitcoin ; son smart account n'est jamais déployé. Le
 * vérificateur ERC-6492 simule le déploiement dans un `eth_call`, puis le Safe interroge
 * son `BitcoinSafeOwner` : c'est le chemin exact qu'emprunte la connexion d'un utilisateur
 * Passport, sans extension ni navigateur. Hors de la suite par défaut : il dépend du réseau.
 */
const RUN = process.env.SIRIUS_PASSPORT_CHAIN_CHECK === "true";
const PRIVATE_KEY = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d" as const;

test(
  "un compte Passport non déployé signe un message que le testnet Mezo valide (ERC-1271 + ERC-6492)",
  { skip: RUN ? false : "SIRIUS_PASSPORT_CHAIN_CHECK=true pour interroger le testnet Mezo" },
  async () => {
    process.env.EVM_NETWORK = "testnet";
    process.env.NEXT_PUBLIC_MEZO_PASSPORT = "true";
    const { getPublicClient } = await import("@/lib/evm/client");
    const { verifyLoginSignature, verifyWalletOrContractSignature } = await import("@/lib/evm/smart-account-signature");

    const account = privateKeyToAccount(PRIVATE_KEY);
    const compressed = compressPublicKey(account.publicKey);
    const truncated = ripemd160(sha256(compressed));
    const client = getPublicClient();
    const [safe, owner] = await client.readContract({
      address: ORANGEKIT_SAFE_FACTORY,
      abi: orangeKitSafeFactoryAbi,
      functionName: "predictAddresses",
      args: [truncated],
    });
    const code = await client.getCode({ address: safe });
    console.log(`safe=${safe} owner=${owner} deployed=${Boolean(code)} chainId=${client.chain?.id}`);

    const message = [
      "Sirius authentication",
      "Domain: http://localhost:3000",
      `Address: ${safe.toLowerCase()}`,
      "Runner session key: dGVzdC1zZXNzaW9uLWtleQ",
      "Network: testnet",
      "Challenge: header.signature",
    ].join("\n");
    const signature = await buildPassportSignature({
      message,
      safe,
      chainId: client.chain!.id,
      owner,
      truncatedBitcoinAddress: truncated,
      publicKey: compressed.slice(2),
      signBitcoinMessage: async (text) => {
        const { r, s, yParity } = await sign({ hash: bitcoinMessageHash(text), privateKey: PRIVATE_KEY });
        return `0x${(39 + (yParity ?? 0)).toString(16)}${r.slice(2)}${s.slice(2)}`;
      },
    });
    console.log(`signature bytes=${(signature.length - 2) / 2} eip191=${hashMessage(message)}`);

    // viem directement, puis le chemin serveur (connexion et délégation runner).
    assert.equal(await client.verifyMessage({ address: safe, message, signature }), true);
    assert.equal(await verifyWalletOrContractSignature({ address: safe, message, signature }), safe.toLowerCase());
    assert.equal(await verifyLoginSignature({ address: safe, message, signature }), safe.toLowerCase());

    // Message altéré ou compte usurpé : refusé par la chaîne, 401 côté serveur.
    assert.equal(await client.verifyMessage({ address: safe, message: `${message}!`, signature }), false);
    await assert.rejects(
      verifyWalletOrContractSignature({ address: safe, message: `${message}!`, signature }),
      (error: unknown) => error instanceof AppError && error.status === 401,
    );
    await assert.rejects(
      verifyWalletOrContractSignature({ address: owner, message, signature }),
      (error: unknown) => error instanceof AppError && error.status === 401,
    );
  },
);
