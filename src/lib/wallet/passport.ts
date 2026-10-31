"use client";

import { createPublicClient, hexToString, http, type Address, type Chain, type Hex } from "viem";
import { BitcoinAddressHelper } from "@mezo-org/orangekit-smart-account";
import { getOKXWallet, getUnisatWallet, getXverseWallet, isUnsupportedBitcoinAddressError } from "@mezo-org/passport/dist/src/wallet";
import { addressesEqual } from "@/lib/evm/address";
import { chainForNetwork, resolveClientNetwork } from "@/lib/evm/networks";
import { notifyWalletChange, registerPassportWallet } from "@/lib/wallet/discovery";
import type { Eip1193Provider } from "@/lib/wallet/manager";
import { mezoPassportEnabled } from "@/lib/wallet/passport-flag";
import { ORANGEKIT_SAFE_FACTORY, buildPassportSignature, orangeKitSafeFactoryAbi } from "@/lib/wallet/passport-signature";

/**
 * Wallets Bitcoin par Mezo Passport : Unisat, OKX, Xverse.
 *
 * Passport (et OrangeKit dessous) fournit des connecteurs wagmi : le wallet Bitcoin signe,
 * et un smart account Mezo — un Safe gouverné par un contrat qui vérifie des signatures
 * Bitcoin — porte l'adresse EVM, le solde et les transactions. Le connecteur n'expose pas
 * de provider EIP-1193 : `getProvider()` rend le smart account, et `getClient()` un client
 * viem dont `signTypedData` refuse.
 *
 * Le reste de l'application ne connaît qu'une porte, `request({ method, params })`. Ce
 * module la fabrique : les comptes et la chaîne viennent du connecteur, `personal_sign`
 * devient une signature Safe ERC-1271 enveloppée ERC-6492, `eth_sendTransaction` passe par
 * le smart account et son relais, et tout le reste — soldes, reçus, lectures — part
 * directement au RPC de la chaîne. Ainsi `manager.ts`, le store et chaque écran marchent
 * sans changement, exactement comme pour le portefeuille embarqué.
 *
 * Chargé paresseusement, au clic : le SDK et ses dépendances pèsent lourd et la plupart
 * des visiteurs ne s'en serviront jamais.
 */

export type PassportWalletId = "unisat" | "okx" | "xverse";

export interface PassportWalletChoice {
  id: PassportWalletId;
  name: string;
  installed: boolean;
}

interface BitcoinProvider {
  signMessage(message: string): Promise<string>;
  getPublicKey(): Promise<string>;
  getAddress(): Promise<string>;
  disconnect(): Promise<void>;
  isInstalled(): boolean;
}

interface SmartAccount {
  chainId: number;
  sendTransaction(
    to: Address,
    value: string,
    data: Hex,
    bitcoinAddress: string,
    publicKey: string,
    sign: (message: string) => Promise<string>,
  ): Promise<Hex>;
}

/** Surface du connecteur OrangeKit réellement utilisée ; le type wagmi complet n'apporte rien ici. */
interface PassportConnector {
  setup?(): Promise<void>;
  connect(parameters: { chainId: number }): Promise<{ accounts: readonly string[]; chainId: number }>;
  disconnect(): Promise<void>;
  getAccounts(): Promise<readonly string[]>;
  getProvider(): Promise<SmartAccount>;
  isAuthorized(): Promise<boolean>;
  getBitcoinProvider(): BitcoinProvider;
}

type ConnectorFactory = (parameters: { chains: readonly [Chain, ...Chain[]]; emitter: unknown }) => PassportConnector;

interface InjectedBitcoinWallets {
  unisat?: unknown;
  okxwallet?: { bitcoin?: unknown };
  XverseProviders?: { BitcoinProvider?: unknown };
}

function injected(): InjectedBitcoinWallets {
  return typeof window === "undefined" ? {} : (window as unknown as InjectedBitcoinWallets);
}

const WALLETS: Record<PassportWalletId, { name: string; installed: () => boolean; create: typeof getUnisatWallet }> = {
  unisat: { name: "Unisat", installed: () => Boolean(injected().unisat), create: getUnisatWallet },
  okx: { name: "OKX Wallet", installed: () => Boolean(injected().okxwallet?.bitcoin), create: getOKXWallet },
  xverse: { name: "Xverse", installed: () => Boolean(injected().XverseProviders?.BitcoinProvider), create: getXverseWallet },
};

const WALLET_IDS = Object.keys(WALLETS) as PassportWalletId[];
const CLE_WALLET = "sirius.passport.wallet";

/** Le connecteur n'émet que des erreurs et des changements de chaîne que l'on ne consomme pas. */
const emitter = {
  uid: "sirius-passport",
  emit() {},
  on() {},
  once() {},
  off() {},
  listenerCount() {
    return 0;
  },
};

interface PassportSession {
  walletId: PassportWalletId;
  connector: PassportConnector;
  account: Address;
  provider: Eip1193Provider;
}

let session: PassportSession | null = null;

