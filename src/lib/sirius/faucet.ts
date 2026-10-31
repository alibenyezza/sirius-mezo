import "server-only";
import { createWalletClient, erc20Abi, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AppError } from "@/lib/errors";
import { isDemoDeployment } from "@/lib/deployment-mode";
import { normalizeAddress } from "@/lib/evm/address";
import { usdcAddress } from "@/lib/evm/addresses";
import { getPublicClient } from "@/lib/evm/client";
import { resolveServerNetwork } from "@/lib/evm/networks";
import { USDC_DECIMALS } from "@/lib/evm/usdc";
import { deciderDistribution, MONTANT_BTC, MONTANT_MUSD, montantBtcWei, montantMusdAtomic } from "./faucet-policy";

/**
 * Distribution de fonds de test, réservée aux instances de démonstration.
 *
 * Sans fonds, un visiteur ne peut rien faire du produit : il se connecte, découvre un
 * solde nul, et repart. Cette route est ce qui rend l'instance publique utilisable
 * plutôt que seulement regardable. Aucun service d'achat par carte ne vend la monnaie
 * d'un réseau de test ; la maison la fournit donc elle-même.
 *
 * Le jeton de règlement est le MUSD canonique de Mezo (`SIRIUS_USDC_ADDRESS`, nom
 * historique), pas un jeton d'essai à frappe ouverte : seul le protocole Mezo émet du
 * MUSD, en contrepartie d'un dépôt de BTC. Un appel à `mint` depuis ce compte est rejeté
 * par le contrat. Le distributeur ne frappe donc rien : il **transfère** du MUSD depuis
 * une réserve que nous alimentons, obtenue en empruntant contre du BTC de test sur
 * https://testnet.mezo.org puis envoyée à son adresse.
 *
 * Deux ressources sont servies, parce qu'il en faut deux pour emprunter : le MUSD, et un
 * peu de BTC natif pour payer le gas. Les deux sortent du même compte, les deux sont
 * finies, les deux sont rationnées : on ne verse qu'à qui en manque, on vérifie les
 * réserves avant d'écrire, et on prévient dans le journal avant d'être à sec. Les règles
 * elles-mêmes sont dans `faucet-policy.ts`.
 */

let distributionQueue: Promise<void> = Promise.resolve();

function enqueueDistribution<T>(operation: () => Promise<T>): Promise<T> {
  const queued = distributionQueue.catch(() => {}).then(operation);
  distributionQueue = queued.then(() => {}, () => {});
  return queued;
}

function distributeurAccount() {
  // Clé dédiée, sans repli sur celle du vérificateur KYB.
  //
  // Les deux rôles ont longtemps partagé un compte : la maison paie le gas dans les deux
  // cas, et sur une démonstration la distinction paraissait cosmétique. Elle ne l'est
  // pas. Le faucet est la seule dépense qu'un visiteur déclenche librement ; l'attestation
  // KYB est ce qui lui ouvre l'emprunt comme la publication. Les confondre revient à
  // laisser n'importe qui, en vidant la réserve, retirer le KYB à tout le monde — une
  // panne dont la cause n'a aucun rapport visible avec son effet.
  //
  // La séparation devient pressante dès que créer un compte ne demande plus d'installer
  // un portefeuille.
  const key = process.env.SIRIUS_FAUCET_KEY?.trim();
  if (!key) throw new AppError("Distribution indisponible : aucun compte distributeur configuré", 503);
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new AppError("Clé du distributeur malformée", 500);
  return privateKeyToAccount(key as Hex);
}

export function faucetAvailable(): boolean {
  return isDemoDeployment() && Boolean(process.env.SIRIUS_FAUCET_KEY?.trim());
}

/**
 * Ce qui a été versé. Un champ `null` veut dire « rien envoyé » : le compte en avait déjà
 * assez. Les noms (`usdc`, `eth`) sont ceux du contrat de l'API, que le client lit tel quel ;
 * ils désignent respectivement le MUSD et le BTC natif.
 */
export interface FaucetResult {
  usdcTxHash: string | null;
  ethTxHash: string | null;
  usdc: string | null;
  eth: string | null;
}

async function distribuerFondsDeTestEnSerie(destinataire: string): Promise<FaucetResult> {
  if (!isDemoDeployment()) throw new AppError("Réservé aux instances de démonstration", 403);

  const address = normalizeAddress(destinataire);
  const { chain, rpcUrl } = resolveServerNetwork();
  const publicClient = getPublicClient();
  const account = distributeurAccount();
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const musd = usdcAddress();

  // Toutes les lectures avant la moindre écriture : un distributeur qui transfère le MUSD
  // puis échoue sur le BTC laisserait le visiteur avec des jetons qu'il ne peut pas
  // dépenser, ce qui est pire que de ne rien lui donner.
  const [reserveBtc, reserveMusd, soldeBtc, soldeMusd] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({ address: musd, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: musd, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  ]);
  const decision = deciderDistribution(
    { reserveBtc, reserveMusd, soldeBtc, soldeMusd },
    { decimals: USDC_DECIMALS, distributeur: account.address },
  );
  // Journal seulement : sur un hébergeur serverless c'est le seul canal qui survit à la
  // requête, et une alerte n'a pas à interrompre la distribution en cours.
  for (const alerte of decision.alertes) console.warn(`[faucet] ${alerte}`);
  if (decision.refus) throw new AppError(decision.refus, 503);

  let usdcTxHash: Hex | null = null;
  if (decision.envoyerMusd) {
    usdcTxHash = await wallet.writeContract({
      address: musd,
      abi: erc20Abi,
      functionName: "transfer",
      args: [address, montantMusdAtomic(USDC_DECIMALS)],
      chain,
      account,
    });
    const usdcReceipt = await publicClient.waitForTransactionReceipt({ hash: usdcTxHash, confirmations: 1 });
    if (usdcReceipt.status !== "success") throw new AppError("Transfert MUSD rejeté par la chaîne", 502);
  }

  let ethTxHash: Hex | null = null;
  if (decision.envoyerBtc) {
    ethTxHash = await wallet.sendTransaction({
      to: address,
      value: montantBtcWei(),
      chain,
      account,
    });
    const ethReceipt = await publicClient.waitForTransactionReceipt({ hash: ethTxHash, confirmations: 1 });
    if (ethReceipt.status !== "success") throw new AppError("Transfert BTC rejeté par la chaîne", 502);
  }

  return {
    usdcTxHash,
    ethTxHash,
    usdc: usdcTxHash ? MONTANT_MUSD : null,
    eth: ethTxHash ? MONTANT_BTC : null,
  };
}

export function distribuerFondsDeTest(destinataire: string): Promise<FaucetResult> {
  return enqueueDistribution(() => distribuerFondsDeTestEnSerie(destinataire));
}
