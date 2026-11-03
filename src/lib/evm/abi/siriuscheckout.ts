// Généré par `pnpm contracts:abi` — ne pas modifier à la main.
// Source : contracts/src/SiriusCheckout.sol

export const siriuscheckoutAbi = [
  {
    "inputs": [
      {
        "internalType": "contract SiriusEscrow",
        "name": "escrow_",
        "type": "address"
      },
      {
        "internalType": "contract IERC20Checkout",
        "name": "btc_",
        "type": "address"
      },
      {
        "internalType": "contract IMezoPoolsRouter",
        "name": "router_",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "poolFactory_",
        "type": "address"
      },
      {
        "internalType": "contract IPriceFeed",
        "name": "btcUsdFeed_",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "maxSlippageBps_",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxFeedAge_",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "ApproveFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BadOraclePrice",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "musdOut",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "floor",
        "type": "uint256"
      }
    ],
    "name": "BelowOracleFloor",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidConfig",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoBtc",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotBuyer",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "Reentrancy",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "updatedAt",
        "type": "uint256"
      }
    ],
    "name": "StaleOracle",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "received",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "expected",
        "type": "uint256"
      }
    ],
    "name": "SwapShortfall",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "loanKey",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "buyer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "btcIn",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "musdOut",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "oraclePrice",
        "type": "uint256"
      }
    ],
    "name": "PaidWithBtc",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "VERSION",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "btc",
    "outputs": [
      {
        "internalType": "contract IERC20Checkout",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "btcUsdFeed",
    "outputs": [
      {
        "internalType": "contract IPriceFeed",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "minMusdOut",
        "type": "uint256"
      },
      {
        "components": [
          {
            "internalType": "address",
            "name": "borrower",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "provider",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "hashlock",
            "type": "bytes32"
          },
          {
            "internalType": "uint8",
            "name": "challengeDays",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "loanIdHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "datasetId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "trainingProfile",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "internalType": "struct SiriusEscrow.LockRequest",
        "name": "request",
        "type": "tuple"
      },
      {
        "internalType": "bytes",
        "name": "borrowerSignature",
        "type": "bytes"
      },
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "value",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          },
          {
            "internalType": "uint8",
            "name": "v",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "r",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "s",
            "type": "bytes32"
          }
        ],
        "internalType": "struct SiriusEscrow.Permit",
        "name": "permit",
        "type": "tuple"
      },
      {
        "components": [
          {
            "internalType": "uint40",
            "name": "deadline",
            "type": "uint40"
          },
          {
            "internalType": "bytes",
            "name": "signature",
            "type": "bytes"
          }
        ],
        "internalType": "struct SiriusEscrow.LockAuthorization",
        "name": "authorization",
        "type": "tuple"
      }
    ],
    "name": "buyWithBtc",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "loanKey",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "musdOut",
        "type": "uint256"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "escrow",
    "outputs": [
      {
        "internalType": "contract SiriusEscrow",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxFeedAge",
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
    "name": "maxSlippageBps",
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
    "name": "musd",
    "outputs": [
      {
        "internalType": "contract IERC20Checkout",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "btcIn",
        "type": "uint256"
      }
    ],
    "name": "oracleFloor",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "price",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "fair",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "floor",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "poolFactory",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "router",
    "outputs": [
      {
        "internalType": "contract IMezoPoolsRouter",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "stateMutability": "payable",
    "type": "receive"
  }
] as const;
