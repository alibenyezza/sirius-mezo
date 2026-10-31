// ABI réduites du protocole MUSD (Mezo), limitées aux fonctions lues ou signées par Sirius.
// Source : mezo-org/musd, solidity/artifacts/deployments/matsnet/<Contrat>.json (champ `abi`),
// relevées le 31 oct. 2026. Les proxys à appeler sont dans `./protocol.ts`.
//
// `fetchPrice()` est déclarée `view` dans cette version (pas d'écriture d'oracle),
// un `readContract` suffit donc. `withdrawMUSDWithSignature` est la seule fonction
// d'écriture listée : elle n'est présente que pour encoder l'appel, jamais émise ici.

/** TroveManager — getTroveStatus, getTroveDebt, getTroveColl, getEntireDebtAndColl, getCurrentICR, getNominalICR. */
export const troveManagerAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getTroveStatus",
    "outputs": [
      {
        "internalType": "enum ITroveManager.Status",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getTroveDebt",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getTroveColl",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getEntireDebtAndColl",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "coll",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "principal",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "interest",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "pendingCollateral",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "pendingPrincipal",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "pendingInterest",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "_price",
        "type": "uint256"
      }
    ],
    "name": "getCurrentICR",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getNominalICR",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

/** PriceFeed — fetchPrice. */
export const priceFeedAbi = [
  {
    "inputs": [],
    "name": "fetchPrice",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

/** BorrowerOperations — getBorrowingFee, minNetDebt. */
export const borrowerOperationsAbi = [
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_debt",
        "type": "uint256"
      }
    ],
    "name": "getBorrowingFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "minNetDebt",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

/** BorrowerOperationsSignatures — getNonce, withdrawMUSDWithSignature, eip712Domain. */
export const borrowerOperationsSignaturesAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "getNonce",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_amount",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "_upperHint",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_lowerHint",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_recipient",
        "type": "address"
      },
      {
        "internalType": "bytes",
        "name": "_signature",
        "type": "bytes"
      },
      {
        "internalType": "uint256",
        "name": "_deadline",
        "type": "uint256"
      }
    ],
    "name": "withdrawMUSDWithSignature",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "eip712Domain",
    "outputs": [
      {
        "internalType": "bytes1",
        "name": "fields",
        "type": "bytes1"
      },
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "version",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "chainId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "verifyingContract",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      },
      {
        "internalType": "uint256[]",
        "name": "extensions",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

/** HintHelpers — getApproxHint. */
export const hintHelpersAbi = [
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_CR",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_numTrials",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_inputRandomSeed",
        "type": "uint256"
      }
    ],
    "name": "getApproxHint",
    "outputs": [
      {
        "internalType": "address",
        "name": "hintAddress",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "diff",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "latestRandomSeed",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

/** SortedTroves — findInsertPosition. */
export const sortedTrovesAbi = [
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_NICR",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "_prevId",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_nextId",
        "type": "address"
      }
    ],
    "name": "findInsertPosition",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
