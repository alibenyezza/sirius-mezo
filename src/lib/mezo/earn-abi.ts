/**
 * ABI réduits des deux lieux de rendement MUSD de Mezo, limités aux fonctions que Sirius
 * encode ou lit. Signatures vérifiées le 31 oct. 2026 contre les artefacts publics :
 *
 * - StabilityPool : `mezo-org/musd`, `solidity/artifacts/deployments/matsnet/StabilityPool.json`
 *   (proxy dans `protocol.ts`). Le gain de collatéral d'un déposant est en BTC natif.
 * - `MUSDSavingsRate` (coffre sMUSD) : source vérifiée sur Blockscout
 *   (`/api/v2/smart-contracts/0x92d12f0a60906b39d81acd9bf8977b6c824cd98c`). Ce n'est PAS un
 *   ERC-4626 : dépôt 1:1 en parts, rendement réclamé séparément par `claimYield()`.
 */

export const stabilityPoolAbi = [
  {
    type: "function",
    name: "provideToSP",
    stateMutability: "nonpayable",
    inputs: [{ name: "_amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawFromSP",
    stateMutability: "nonpayable",
    inputs: [{ name: "_amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getCompoundedMUSDDeposit",
    stateMutability: "view",
    inputs: [{ name: "_depositor", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDepositorCollateralGain",
    stateMutability: "view",
    inputs: [{ name: "_depositor", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getTotalMUSDDeposits",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const savingsVaultAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimYield",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimableYield",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
