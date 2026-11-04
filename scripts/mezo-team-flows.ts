/**
 * Parcours Mezo de l'équipe sur le testnet, de bout en bout, avec des wallets de test jetables.
 *
 *   node --import tsx scripts/mezo-team-flows.ts            # lecture et simulation, rien n'est envoyé
 *   node --import tsx scripts/mezo-team-flows.ts --send     # envoie les transactions
 *
 * 1. Paiement en une signature : un acheteur jetable qui n'a que du MUSD signe un permit et une
 *    LockRequest ; le compte de règlement soumet `lockWithSignature` et paie le gas.
 * 2. Pay with BTC : un second acheteur jetable qui n'a que du BTC appelle `SiriusCheckout.buyWithBtc`
 *    (swap Mezo Pools sous l'oracle, puis lock dans la même transaction).
 * 3. Les deux prêts sont libérés (frais de 2 % retenus) et le fournisseur de démo retire ses MUSD.
 * 4. Gains au travail : le fournisseur de démo dépose 1 MUSD dans le Stability Pool de Mezo.
 *
 * Wallets : le déployeur finance les acheteurs, le compte de règlement autorise et relaie, le
 * fournisseur de démo possède le dataset. Clés lues dans .env.local, jamais affichées. Les
 * acheteurs jetables sont des wallets de l'équipe : leurs transactions vont dans « team » sur /proof.
 * Ensuite : `scripts/mezo-distribute-fees.ts --send` pour verser les frais au gauge.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  createPublicClient, createWalletClient, erc20Abi, formatEther, http, parseAbi, parseEther, parseUnits,
  type Address, type Hex, type PrivateKeyAccount,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { EVM_CHAINS } from "../src/lib/evm/networks";
import { siriusescrowAbi } from "../src/lib/evm/abi/siriusescrow";
import { siriuscheckoutAbi } from "../src/lib/evm/abi/siriuscheckout";
import { datasetIdHash } from "../src/lib/evm/dataset-key";
import { hashlockOf, loanIdHash, loanKeyFor } from "../src/lib/evm/loan-key";
import { lockAuthorizationTypedData } from "../src/lib/evm/lock-authorization";
import { lockRequestTypedData, musdPermitTypedData, normalizeLockRequest, permitFromSignature, type LockRequest } from "../src/lib/evm/lock-request";
import { DEFAULT_MODEL_SELECTION, trainingProfileHash } from "../src/lib/models/registry";
import { BTC_TOKEN_ADDRESS, MEZO_CHECKOUT_TESTNET, musdProtocol } from "../src/lib/mezo/protocol";
import { btcCheckoutQuote } from "../src/lib/mezo/btc-checkout-math";
import { stabilityPoolAbi } from "../src/lib/mezo/earn-abi";

const ROOT = resolve(__dirname, "..");
const SEND = process.argv.includes("--send");
const PRICE = parseUnits("2", 18);
const SP_DEPOSIT = parseUnits("1", 18);
const CHALLENGE_DAYS = 7;

function loadEnv() {
  try {
    for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
    }
  } catch {
    // .env.local absent : les variables d'environnement suffisent.
  }
}

function key(name: string): Hex {
  const value = process.env[name]?.trim();
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} absente ou invalide dans .env.local`);
  return value as Hex;
}

const permitDomainAbi = parseAbi([
  "function nonces(address owner) view returns (uint256)",
  "function name() view returns (string)",
  "function eip712Domain() view returns (bytes1, string, string, uint256, address, bytes32, uint256[])",
]);
const routerAbi = parseAbi([
  "struct Route { address from; address to; bool stable; address factory; }",
  "function getAmountsOut(uint256 amountIn, Route[] routes) view returns (uint256[] amounts)",
]);

async function main() {
  loadEnv();
  const chain = EVM_CHAINS.testnet;
  const transport = http(process.env.EVM_RPC_URL || chain.rpcUrls.default.http[0]);
  const client = createPublicClient({ chain, transport });
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "deployments", "mezo-testnet.json"), "utf8")) as {
    chainId: number;
    explorer: string;
    lockAuthorizer: Address;
    settlementToken: { address: Address };
    contracts: { escrow: Address; datasets: Address; checkout: Address };
    demo: { provider: Address; datasetId: string };
  };
  if (manifest.chainId !== chain.id) throw new Error("Le manifeste ne vise pas Mezo testnet");
  const { escrow, datasets, checkout } = manifest.contracts;
  const musd = manifest.settlementToken.address;

  const deployer = privateKeyToAccount(key("MEZO_DEPLOYER_KEY"));
  const settlement = privateKeyToAccount(key("SIRIUS_SETTLEMENT_KEY"));
  const provider = privateKeyToAccount(key("SIRIUS_DEMO_PROVIDER_KEY"));
  if (settlement.address.toLowerCase() !== manifest.lockAuthorizer.toLowerCase()) throw new Error("SIRIUS_SETTLEMENT_KEY n'est pas le lockAuthorizer du manifeste");
  if (provider.address.toLowerCase() !== manifest.demo.provider.toLowerCase()) throw new Error("SIRIUS_DEMO_PROVIDER_KEY n'est pas le fournisseur de démo du manifeste");
  const onChainAuthorizer = await client.readContract({ address: escrow, abi: siriusescrowAbi, functionName: "lockAuthorizer" });
  if (onChainAuthorizer.toLowerCase() !== settlement.address.toLowerCase()) throw new Error("L'escrow n'accepte pas ce compte de règlement");
  const linkedEscrow = await client.readContract({ address: checkout, abi: siriuscheckoutAbi, functionName: "escrow" });
  if (linkedEscrow.toLowerCase() !== escrow.toLowerCase()) throw new Error("Le checkout ne pointe pas sur l'escrow du manifeste");

  const trainingProfile = trainingProfileHash(DEFAULT_MODEL_SELECTION);
  const datasetId = await client.readContract({
    address: datasets,
    abi: parseAbi(["function datasetIdOf(address provider, bytes32 datasetIdHash) view returns (bytes32)"]),
    functionName: "datasetIdOf",
    args: [provider.address, datasetIdHash(manifest.demo.datasetId)],
  });

  // Acheteurs jetables gardés dans un fichier local ignoré par git (.env*.local) : une relance
  // réutilise les mêmes wallets et ce qu'ils ont déjà reçu, rien n'est perdu sur un échec.
  const walletsFile = resolve(ROOT, ".env.team-flows.local");
  const saved = existsSync(walletsFile) ? JSON.parse(readFileSync(walletsFile, "utf8")) as { buyerA: Hex; buyerB: Hex } : null;
  const buyerKeys = saved ?? { buyerA: generatePrivateKey(), buyerB: generatePrivateKey() };
  const buyerA = privateKeyToAccount(buyerKeys.buyerA);
  const buyerB = privateKeyToAccount(buyerKeys.buyerB);
  const tx = (label: string, hash: Hex) => ({ label, hash, url: `${manifest.explorer}/tx/${hash}` });
  const done: Array<ReturnType<typeof tx>> = [];
  const wait = async (label: string, hash: Hex) => {
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, retryCount: 30, retryDelay: 1_500, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${label} rejeté : ${hash}`);
    done.push(tx(label, hash));
    console.log(`✓ ${label}\n  ${manifest.explorer}/tx/${hash}`);
  };
  const walletOf = (account: PrivateKeyAccount) => createWalletClient({ account, chain, transport });
  // Le RPC de Mezo estime parfois le gas sous le plancher EIP-7623 (coût minimal des données) :
  // chaque envoi part avec l'estimation plus une marge, jamais avec l'estimation brute.
  // Il l'estime aussi bien trop bas pour lockWithSignature (≈ 29 k au lieu de plusieurs centaines
  // de milliers) : chaque appel part avec le plus grand de l'estimation majorée et d'un plancher.
  const GAS_FLOOR = BigInt(1_000_000);
  const withMargin = (gas: bigint) => gas * BigInt(3) / BigInt(2) + BigInt(10_000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const write = async (account: PrivateKeyAccount, params: any): Promise<Hex> => {
    const estimate = withMargin(await client.estimateContractGas({ ...params, account }));
    return walletOf(account).writeContract({ ...params, account, chain, gas: estimate > GAS_FLOOR ? estimate : GAS_FLOOR });
  };

  // Devis BTC : combien envoyer pour 2 MUSD au cours du pool, sous le plancher de l'oracle.
  const oracle = await client.readContract({ address: checkout, abi: siriuscheckoutAbi, functionName: "oracleFloor", args: [parseEther("1")] });
  const route = [{ from: BTC_TOKEN_ADDRESS, to: musd, stable: false, factory: MEZO_CHECKOUT_TESTNET.poolFactory as Address }];
  const quote = await btcCheckoutQuote({
    amount: PRICE,
    oraclePrice: oracle[0],
    maxSlippageBps: BigInt(MEZO_CHECKOUT_TESTNET.maxSlippageBps),
    quoteOut: async (btcIn) => {
      const amounts = await client.readContract({ address: MEZO_CHECKOUT_TESTNET.poolsRouter as Address, abi: routerAbi, functionName: "getAmountsOut", args: [btcIn, route] });
      return amounts[amounts.length - 1];
    },
  });
  const btcIn = BigInt(quote.btcIn);
  const gasPrice = await client.getGasPrice();
  // Le BTC du swap, plus de quoi couvrir largement le gas plafond (1 M) même si le prix double.
  const btcForBuyerB = btcIn + gasPrice * BigInt(5_000_000);

  const [deployerMusd, deployerBtc, settlementBtc, providerMusd, providerBtc] = await Promise.all([
    client.readContract({ address: musd, abi: erc20Abi, functionName: "balanceOf", args: [deployer.address] }),
    client.getBalance({ address: deployer.address }),
    client.getBalance({ address: settlement.address }),
    client.readContract({ address: musd, abi: erc20Abi, functionName: "balanceOf", args: [provider.address] }),
    client.getBalance({ address: provider.address }),
  ]);
  console.log(`déployeur   ${deployer.address} · ${formatEther(deployerMusd)} MUSD · ${formatEther(deployerBtc)} BTC`);
  console.log(`règlement   ${settlement.address} · ${formatEther(settlementBtc)} BTC`);
  console.log(`fournisseur ${provider.address} · ${formatEther(providerMusd)} MUSD · ${formatEther(providerBtc)} BTC`);
  console.log(`acheteur A  ${buyerA.address} (jetable, recevra 2 MUSD, aucun BTC)`);
  console.log(`acheteur B  ${buyerB.address} (jetable, recevra ${formatEther(btcForBuyerB)} BTC, aucun MUSD)`);
  console.log(`dataset     ${manifest.demo.datasetId} → ${datasetId}`);
  console.log(`devis BTC   ${formatEther(btcIn)} BTC pour 2 MUSD (oracle ${formatEther(oracle[0])} MUSD/BTC)`);
  if (deployerMusd < PRICE) throw new Error("Le déployeur n'a pas 2 MUSD");
  if (deployerBtc < btcForBuyerB + parseEther("0.0005")) throw new Error("Le déployeur n'a pas assez de BTC");
  if (providerMusd < SP_DEPOSIT) throw new Error("Le fournisseur de démo n'a pas 1 MUSD pour le Stability Pool");
  if (!SEND) {
    console.log("\nSimulation seulement. Relance avec --send pour envoyer les transactions.");
    return;
  }

  // Financement des deux acheteurs jetables, seulement de ce qui leur manque.
  if (!saved) writeFileSync(walletsFile, `${JSON.stringify(buyerKeys)}\n`, { mode: 0o600 });
  const [buyerAMusd, buyerBBtc] = await Promise.all([
    client.readContract({ address: musd, abi: erc20Abi, functionName: "balanceOf", args: [buyerA.address] }),
    client.getBalance({ address: buyerB.address }),
  ]);
  if (buyerAMusd < PRICE) {
    await wait("Financement de l'acheteur A : MUSD", await write(deployer, { address: musd, abi: erc20Abi, functionName: "transfer", args: [buyerA.address, PRICE - buyerAMusd] }));
  }
  if (buyerBBtc < btcForBuyerB) {
    const value = btcForBuyerB - buyerBBtc;
    const fundGas = await client.estimateGas({ account: deployer, to: buyerB.address, value });
    await wait("Financement de l'acheteur B : BTC", await walletOf(deployer).sendTransaction({ to: buyerB.address, value, gas: withMargin(fundGas) }));
  }

  const [tokenName, domain] = await Promise.all([
    client.readContract({ address: musd, abi: permitDomainAbi, functionName: "name" }),
    client.readContract({ address: musd, abi: permitDomainAbi, functionName: "eip712Domain" }).catch(() => null),
  ]);
  const tokenVersion = domain ? domain[2] : "1";

  /** Termes, signatures de l'acheteur (permit + LockRequest) et autorisation de Sirius. */
  const signedLock = async (buyer: PrivateKeyAccount) => {
    const loanId = `team-${randomBytes(6).toString("hex")}`;
    const preimage = randomBytes(32);
    const now = Number((await client.getBlock()).timestamp);
    const deadline = BigInt(now + 300);
    const [lockNonce, permitNonce] = await Promise.all([
      client.readContract({ address: escrow, abi: siriusescrowAbi, functionName: "lockNonces", args: [buyer.address] }),
      client.readContract({ address: musd, abi: permitDomainAbi, functionName: "nonces", args: [buyer.address] }),
    ]);
    const request: LockRequest = {
      borrower: buyer.address, provider: provider.address, amount: PRICE, hashlock: hashlockOf(preimage),
      challengeDays: CHALLENGE_DAYS, loanIdHash: loanIdHash(loanId), datasetId, trainingProfile, nonce: lockNonce, deadline,
    };
    const borrowerSignature = await buyer.signTypedData(lockRequestTypedData({ chainId: chain.id, escrow, request }));
    const permitSignature = await buyer.signTypedData(musdPermitTypedData({
      chainId: chain.id, token: musd, tokenName, tokenVersion, owner: buyer.address, spender: escrow, value: PRICE, nonce: permitNonce, deadline,
    }));
    const authorization = {
      deadline: Number(deadline),
      signature: await settlement.signTypedData(lockAuthorizationTypedData({ ...request }, { chainId: chain.id, escrow }, Number(deadline))),
    };
    return {
      loanKey: loanKeyFor(buyer.address, loanId),
      preimage: `0x${preimage.toString("hex")}` as Hex,
      request: normalizeLockRequest(request),
      borrowerSignature,
      permit: permitFromSignature(permitSignature, PRICE, deadline),
      authorization,
    };
  };

  // 1. Paiement en une signature, relayé par le compte de règlement.
  const a = await signedLock(buyerA);
  const relay = { address: escrow, abi: siriusescrowAbi, functionName: "lockWithSignature", args: [a.request, a.borrowerSignature, a.permit, a.authorization] } as const;
  await client.simulateContract({ ...relay, account: settlement });
  await wait("Paiement en une signature (lockWithSignature, gas payé par Sirius)", await write(settlement, relay));

  // 2. Pay with BTC : l'acheteur B envoie son BTC au checkout.
  const b = await signedLock(buyerB);
  const buy = { address: checkout, abi: siriuscheckoutAbi, functionName: "buyWithBtc", args: [PRICE, b.request, b.borrowerSignature, b.permit, b.authorization], value: btcIn } as const;
  await client.simulateContract({ ...buy, account: buyerB });
  await wait("Pay with BTC (swap Mezo Pools + lock en une transaction)", await write(buyerB, buy));

  // 3. Livraison : libération des deux prêts, puis retrait du fournisseur.
  await wait("Libération du prêt payé en une signature", await write(settlement, { address: escrow, abi: siriusescrowAbi, functionName: "release", args: [a.loanKey, a.preimage] }));
  await wait("Libération du prêt payé en BTC", await write(settlement, { address: escrow, abi: siriusescrowAbi, functionName: "release", args: [b.loanKey, b.preimage] }));
  await wait("Retrait du fournisseur (withdrawFor)", await write(settlement, { address: escrow, abi: siriusescrowAbi, functionName: "withdrawFor", args: [provider.address] }));

  // 4. Gains au travail : 1 MUSD du fournisseur dans le Stability Pool de Mezo.
  const pool = musdProtocol("testnet").stabilityPool;
  await wait("Approbation MUSD pour le Stability Pool", await write(provider, { address: musd, abi: erc20Abi, functionName: "approve", args: [pool, SP_DEPOSIT] }));
  await wait("Dépôt de 1 MUSD dans le Stability Pool (provideToSP)", await write(provider, { address: pool, abi: stabilityPoolAbi, functionName: "provideToSP", args: [SP_DEPOSIT] }));

  console.log("\nTerminé. Colle cette liste à Claude :");
  for (const item of done) console.log(`${item.label} | ${item.hash}`);
  console.log(`acheteur A ${buyerA.address} · acheteur B ${buyerB.address}`);
  console.log("Ensuite : node --import tsx scripts/mezo-distribute-fees.ts --send");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
