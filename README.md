# Sirius on Mezo

**Rent private data for one training run, pay in MUSD, receive only the model.**

Sirius is a data marketplace on Mezo. A data provider keeps their dataset encrypted; a buyer pays in **MUSD**, Mezo's Bitcoin-backed stablecoin, to rent it for one training run and receives **only the trained model**, never the raw data. The payment waits in an on-chain escrow on **Mezo**: it is released to the provider on delivery, or refunded after the deadline. On this testnet instance, training runs on the server's testnet runner and each result is signed with the escrow's settlement key; the public certificate page checks that signer against the escrow's on-chain `lockAuthorizer`.

Built for the **Mezo Buildathon** (October 2026), Wave 1 then Wave 2, in **Track 1 (DeFi) and Track 2 (Access and Distribution)**. MUSD is the escrow currency and the only settlement asset.

## Why MUSD

- Bitcoin holders get a **productive use for their dollars**: buy intelligence on private data without selling BTC.
- Data providers are paid in a **BTC-native stablecoin** through an escrow that releases atomically on delivery.
- The escrow is a plain ERC-20 flow (`approve` → `lock` → `release` / `refund`): composable with any MUSD wallet, vault or agent. AI agents can browse the catalogue through the built-in MCP server and pay per prediction in MUSD over x402.

## How it works

```text
Provider                        Mezo                         Borrower
  │                               │                               │
  ├─ encrypted CSV → IPFS         │                               │
  ├─ SiriusDatasetRegistry.mint   │                               │
  │                               │◄── SiriusEscrow.lock (MUSD) ───┤  hashlock + EIP-712 authorization
  │                               │                               │
  │  testnet runner: decrypts, trains, signs with settlement key  │
  │                               │                               │
  │◄── SiriusEscrow.release ──────┼── settlement confirmed ───────►│  model key delivered
  │    provider credited in MUSD  │                               │
  │                               │     refund after deadline ────►│  if nothing was delivered
```

1. The provider encrypts a CSV in the browser (AES-256-GCM), pins it to IPFS and mints a non-transferable dataset title on Mezo, bound to the file hash, Merkle root and training profile.
2. The borrower locks MUSD in `SiriusEscrow` with a SHA-256 hashlock and an EIP-712 authorization signed by the escrow's settlement key (`lockAuthorizer`).
3. The testnet runner decrypts the dataset, trains the model, signs the result with the same settlement key and produces the preimage.
4. `release` pays the provider in MUSD and publishes the preimage that opens the model capsule. Payments are pull-only: provider and treasury withdraw their MUSD credits.
5. If the model is never delivered, anyone can call `refund` after the deadline and the borrower gets their MUSD back.
6. Every run produces a public execution certificate (`/certificate/<id>`) that anyone can verify: it checks the result signature against the escrow's on-chain `lockAuthorizer` and links the settlement transaction.

## Mezo deployment