function configuration() {
  const chain = chainForNetwork(resolveClientNetwork());
  return { chain, chainId: chain.id, chainHex: `0x${chain.id.toString(16)}`, rpcUrl: chain.rpcUrls.default.http[0] };
}

/** Rejet EIP-1193 : un code que `messageOf` sait lire, un message que `t()` sait traduire. */
function rpcError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function rememberWallet(walletId: PassportWalletId | null): void {
  try {
    if (walletId) window.localStorage.setItem(CLE_WALLET, walletId);
    else window.localStorage.removeItem(CLE_WALLET);
  } catch {
    // Stockage indisponible : la session ne survivra pas au rechargement, rien de plus.
  }
}

function rememberedWallet(): PassportWalletId | null {
  try {
    const value = window.localStorage.getItem(CLE_WALLET);
    return WALLET_IDS.includes(value as PassportWalletId) ? (value as PassportWalletId) : null;
  } catch {
    return null;
  }
}

/** Les trois wallets pris en charge, avec leur présence dans ce navigateur. */
export function detectBitcoinWallets(): PassportWalletChoice[] {
  return WALLET_IDS.map((id) => ({ id, name: WALLETS[id].name, installed: WALLETS[id].installed() }));
}

async function createConnector(walletId: PassportWalletId): Promise<PassportConnector> {
  const { chain, chainId, rpcUrl } = configuration();
  // Passport décrit chaque wallet au format RainbowKit ; seul son connecteur wagmi nous sert.
  const wallet = WALLETS[walletId].create({ rpcUrl, chainId })();
  const factory = (wallet.createConnector as unknown as () => ConnectorFactory)();
  const connector = factory({ chains: [chain], emitter });
  await connector.setup?.();
  return connector;
}

/**
 * Rend lisible un échec de connexion du wallet Bitcoin.
 *
 * Le connecteur enveloppe la cause dans une `BitcoinWalletConnectionError` ; c'est elle qui
 * dit si l'utilisateur a refusé ou si son compte est d'un type que Mezo ne sait pas porter
 * — Taproot notamment, le défaut de certains wallets.
 */
function descriptionEchec(error: unknown): string {
  const cause = (error as { cause?: unknown } | null)?.cause ?? error;
  if (isUnsupportedBitcoinAddressError(cause)) {
    return "Adresse Bitcoin non prise en charge : sélectionne un compte Native SegWit (bc1q), Nested SegWit ou Legacy dans ton wallet.";
  }
  const details = cause as { code?: unknown; message?: unknown } | null;
  const message = typeof details?.message === "string" ? details.message : "";
  if (details?.code === 4001 || /declined|rejected|cancel/i.test(message)) return "Connexion annulée dans le wallet.";
  if (/not installed/i.test(message)) return "Aucun wallet Bitcoin détecté. Installe Unisat, OKX Wallet ou Xverse.";
  return message || "Connexion au wallet Bitcoin échouée.";
}

function createProvider(connector: PassportConnector, account: Address): Eip1193Provider {
  const { chain, chainId, chainHex, rpcUrl } = configuration();
  const rpc = createPublicClient({ chain, transport: http(rpcUrl) });
  const bitcoin = connector.getBitcoinProvider();

  const signMessage = async (message: string): Promise<Hex> => {
    const [publicKey, bitcoinAddress] = await Promise.all([bitcoin.getPublicKey(), bitcoin.getAddress()]);
    const truncated = BitcoinAddressHelper.recoverTruncatedBitcoinAddress(bitcoinAddress, publicKey) as Hex;
    const [predicted, owner] = await rpc.readContract({
      address: ORANGEKIT_SAFE_FACTORY,
      abi: orangeKitSafeFactoryAbi,
      functionName: "predictAddresses",
      args: [truncated],
    });
    // Le compte affiché vient du SDK, le propriétaire de la fabrique : ils doivent désigner
    // le même Safe, sinon la signature serait vérifiée contre un autre compte que celui connecté.
    if (!addressesEqual(predicted, account)) throw new Error("Compte Mezo Passport incohérent — reconnecte-toi.");
    return buildPassportSignature({
      message,
      safe: account,
      chainId,
      owner,
      truncatedBitcoinAddress: truncated,
      publicKey,
      signBitcoinMessage: (text) => bitcoin.signMessage(text),
    });
  };

  const sendTransaction = async (transaction: { to?: unknown; value?: unknown; data?: unknown }): Promise<Hex> => {
    if (typeof transaction.to !== "string") throw new Error("Transaction sans destinataire.");
    const smartAccount = await connector.getProvider();
    const [publicKey, bitcoinAddress] = await Promise.all([bitcoin.getPublicKey(), bitcoin.getAddress()]);
    const value = typeof transaction.value === "string" && transaction.value ? BigInt(transaction.value).toString() : "0";
    const data = typeof transaction.data === "string" && transaction.data ? (transaction.data as Hex) : "0x";
    // Le smart account exécute la transaction Safe signée par le wallet Bitcoin et la relaie ;
    // le hash rendu est celui de la transaction relayée, que les reçus savent retrouver.
    return smartAccount.sendTransaction(transaction.to as Address, value, data, bitcoinAddress, publicKey, (message) =>
      bitcoin.signMessage(message),
    );
  };

  const forward = rpc.request as unknown as (args: { method: string; params?: unknown }) => Promise<unknown>;

  return {
    async request({ method, params }) {
      const list = Array.isArray(params) ? params : [];
      switch (method) {
        case "eth_chainId":
          return chainHex;
        case "eth_accounts":
        case "eth_requestAccounts":
          return [account];
        case "personal_sign":
          return signMessage(hexToString(list[0] as Hex));
        case "eth_sendTransaction":
          return sendTransaction((list[0] ?? {}) as { to?: unknown; value?: unknown; data?: unknown });
        case "eth_signTypedData_v4":
          // Le smart account valide des messages EIP-191 ; le SDK ne propose pas de chemin
          // EIP-712 pour les wallets Bitcoin, et en inventer un ne serait vérifié par rien.
          throw rpcError(4200, "Signature EIP-712 non prise en charge par Mezo Passport.");
        case "wallet_switchEthereumChain": {
          const target = (list[0] as { chainId?: unknown } | undefined)?.chainId;
          if (typeof target === "string" && target.toLowerCase() === chainHex) return null;
          throw rpcError(4902, "Bascule de réseau impossible avec Mezo Passport.");
        }
        case "wallet_addEthereumChain":
          throw rpcError(4200, "Opération non prise en charge par Mezo Passport.");
        case "wallet_requestPermissions":
          return [];
        case "wallet_revokePermissions":
          await disconnectPassport();
          return null;
        default:
          return forward({ method, params });
      }
    },
  };
}

