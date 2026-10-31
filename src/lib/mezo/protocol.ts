import { getAddress, type Address } from "viem";
import type { EvmNetwork } from "@/lib/evm/networks";

/**
 * Adresses du protocole MUSD et des jetons natifs de Mezo, par réseau.
 *
 * Source : `mezo-org/musd`, `solidity/artifacts/deployments/{matsnet,mainnet}/*.json`
 * (commit da7888a, 26 oct. 2026), vérifiées on-chain le 31 oct. 2026 : slot d'implémentation
 * EIP-1967 égal au JSON, sources vérifiées sur Blockscout, getters croisés (`musd()`,
 * `troveManager()`, `stabilityPoolAddress()`…) cohérents entre eux. Ce sont les proxys
 * (TransparentUpgradeableProxy), seules adresses stables.
 *
 * Le coffre d'épargne sMUSD du testnet n'a pas de fichier de déploiement public : c'est le
 * `feeRecipient()` du PCV testnet, vérifié sur Blockscout comme `MUSDSavingsRate`. Sur mainnet,
 * `PCV.feeRecipient()` rend bien l'adresse documentée par Mezo.
 *
 * MEZO et BTC sont des précompilés de la chaîne (`mezo-org/mezod`, `x/evm/types/precompile.go`),
 * identiques sur les deux réseaux : ERC-20 avec `permit`, domaine EIP-712 « MEZO » version « 1 ».
 */

export interface MusdProtocolAddresses {
  borrowerOperations: Address;
  borrowerOperationsSignatures: Address;
  troveManager: Address;
  stabilityPool: Address;
  priceFeed: Address;
  sortedTroves: Address;
  hintHelpers: Address;
  pcv: Address;
  /** Coffre d'épargne sMUSD (`MUSDSavingsRate`) : dépôt 1:1, rendement réclamable. */
  savingsVault: Address;
}

const TESTNET: MusdProtocolAddresses = {
  borrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  borrowerOperationsSignatures: "0xD757e3646AF370b15f32EB557F0F8380Df7D639e",
  troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  stabilityPool: "0x1CCA7E410eE41739792eA0A24e00349Dd247680e",
  priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
  hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6",
  pcv: "0x4dDD70f4C603b6089c07875Be02fEdFD626b80Af",
  savingsVault: "0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16",
};

const MAINNET: MusdProtocolAddresses = {
  borrowerOperations: "0x44b1bac67dDA612a41a58AAf779143B181dEe031",
  borrowerOperationsSignatures: "0xB57ab578BF20b3e318f3EFAA587C51DBccE5df7a",
  troveManager: "0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193",
  stabilityPool: "0x73245Eff485aB3AAc1158B3c4d8f4b23797B0e32",
  priceFeed: "0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88",
  sortedTroves: "0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f",
  hintHelpers: "0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3",
  pcv: "0x391EcC7ffEFc48cff41D0F2Bb36e38b82180B993",
  savingsVault: "0xb4D498029af77680cD1eF828b967f010d06C51CC",
};

export const MUSD_PROTOCOL: Record<EvmNetwork, MusdProtocolAddresses> = { testnet: TESTNET, mainnet: MAINNET };

/** Précompilé ERC-20 du jeton MEZO (même adresse sur testnet et mainnet). */
export const MEZO_TOKEN_ADDRESS: Address = "0x7b7c000000000000000000000000000000000001";
/** Précompilé ERC-20 du BTC natif (même adresse sur testnet et mainnet). */
export const BTC_TOKEN_ADDRESS: Address = "0x7b7c000000000000000000000000000000000000";

/** Constantes du protocole, lues on-chain le 31 oct. 2026 (identiques sur les deux réseaux). */
export const MUSD_GAS_COMPENSATION = BigInt("200000000000000000000");
export const MUSD_MIN_NET_DEBT = BigInt("1800000000000000000000");
/** Ratio de collatéralisation minimal d'un trove, en 1e18. */
export const MUSD_MCR = BigInt("1100000000000000000");
/** Frais d'emprunt : 0,1 % du MUSD tiré, ajoutés à la dette du trove. */
export const MUSD_BORROWING_RATE_BPS = 10;

export function musdProtocol(network: EvmNetwork): MusdProtocolAddresses {
  const a = MUSD_PROTOCOL[network];
  return {
    borrowerOperations: getAddress(a.borrowerOperations),
    borrowerOperationsSignatures: getAddress(a.borrowerOperationsSignatures),
    troveManager: getAddress(a.troveManager),
    stabilityPool: getAddress(a.stabilityPool),
    priceFeed: getAddress(a.priceFeed),
    sortedTroves: getAddress(a.sortedTroves),
    hintHelpers: getAddress(a.hintHelpers),
    pcv: getAddress(a.pcv),
    savingsVault: getAddress(a.savingsVault),
  };
}
