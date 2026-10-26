// Invitation et révocation KYB pendant la bêta mainnet. À lancer sur un poste d'opérateur,
// jamais sur un serveur : la clé du vérificateur reste dans un fichier local.
//
// Émettre une invitation (aucune transaction, lecture seule de la chaîne) :
//   EVM_NETWORK=mainnet EVM_RPC_URL=… SIRIUS_KYB_ADDRESS=0x… \
//   node --conditions=react-server --import tsx scripts/operations/kyb-invite.ts invite 0xPARTENAIRE --key-file=./verifier.key [--days=90]
//
// Révoquer l'attestation d'un partenaire (transaction signée par le vérificateur émetteur) :
//   … kyb-invite.ts revoke 0xPARTENAIRE --key-file=./verifier.key --confirm
//
// Le fichier de clé contient une seule ligne : la clé privée hexadécimale (0x + 64 caractères).
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, getAddress, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { siriuskybregistryAbi } from "../../src/lib/evm/abi/siriuskybregistry";
import { mezoMainnet, mezoTestnet } from "../../src/lib/evm/networks";
import { encodeKybInvitation, invitationSigner, kybAttestationTypedData, MAX_INVITATION_DAYS } from "../../src/lib/kyb/invitation";

function option(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const [command, subjectRaw, ...args] = process.argv.slice(2);
  const network = process.env.EVM_NETWORK?.trim();
  const rpc = process.env.EVM_RPC_URL?.trim();
  const registryRaw = process.env.SIRIUS_KYB_ADDRESS?.trim();
  if (!["invite", "revoke"].includes(command ?? "") || !subjectRaw || !isAddress(subjectRaw)) throw new Error("Usage : invite|revoke 0xADRESSE --key-file=…");
  if ((network !== "mainnet" && network !== "testnet") || !rpc || !registryRaw || !isAddress(registryRaw)) {
    throw new Error("EVM_NETWORK, EVM_RPC_URL et SIRIUS_KYB_ADDRESS requis");
  }
  const keyFile = option(args, "key-file");
  if (!keyFile) throw new Error("--key-file requis");
  const key = readFileSync(keyFile, "utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Fichier de clé invalide : une clé hexadécimale attendue");
  const verifier = privateKeyToAccount(key as Hex);
  const chain = network === "mainnet" ? mezoMainnet : mezoTestnet;
  const subject = getAddress(subjectRaw);
  const registry = getAddress(registryRaw);
  const client = createPublicClient({ chain, transport: http(rpc, { timeout: 15000, retryCount: 1 }) });
  if (await client.getChainId() !== chain.id) throw new Error("RPC sur un autre réseau");
  const read = <T>(functionName: string, account: string) =>
    client.readContract({ address: registry, abi: siriuskybregistryAbi, functionName: functionName as never, args: [account as Hex] as never }) as Promise<T>;

  const [version, active] = await Promise.all([
    client.readContract({ address: registry, abi: siriuskybregistryAbi, functionName: "VERSION" }),
    read<boolean>("isVerifier", verifier.address),
  ]);
  if (version !== "sirius-kyb-v3") throw new Error(`Registre KYB inattendu : ${version}`);
  if (!active) throw new Error(`${verifier.address} n'est pas un vérificateur actif de ce registre`);

  if (command === "revoke") {
    if (!args.includes("--confirm")) throw new Error("Révocation : ajoute --confirm après avoir vérifié l'adresse");
    const wallet = createWalletClient({ account: verifier, chain, transport: http(rpc) });
    const hash = await wallet.writeContract({ address: registry, abi: siriuskybregistryAbi, functionName: "revoke", args: [subject] });
    const receipt = await client.waitForTransactionReceipt({ hash });
    console.log(JSON.stringify({ revoked: subject, txHash: hash, status: receipt.status }));
    return;
  }

  const days = Number(option(args, "days") ?? 90);
  if (!Number.isInteger(days) || days < 1 || days > MAX_INVITATION_DAYS) throw new Error(`--days entre 1 et ${MAX_INVITATION_DAYS}`);
  const [epoch, nonce, valid] = await Promise.all([
    read<bigint>("verifierEpoch", verifier.address), read<bigint>("nonces", subject), read<boolean>("isKybValid", subject),
  ]);
  if (valid) console.error(`Avertissement : ${subject} a déjà un KYB valide ; l'invitation le remplacera.`);
  const fields = {
    chainId: chain.id, registry, subject, verifier: getAddress(verifier.address),
    expiresAt: Math.floor(Date.now() / 1000) + days * 86_400, nonce: nonce.toString(), verifierEpoch: epoch.toString(),
  };
  const signature = await verifier.signTypedData(kybAttestationTypedData(fields));
  const invitation = { v: 1 as const, ...fields, signature };
  if (getAddress(await invitationSigner(invitation)) !== invitation.verifier) throw new Error("Auto-vérification de la signature échouée");
  console.log(JSON.stringify({ subject, verifier: invitation.verifier, network, expiresAt: new Date(fields.expiresAt * 1000).toISOString() }));
  console.log(encodeKybInvitation(invitation));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Invitation KYB refusée");
  process.exitCode = 1;
});
