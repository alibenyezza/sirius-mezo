# Sirius on Mezo

**Train on confidential datasets, pay in MUSD, receive only the model.**

Sirius is a confidential data marketplace. A data provider keeps their dataset encrypted; a borrower pays for a training job that runs inside a hardware enclave (Intel TDX via Phala dstack) and receives **only the trained model**, never the raw data. Settlement and audit trail live on **Mezo**, with **MUSD**, Mezo's Bitcoin-backed stablecoin, as the only settlement asset.

Built for the **Mezo Buildathon, Wave 1** (October 2026). Sirius is an existing product, live in production on another EVM chain; this repository is the port of its contracts and application to Mezo, with MUSD as the escrow currency.

## Why MUSD

- Bitcoin holders get a **productive use for their dollars**: buy intelligence on private data without selling BTC.
- Data providers are paid in a **BTC-native stablecoin** through an escrow that releases atomically on delivery.
- The escrow is a plain ERC-20 flow (`approve` → `lock` → `release` / `refund`): composable with any MUSD wallet, vault or agent. AI agents can buy a training run through the built-in MCP server and pay in MUSD.

## How it works

```text
Provider                        Mezo                         Borrower
  │                               │                               │
  ├─ encrypted CSV → IPFS         │                               │
  ├─ SiriusDatasetRegistry.mint   │                               │
  │                               │◄── SiriusEscrow.lock (MUSD) ───┤  hashlock + EIP-712 authorization
  │                               │                               │
  │          Phala TEE: decrypts in the enclave, trains, attests  │
  │                               │                               │
  │◄── SiriusEscrow.release ──────┼── settlement confirmed ───────►│  model key delivered
  │    provider credited in MUSD  │                               │
  │                               │     refund after deadline ────►│  if nothing was delivered
```

1. The provider encrypts a CSV in the browser (AES-256-GCM), pins it to IPFS and mints a non-transferable dataset title on Mezo, bound to the file hash, Merkle root and training profile.
2. The borrower locks MUSD in `SiriusEscrow` with a SHA-256 hashlock and an EIP-712 authorization signed by the enclave.
3. The enclave decrypts the dataset, trains the model, produces a signed attestation and the preimage.
4. `release` pays the provider in MUSD and publishes the preimage that opens the model capsule. Payments are pull-only: provider and treasury withdraw their MUSD credits.
5. If the model is never delivered, anyone can call `refund` after the deadline and the borrower gets their MUSD back.
6. Every run produces a public execution certificate (`/certificate/<id>`) that anyone can verify.

## Mezo deployment

