import "@nomicfoundation/hardhat-toolbox-viem";
import type { HardhatUserConfig } from "hardhat/config";

/**
 * Toolchain Solidity de Sirius, isolée sous `contracts/` pour ne pas polluer le
 * `tsc`, l'ESLint ni le build Next de l'application (cf. exclusion dans tsconfig.json).
 *
 * Cible : Mezo (EVM Bitcoin). Valeurs vérifiées en direct le 14/08/2026 :
 *   testnet 31611 (0xb626) · mainnet 31612 (0x1237) · client nitro/v3.11.3-rc.9
 *   baseFee = 0,01 gwei · maxPriorityFeePerGas = 0 (séquenceur FCFS, aucun fee-bump possible)
 */

// `paris` volontairement, pas `cancun` : Mezo ne documente publiquement aucun
// niveau d'EVM (ArbOS 61 sans page de référence). Aucun de nos contrats n'a besoin de
// TSTORE/MCOPY, donc on ne prend pas le risque d'un opcode non supporté à l'exécution.
const EVM_VERSION = "paris";

const deployerKey = process.env.MEZO_DEPLOYER_KEY?.trim();
const accounts = deployerKey ? [deployerKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: EVM_VERSION,
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: process.env.SIRIUS_LOCAL_BILLING_TEST === "true" ? 31611 : 31337,
      // Le réseau local doit refléter la cible, sinon un test peut passer ici et
      // échouer sur la chaîne réelle. Hardhat nomme « merge » le hardfork que solc
      // appelle « paris » — c'est le même, seule la nomenclature diffère.
      hardfork: "merge",
    },
    mezoTestnet: {
      url: process.env.MEZO_TESTNET_RPC ?? "https://rpc.test.mezo.org",
      chainId: 31611,
      accounts,
    },
    mezoMainnet: {
      url: process.env.MEZO_MAINNET_RPC ?? "https://mainnet.mezo.public.validationcloud.io",
      chainId: 31612,
      accounts,
    },
  },
  mocha: {
    // Le premier test paie le démarrage du réseau Hardhat et la compilation ; 40 s
    // par défaut ne suffisent pas sur une machine froide.
    timeout: 180_000,
  },
  etherscan: {
    // Blockscout accepte n'importe quelle clé ; la vérification passe par son endpoint.
    apiKey: {
      mezoTestnet: "blockscout",
      mezoMainnet: "blockscout",
    },
    customChains: [
      {
        network: "mezoTestnet",
        chainId: 31611,
        urls: {
          apiURL: "https://explorer.test.mezo.org/api",
          browserURL: "https://explorer.test.mezo.org",
        },
      },
      {
        network: "mezoMainnet",
        chainId: 31612,
        urls: {
          apiURL: "https://explorer.mezo.org/api",
          browserURL: "https://explorer.mezo.org",
        },
      },
    ],
  },
};

export default config;