async function adopt(walletId: PassportWalletId, connector: PassportConnector): Promise<{ address: string; chainId: string }> {
  const { chainId, chainHex } = configuration();
  let accounts: readonly string[];
  try {
    ({ accounts } = await connector.connect({ chainId }));
  } catch (error) {
    throw new Error(descriptionEchec(error));
  }
  const account = accounts[0];
  if (typeof account !== "string") throw new Error("Le wallet Bitcoin n’a renvoyé aucun compte.");
  session = { walletId, connector, account: account as Address, provider: createProvider(connector, account as Address) };
  rememberWallet(walletId);
  return { address: account, chainId: chainHex };
}

/** Ouvre la connexion au wallet Bitcoin choisi et rend le smart account obtenu. */
export async function connectPassport(walletId: PassportWalletId): Promise<{ address: string; chainId: string }> {
  if (!mezoPassportEnabled()) throw new Error("Mezo Passport indisponible sur cette instance.");
  if (!WALLETS[walletId].installed()) throw new Error("Aucun wallet Bitcoin détecté. Installe Unisat, OKX Wallet ou Xverse.");
  return adopt(walletId, await createConnector(walletId));
}

/**
 * Rouvre la session Passport d'un rechargement de page, sans rien demander à l'utilisateur.
 *
 * Seulement si le wallet se dit déjà autorisé pour ce site : un wallet qui ouvrirait une
 * fenêtre au chargement ferait croire à un site intrusif. Rend `true` si un compte a été
 * retrouvé ; une absence n'est pas une erreur.
 */
export async function restorePassport(): Promise<boolean> {
  if (session) return true;
  if (!mezoPassportEnabled()) return false;
  const walletId = rememberedWallet();
  if (!walletId || !WALLETS[walletId].installed()) return false;
  try {
    const connector = await createConnector(walletId);
    if (!(await connector.isAuthorized())) return false;
    await adopt(walletId, connector);
    notifyWalletChange();
    return true;
  } catch {
    return false;
  }
}

/** Ferme la session : le wallet Bitcoin oublie le site quand il sait le faire. */
export async function disconnectPassport(): Promise<void> {
  const current = session;
  session = null;
  rememberWallet(null);
  if (current) await current.connector.disconnect().catch(() => {});
  notifyWalletChange();
}

/** Provider du smart account connecté, `null` sans session. Synchrone et sans effet de bord. */
export function passportProvider(): Eip1193Provider | null {
  return session?.provider ?? null;
}

/** Nom du wallet Bitcoin de la session, pour l'affichage. */
export function passportWalletName(): string | null {
  return session ? WALLETS[session.walletId].name : null;
}

// Déclaré au chargement du module, comme le portefeuille embarqué : le lecteur rend `null`
// tant qu'aucune session n'est ouverte, et `selectedProvider()` sait où chercher.
registerPassportWallet({
  provider: passportProvider,
  switchChain: async (chainId) => {
    // La chaîne est fixée par la configuration du connecteur ; il n'y a rien à basculer.
    if (chainId.toLowerCase() !== configuration().chainHex) throw new Error("Bascule de réseau impossible avec Mezo Passport.");
  },
  logout: disconnectPassport,
});