| Item | Value |
|---|---|
| Network | Mezo Testnet, chain id `31611` |
| RPC | `https://rpc.test.mezo.org` |
| Explorer | https://explorer.test.mezo.org |
| Gas | BTC (native, 18 decimals) |
| Settlement token | MUSD `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` (18 decimals) |
| `SiriusOpenKybRegistry` | [`0xf0ab86b45202c1600cb54b49cbd35bd3e4bb5392`](https://explorer.test.mezo.org/address/0xf0ab86b45202c1600cb54b49cbd35bd3e4bb5392) |
| `SiriusDatasetRegistry` | [`0x2f7482e7cf68e9babda9e31b566ffcbaa3a9b969`](https://explorer.test.mezo.org/address/0x2f7482e7cf68e9babda9e31b566ffcbaa3a9b969) |
| `SiriusEscrow` (v6, MUSD) | [`0xd14a0af1581bd7bd80d9da0f775c1c254967abda`](https://explorer.test.mezo.org/address/0xd14a0af1581bd7bd80d9da0f775c1c254967abda) |
| Lock authorizer (app settlement account) | `0x2d017fb59077456E87C6f0E719dd75B03a910c8a` |
| Deployer | `0xF1b3C80fF7ffa2D6f609D51dC5483e8e8da036c1` |
| Live demo | https://sirius-mezo.vercel.app |
| Manifest | [`deployments/mezo-testnet.json`](deployments/mezo-testnet.json) |

### Proof: a full MUSD loan on Mezo testnet

Demo dataset title minted by the provider `0xeeD8eC97B94613a765639Ea72a9410CCb82eAe4f`, then a complete fair-exchange cycle settled in MUSD (2 MUSD, hashlock `64bd9c9b…431cdb`), signed by the application's settlement account:

| Step | Transaction |
|---|---|
| Dataset title minted (`SiriusDatasetRegistry.mint`) | [`0x495bc76b…aa06d6`](https://explorer.test.mezo.org/tx/0x495bc76b6080466ae634e407e4b7e805b2b411986c46f084d9c0930bb6aa06d6) |
| Borrower approves MUSD for the escrow | [`0x9c6e98d1…d56689`](https://explorer.test.mezo.org/tx/0x9c6e98d1af6dfa37e28902e50150dee547b977cc9338b2915a4f18c07cd56689) |
| `SiriusEscrow.lock` — 2 MUSD locked with hashlock + EIP-712 authorization | [`0xa2db7f43…f152a9`](https://explorer.test.mezo.org/tx/0xa2db7f4339341f9bd7aea932408bc339389526e6dcdb5a4673cd5467fbf152a9) |
| `SiriusEscrow.release` — preimage published, provider credited | [`0x765c78e9…09085c`](https://explorer.test.mezo.org/tx/0x765c78e91717068ce567f95807f1994c81cfacdadd101ccbca391b2c0d09085c) |
| `SiriusEscrow.withdrawFor` — provider receives 2 MUSD | [`0xc72a906b…dd77d50`](https://explorer.test.mezo.org/tx/0xc72a906b375bea2360e3bee9a67c572fedd68c4abcbf4ad537a4029ffdd77d50) |

An earlier trio (escrow [`0xefb89e4c…a27f67`](https://explorer.test.mezo.org/address/0xefb89e4c5d32581bf09122cb6f4cc60558a27f67)) ran the same cycle with the deployer as signer: lock [`0x24014c3c…719871`](https://explorer.test.mezo.org/tx/0x24014c3cf3be895ce67b8c5dd9378d519815c5efcdd7e2cb27c15e41fc719871), release [`0x1aa9d179…d4714`](https://explorer.test.mezo.org/tx/0x1aa9d179dc82613fe05180faa49dc03ed942e21777fd0cbb8ad92691b14d4714).

Reproduce it yourself (needs test BTC for gas and a few test MUSD on the deployer key):

```sh
node scripts/gen-deployer.mjs                 # throwaway key in .env.local, prints the address to fund
node --import tsx scripts/mezo-testnet.ts     # deploy, mint a demo dataset, run lock → release → withdraw in MUSD
node --import tsx scripts/mezo-testnet.ts --smoke   # replay only the MUSD loan on the deployed contracts
```

Mainnet target: Mezo chain id `31612`, MUSD `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186`. The deploy script refuses mainnet unless `SIRIUS_ALLOW_MAINNET=true` and only accepts MUSD as the settlement token there.

## Contracts

- `SiriusEscrow` v6: MUSD escrow per loan, EIP-712 lock authorization from the enclave, SHA-256 hashlock, locked training profile, KYB check on both parties, atomic release before deadline, refund after deadline, pull-only payouts. Reads `decimals()` on-chain so the minimum amount follows the token.
- `SiriusEscrowV7`: signed quote, dataset + compute prepayment, separate provider / treasury credits, refund with capped retention of attested fees. Integrated locally, explicit opt-in.
- `SiriusKybRegistry` v3: EIP-712 KYB attestations, consented by the subject, expirable, revocable. `SiriusOpenKybRegistry` validates everyone for the hackathon testnet instance.
- `SiriusDatasetRegistry` v4: non-transferable title of an encrypted dataset, bound to the CID hash, Merkle root, size and training profile.

Sources, tests and scripts live in [`contracts/`](contracts). TypeScript ABIs are generated into [`src/lib/evm/abi/`](src/lib/evm/abi).

## Stack

| Layer | Technology |
|---|---|
| Application | Next.js 16 · React 19 · Tailwind 4 · Prisma / PostgreSQL |
| Chain | Mezo (EVM compatible, Bitcoin-backed) · testnet `31611` · mainnet `31612` |
| Contracts | Solidity `0.8.24` · Hardhat · viem |
| Confidential compute | Phala dstack (Intel TDX), isolated HTTP runner, RA-TLS |
| Storage | IPFS / Pinata · AES-256-GCM |
| Agents | MCP server (`/api/mcp`): catalogue search, dataset detail, protocol status, certificate verification |

## Quickstart

Requirements: Node 22+, pnpm, PostgreSQL (or Docker).

```sh
pnpm install
cp .env.example .env.local        # fill DATABASE_URL and the contract addresses below
pnpm prisma migrate deploy
pnpm dev                          # http://localhost:3000
```

Deploy the contracts on Mezo testnet:

```sh
pnpm contracts:compile
# .env.local: MEZO_DEPLOYER_KEY, SIRIUS_USDC_ADDRESS (MUSD), SIRIUS_USDC_CODE_HASH,
#             SIRIUS_LOCK_AUTHORIZER, SIRIUS_KYB_MODE=open, SIRIUS_ALLOW_SHARED_ROLES=true
pnpm contracts:deploy:testnet
pnpm contracts:abi
```

Get test BTC at https://faucet.test.mezo.org and test MUSD by borrowing against BTC at https://testnet.mezo.org.

Checks:

```sh
pnpm typecheck
pnpm test
pnpm contracts:test
```

## Roadmap (Wave 2)

1. Full application flow on Mezo testnet: wallet, marketplace, training, certificate, all settled in MUSD.
2. Phala enclave wired to the Mezo escrow, signed execution certificates, MEZO support for platform fees.
3. Mezo mainnet deployment with real MUSD, first data providers, KYB.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Escrow v6](docs/ESCROW-V6.md) · [Escrow v7](docs/ESCROW-V7.md) · [Billing integration](docs/BILLING-INTEGRATION.md)
- [MCP server for agents](docs/MCP.md)
- [Confidential runner (Phala)](docs/PHALA.md) · [Runner budgets](docs/RUNNER-BUDGETS.md)
- [Roadmap](docs/ROADMAP.md) · [Decisions](docs/DECISIONS.md)

## Team

Ali Ben Yezza — founder, full-stack and smart contracts. GitHub [@alibenyezza](https://github.com/alibenyezza) · X [@sirius_data](https://x.com/sirius_data).
