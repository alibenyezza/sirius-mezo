/** Surface EIP-2612 / EIP-5267 du jeton de règlement, lue pour construire le permit. */
export const musdPermitDomainAbi = [
  {
    type: "function", name: "nonces", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "name", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function", name: "allowance", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "eip712Domain", stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" }, { name: "name", type: "string" }, { name: "version", type: "string" },
      { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" }, { name: "extensions", type: "uint256[]" },
    ],
  },
] as const;