| Item | Value |
|---|---|
| Network | Mezo Testnet, chain id `31611` |
| RPC | `https://rpc.test.mezo.org` |
| Explorer | https://explorer.test.mezo.org |
| Gas | BTC (native, 18 decimals) |
| Settlement token | MUSD `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` (18 decimals) |
| `SiriusEscrow` (v6, MUSD, `lockWithSignature`, 2 % fee) | [`0xce6f236c0ada94e8813beb6a79866dc6138909c0`](https://explorer.test.mezo.org/address/0xce6f236c0ada94e8813beb6a79866dc6138909c0) |
| `SiriusDatasetRegistry` | [`0x6a80a8731cef8ad50fd33da394a7c610204d60a3`](https://explorer.test.mezo.org/address/0x6a80a8731cef8ad50fd33da394a7c610204d60a3) |
| `SiriusCheckout` (Pay with BTC) | [`0x66215c08a815e24b01a53f7526b73ce74426e368`](https://explorer.test.mezo.org/address/0x66215c08a815e24b01a53f7526b73ce74426e368) |
| `SiriusFeeRouter` | [`0x1ff4f5330b79ab662ae12d2605bd83d6ec84f2e2`](https://explorer.test.mezo.org/address/0x1ff4f5330b79ab662ae12d2605bd83d6ec84f2e2) |
| `SiriusMezoFeePolicy` (veMEZO discount) | [`0x6360c4c391b532bdb367084043afebb2c4fca584`](https://explorer.test.mezo.org/address/0x6360c4c391b532bdb367084043afebb2c4fca584) |
| `SiriusOpenKybRegistry` | [`0xf0ab86b45202c1600cb54b49cbd35bd3e4bb5392`](https://explorer.test.mezo.org/address/0xf0ab86b45202c1600cb54b49cbd35bd3e4bb5392) |
| Lock authorizer (app settlement account) | `0x2d017fb59077456E87C6f0E719dd75B03a910c8a` |
| Deployer and treasury | `0xF1b3C80fF7ffa2D6f609D51dC5483e8e8da036c1` |
| Live demo | https://sirius-mezo.vercel.app · [/proof](https://sirius-mezo.vercel.app/proof) · [/try](https://sirius-mezo.vercel.app/try) · [/break](https://sirius-mezo.vercel.app/break) |
| Manifest | [`deployments/mezo-testnet.json`](deployments/mezo-testnet.json) |

All six contracts are source-verified on the Mezo explorer (deployed 4 Nov 2026).

### Proof: a full MUSD loan on Mezo testnet

Demo dataset title minted by the provider `0xeeD8eC97B94613a765639Ea72a9410CCb82eAe4f`, then a complete fair-exchange cycle of 2 MUSD on the current contracts, signed by the application's settlement account. The provider receives 1.96 MUSD: the escrow keeps the 2 % platform fee at release.

| Step | Transaction |
|---|---|
| Dataset title minted (`SiriusDatasetRegistry.mint`) | [`0x151675a8…65f95d`](https://explorer.test.mezo.org/tx/0x151675a8aac6e08e439b9c60c7af1061879b57c13d5f6c48322332455c65f95d) |
| Borrower approves MUSD for the escrow | [`0x64a4355b…5f71c5`](https://explorer.test.mezo.org/tx/0x64a4355b6d1292682f4e18f95bf2539c5d0620e4775c2958771b1bf1705f71c5) |
| `SiriusEscrow.lock`: 2 MUSD locked with hashlock + EIP-712 authorization | [`0x2975b5aa…185e47`](https://explorer.test.mezo.org/tx/0x2975b5aa3d123098509fe1c3ef23c659aeec0cfbf811a38b33214c0296185e47) |
| `SiriusEscrow.release`: preimage published, provider credited net of the fee | [`0x876ec38b…97f897`](https://explorer.test.mezo.org/tx/0x876ec38bc6118568d678de727b4beba4bb6633cc6b601c63dcdc31a2e397f897) |
| `SiriusEscrow.withdrawFor`: provider receives 1.96 MUSD | [`0xe051cbbd…2e7d94`](https://explorer.test.mezo.org/tx/0xe051cbbd5239c83dd0cd871a1e65c2b6cea103d203d731c31a79fad6942e7d94) |
| x402: an agent pays 0.001 MUSD for one prediction, settled by Mezo's facilitator | [`0x50e71f23…c20ed0`](https://explorer.test.mezo.org/tx/0x50e71f23b2cabd4fa3070cf542aa9af102bf65da13d2315a44106b9211c20ed0) |
| One-signature payment: a buyer with no BTC signs; Sirius submits `lockWithSignature` and pays the gas | [`0x5c90a68c…95d193`](https://explorer.test.mezo.org/tx/0x5c90a68cf3e47c968e99936ae7eb09a0eaf7df19ec953f6d5934bcac0595d193) |
| Pay with BTC: BTC swapped on the Mezo Pools BTC/MUSD pool and locked, in one transaction | [`0xd8ee0d28…c07054`](https://explorer.test.mezo.org/tx/0xd8ee0d284929078d7ffe7600282bb8ee733957a9dc9812c518cf0ed6f5c07054) |
| Fees distributed: 0.02 MUSD to the treasury, 0.02 MUSD posted on the BTC/MUSD gauge for veBTC voters | [`0x9b25782b…d9607c`](https://explorer.test.mezo.org/tx/0x9b25782bb823c9f43660478b3a90ac40745fd84cd03fe19d42579707c1d9607c) |
| Provider earnings into Mezo's MUSD Stability Pool (`provideToSP`, 1 MUSD) | [`0xa3c31f31…b9676e`](https://explorer.test.mezo.org/tx/0xa3c31f31067d650b0d0908ec75bc0a5eb5a03849b473f73fba8e46271ab9676e) |

| Through the web app with MetaMask: three datasets published by three provider wallets, a fourth wallet pays 2 MUSD with one signature, the model is trained and the escrow released ([certificate](https://sirius-mezo.vercel.app/certificate/cmw46yuc1000008jthcuy2vdx)) | [`0xf0ca9216…438c04`](https://explorer.test.mezo.org/tx/0xf0ca92165954bd7a280c91df9d685d829990a0fcf5553705b5083c3f4f438c04) |

These were run with throwaway team wallets, the first ones by [`scripts/mezo-team-flows.ts`](scripts/mezo-team-flows.ts), the last one by hand on the live site; `/proof` lists them under team wallets, apart from external buyers.

**External buyers** (wallets outside the team, on the live site with MetaMask):

| Buyer | Dataset | Payment | Model delivered, escrow released |
|---|---|---|---|
| [`0xafce…d739`](https://explorer.test.mezo.org/address/0xafce23fb6d1aaa83e59e683e50436270be36d739) | Hourly energy demand – regional grid (10 MUSD) | [`0xf9214bd6…1e928e`](https://explorer.test.mezo.org/tx/0xf9214bd643da8ad7ab167f10f8e8609a5a863a1eab7ea1581e5ab191221e928e) | [`0xa9d53959…19c907`](https://explorer.test.mezo.org/tx/0xa9d53959515d286b38bcc75b69af1641892ecd8b8040da39d6a683f47919c907) |

Two earlier deployments ran the same cycle (escrows [`0xd14a0af1581bd7bd80d9da0f775c1c254967abda`](https://explorer.test.mezo.org/address/0xd14a0af1581bd7bd80d9da0f775c1c254967abda) and [`0xefb89e4c5d32581bf09122cb6f4cc60558a27f67`](https://explorer.test.mezo.org/address/0xefb89e4c5d32581bf09122cb6f4cc60558a27f67)); their transactions are listed on [/proof](https://sirius-mezo.vercel.app/proof). Each was replaced when the escrow gained a feature, since the escrow is immutable.

Reproduce it yourself (needs test BTC for gas and a few test MUSD on the deployer key):

```sh
node scripts/gen-deployer.mjs                 # throwaway key in .env.local, prints the address to fund
node --import tsx scripts/mezo-testnet.ts     # deploy, mint a demo dataset, run lock → release → withdraw in MUSD
node --import tsx scripts/mezo-testnet.ts --smoke   # replay only the MUSD loan on the deployed contracts
```

Mainnet target: Mezo chain id `31612`, MUSD `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186`. The deploy script refuses mainnet unless `SIRIUS_ALLOW_MAINNET=true` and only accepts MUSD as the settlement token there.

### Bitcoin wallets via Mezo Passport

With `NEXT_PUBLIC_MEZO_PASSPORT=true`, the connect menu offers **Bitcoin wallet · Mezo Passport**: Unisat, OKX Wallet or Xverse connect through [`@mezo-org/passport`](https://www.npmjs.com/package/@mezo-org/passport), and Mezo maps the Bitcoin account to a smart account on Mezo (an OrangeKit Safe owned by a contract that verifies Bitcoin signatures). The Passport connector is wrapped as an EIP-1193 provider, so the whole app — sign-in, runner delegation, MUSD payments, escrow — keeps using the same wallet layer. Sign-in and delegation signatures are Safe ERC-1271 signatures wrapped in ERC-6492 (so an account that has not been deployed yet can already sign), verified on-chain by the server with viem's `verifyMessage`; transactions go through Mezo's relayer and are paid by the smart account. EIP-712 consent signatures (sponsored KYB) are not available for Passport accounts yet. The flag defaults to off and leaves the MetaMask flow untouched.

## Contracts

- `SiriusEscrow` v6: MUSD escrow per loan, EIP-712 lock authorization from the settlement key (`lockAuthorizer`), SHA-256 hashlock, locked training profile, KYB check on both parties, atomic release before deadline, refund after deadline, pull-only payouts. `lockWithSignature` takes a MUSD permit and a signed lock request so the buyer pays no gas. Keeps a 2 % fee at release (1 % for veMEZO holders), never on a refund.
- `SiriusCheckout`: Pay with BTC in one transaction, swapping on the Mezo Pools BTC/MUSD pool under a Skip oracle bound, then locking through the buyer's signed request. No owner, holds nothing between calls.
- `SiriusFeeRouter`: receives the platform fee, pays half to the treasury and posts half as a MUSD incentive on Mezo's BTC/MUSD gauge. Permissionless, immutable.
- `SiriusMezoFeePolicy`: reads Mezo's vote-escrow at release to apply the veMEZO discount.
- `SiriusKybRegistry` v3: EIP-712 KYB attestations, consented by the subject, expirable, revocable. `SiriusOpenKybRegistry` validates everyone for the hackathon testnet instance.
- `SiriusDatasetRegistry` v4: non-transferable title of an encrypted dataset, bound to the CID hash, Merkle root, size and training profile.
- `SiriusEscrowV7` (not deployed): signed quote with separate dataset and compute prepayment.

Sources, tests and scripts live in [`contracts/`](contracts). TypeScript ABIs are generated into [`src/lib/evm/abi/`](src/lib/evm/abi).

## Stack

| Layer | Technology |
|---|---|
| Application | Next.js 16 · React 19 · Tailwind 4 · Prisma / PostgreSQL |
| Chain | Mezo (EVM compatible, Bitcoin-backed) · testnet `31611` · mainnet `31612` |
| Contracts | Solidity `0.8.24` · Hardhat · viem |
| Training | Testnet runner on the application server (no hardware isolation: use synthetic or non-sensitive data), each result signed with the escrow's settlement key |
| Storage | IPFS / Pinata · AES-256-GCM |
| Agents | MCP server (`/api/mcp`): catalogue search, dataset detail, protocol status, certificate verification · x402 paid predictions (`/api/x402/predict`) |

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

## Wave 2: MUSD as Bitcoin-backed money, not a generic ERC-20

Wave 1 used MUSD the way any ERC-20 would be used: approve, lock, release. Wave 2 plugs Sirius into what
is specific to MUSD on Mezo. Every item below is implemented in this repository; the switches that make a
Sirius account spend gas are off by default and documented in `.env.example`.

| Integration | What it does | Where |
|---|---|---|
| **One-signature payment** (`SiriusEscrow.lockWithSignature`) | The buyer signs an EIP-2612 `permit` on MUSD and an EIP-712 `LockRequest`; Sirius's settlement account submits the lock and pays the gas in BTC. No approve transaction, no BTC needed by the buyer. Per-borrower nonce, deadline, permit front-running tolerated when the allowance already covers the amount. | `contracts/src/SiriusEscrow.sol`, `src/lib/sirius/gasless-lock.ts`, `POST /api/loans/[id]/lock-with-signature`, flag `SIRIUS_GASLESS_LOCK` |
| **Pay with BTC** (`SiriusCheckout.buyWithBtc`) | One transaction: the BTC sent is swapped to MUSD on the Mezo Pools BTC/MUSD pool, checked against Mezo's Skip BTC/USD oracle (at most 3 % below, at most one hour old), and locked in the escrow through the buyer's signed request. The MUSD left over stays with the buyer; the contract holds nothing between calls and has no owner. Simulated against live testnet state before deployment. | `contracts/src/SiriusCheckout.sol`, `src/lib/sirius/btc-checkout.ts`, `GET /api/mezo/btc-quote`, `POST /api/loans/[id]/pay-with-btc`, flag `SIRIUS_PAY_WITH_BTC` |
| **Borrow & Buy** (`BorrowerOperationsSignatures.withdrawMUSDWithSignature`) | A buyer who holds a Mezo trove pays a training run by drawing only the missing MUSD against their BTC collateral: one signature, relayed by Sirius, MUSD minted straight to the buyer, then the escrow lock (in one signature when enabled). The UI shows debt and collateral ratio before and after, and refuses draws that would push the ratio under 1.21, exceed the trove's maximum borrowing capacity, or go against Recovery Mode (ratio under 150 % while the system is below its CCR). Insert hints come from `HintHelpers` and `SortedTroves`. | `src/lib/mezo/trove.ts`, `draw-relay.ts`, `GET /api/trove`, `POST /api/trove/draw`, flag `SIRIUS_BORROW_AND_BUY` |
| **Earnings put to work** | Providers route the MUSD they earned into the MUSD Stability Pool (earn seized BTC from liquidations) or the sMUSD savings vault (protocol yield), and back, from the wallet page. Live positions, honest copy, no invented APY. | `src/lib/mezo/earn*.ts`, `GET /api/wallet/earn`, `src/components/wallet/EarnCard.tsx`, flag `SIRIUS_MEZO_EARN` |
| **Paid predictions for agents (x402)** | An AI agent pays 0.001 MUSD per prediction with no account and no BTC: `POST /api/x402/predict` answers `402 Payment Required`, the agent signs a Permit2 + EIP-2612 authorization, and Mezo's x402 facilitator settles the MUSD transfer and pays the gas. Charged only when the prediction succeeds. Serves a demo model trained by the runner on a public dataset; buyers' models stay encrypted. First settlement: [`0x50e7…0ed0`](https://explorer.test.mezo.org/tx/0x50e71f23b2cabd4fa3070cf542aa9af102bf65da13d2315a44106b9211c20ed0). | `src/app/api/x402/predict/route.ts`, `src/lib/x402/config.ts`, `scripts/x402-agent.ts`, flag `SIRIUS_X402` |
| **Bitcoin wallets via Mezo Passport** | Connect Unisat, OKX or Xverse through `@mezo-org/passport`; the smart account is bridged into the existing wallet layer and server-side signature checks accept ERC-1271/6492 signatures. | `src/lib/wallet/passport*.ts`, flag `NEXT_PUBLIC_MEZO_PASSPORT` |
| **Verified contracts and public proof** | All deployed contracts are source-verified on the Mezo explorer; `/proof` lists network, contracts, live escrow accounting, every demo transaction and previous deployments, with no account needed. | `/proof`, `deployments/mezo-testnet.json`, `docs/MEZO-TESTNET.md` |
| **Platform fee that feeds Mezo** | The escrow keeps 2 % of each released payment, never of a refund. Providers holding veMEZO pay 1 %, read from Mezo's vote-escrow at release. `SiriusFeeRouter` sends half to the treasury and posts the other half as a MUSD incentive on Mezo's BTC/MUSD gauge, so veBTC voters earn from every training run sold. Permissionless, immutable, live on `/proof`. | `contracts/src/SiriusFeeRouter.sol`, `SiriusMezoFeePolicy.sol`, `src/lib/mezo/governance.ts`, `scripts/mezo-distribute-fees.ts` |
| **Try to break it** | `/break` replays a dozen attacks live against the deployed contracts (forged Sirius authorization, forged or malleable buyer signature, endless signed request, early refund, double release, rogue escrow binding, BTC parked in the checkout, admin key on the fee router) and shows the error each contract returned. Simulations only, from a keyless attacker address. | `src/lib/proof/attacks.ts`, `/break` |
| **Faucet on canonical MUSD** | The in-app faucet transfers 10 test MUSD from a funded reserve instead of calling `mint` on the canonical token (which only the protocol may do). | `src/lib/sirius/faucet.ts` |

Protocol addresses (testnet and mainnet proxies, verified on-chain) live in `src/lib/mezo/protocol.ts`.
The current escrow, registry, checkout and fee contracts were redeployed together on 4 Nov 2026; the
procedure is in [`docs/MEZO-TESTNET.md`](docs/MEZO-TESTNET.md).

## Roadmap

1. Mezo mainnet deployment with real MUSD, provider earnings routed to sMUSD, first data providers, KYB.
2. A hardware-isolated training runner for real data, keeping the same signed, verifiable certificates.
3. Agents buying full training runs, not only per-call predictions, with a capped budget signed by the agent's wallet.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [MCP server for agents](docs/MCP.md)
- [Mezo testnet deployment](docs/MEZO-TESTNET.md)

## Team

Ali Ben Yezza — founder, full-stack and smart contracts. GitHub [@alibenyezza](https://github.com/alibenyezza).
