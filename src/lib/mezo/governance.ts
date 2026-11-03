import { getAddress, type Address } from "viem";

/**
 * Vote-escrow et gauges de Mezo (Tigris v2), par réseau.
 *
 * Lus on-chain le 1er nov. 2026 : `PoolsVoter.ve()` rend veBTC, `veBTC.booster()` rend le
 * BoostVoter dont `ve()` rend veMEZO ; `PoolsVoter.gauges(pool)` rend le gauge BTC/MUSD et
 * `gaugeToBribe(gauge)` son BribeVotingReward ; `isWhitelistedToken(MUSD)` vaut true sur les
 * deux réseaux et le bribe a déjà MUSD comme récompense. Les contrats v1 listés dans
 * `mezo-org/tigris` (veBTC 0xB63f…, Voter 0x72F8…) ont encore du code mais ne reçoivent plus
 * d'émissions et n'acceptent pas MUSD : ne pas les utiliser.
 *
 * Sans import d'alias : ce module est lu aussi par les scripts de déploiement.
 */

export interface MezoGovernanceAddresses {
  poolsVoter: Address;
  veBtc: Address;
  boostVoter: Address;
  veMezo: Address;
  btcMusdPool: Address;
  btcMusdGauge: Address;
  btcMusdBribe: Address;
}

const TESTNET: MezoGovernanceAddresses = {
  poolsVoter: "0x263F1Fd5fB7F866881e1B6cD7d5d6c40Fd985F0D",
  veBtc: "0x38E35d92E6Bfc6787272A62345856B13eA12130a",
  boostVoter: "0x21d7bDF5a5929AD179F8cA0c9014A0B62ae6Bfd1",
  veMezo: "0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b",
  btcMusdPool: "0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9",
  btcMusdGauge: "0x72D88B0795373437E86792DEd8362D66dC43Cd2c",
  btcMusdBribe: "0x75b6B35Fc78826A0B7E1f9c08bb7d84bd70D0ee1",
};

const MAINNET: MezoGovernanceAddresses = {
  poolsVoter: "0x48233cCC97B87Ba93bCA212cbEe48e3210211f03",
  veBtc: "0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279",
  boostVoter: "0x2Ba614a598Cffa5a19d683cDCA97bac3a49313d1",
  veMezo: "0xb90fdAd3DFD180458D62Cc6acedc983D78E20122",
  btcMusdPool: "0x52e604c44417233b6CcEDDDc0d640A405Caacefb",
  btcMusdGauge: "0x8Be20a5fF57E381025aE5E3A121B697269569AaF",
  btcMusdBribe: "0x94A9A494872BF7231D8378d0Aef7d32BA552E305",
};

/** Adresses checksummées du réseau Mezo demandé. */
export function mezoGovernance(network: "testnet" | "mainnet"): MezoGovernanceAddresses {
  const source = network === "mainnet" ? MAINNET : TESTNET;
  return {
    poolsVoter: getAddress(source.poolsVoter),
    veBtc: getAddress(source.veBtc),
    boostVoter: getAddress(source.boostVoter),
    veMezo: getAddress(source.veMezo),
    btcMusdPool: getAddress(source.btcMusdPool),
    btcMusdGauge: getAddress(source.btcMusdGauge),
    btcMusdBribe: getAddress(source.btcMusdBribe),
  };
}

/** Paramètres de frais par défaut de l'instance Mezo de Sirius. */
export const SIRIUS_FEE_DEFAULTS = {
  /** 2 % du prix, prélevés à la libération, jamais sur un remboursement. */
  feeBps: 200,
  /** Moitié des frais versée en bribe MUSD sur le gauge BTC/MUSD. */
  incentiveBps: 5_000,
  /** 1 % pour un fournisseur qui verrouille du MEZO. */
  discountedBps: 100,
  /** Pouvoir de vote veMEZO requis pour la remise : 1 (18 décimales). */
  minVeMezoPower: "1000000000000000000",
} as const;
