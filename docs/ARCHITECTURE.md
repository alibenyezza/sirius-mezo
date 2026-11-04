# Architecture

Sirius keeps three things apart: the **data** (encrypted, on IPFS), the **compute** (a training runner)
and the **settlement** (contracts on Mezo, paid in MUSD). This page describes the Mezo testnet instance at
https://sirius-mezo.vercel.app. Addresses are in [`deployments/mezo-testnet.json`](../deployments/mezo-testnet.json)
and on [`/proof`](https://sirius-mezo.vercel.app/proof).

## Components

| Part | What it does | Where |
|---|---|---|
| Web app and API | Next.js 16 app router: marketplace, dataset pages, wallet, training, public proof pages, API routes | `src/app`, `src/lib` |
| Database | Accounts, dataset listings, loans and their states, audit ledger (PostgreSQL via Prisma) | `prisma/` |
| Contracts | Escrow, dataset titles, KYB, Pay with BTC checkout, fee policy and fee router | `contracts/src` |
| Training runner | Decrypts a dataset, trains the chosen profile, signs the result | `src/runner`, `src/lib/runner` |
| Storage | Encrypted dataset blobs (AES-256-GCM) pinned to IPFS | `src/lib/crypto`, `src/lib/ipfs` |
| Agent interfaces | Read-only MCP server and x402 paid predictions | `src/app/api/mcp`, `src/app/api/x402` |

## Settlement of one training run

1. **Publish.** The provider encrypts a CSV in the browser and the encrypted blob goes to IPFS. The provider
   then mints a non-transferable title in `SiriusDatasetRegistry`. The title is bound to the CID hash, Merkle
   root, size and training profile.
2. **Lock.** The buyer locks MUSD in `SiriusEscrow` under a SHA-256 hashlock. The lock carries an EIP-712
   authorization from the escrow's `lockAuthorizer`, which is the app's settlement account. There are three
   ways to pay:
   - `approve` then `lock`, from the buyer's wallet.
   - **One signature** (`lockWithSignature`). The buyer signs a MUSD EIP-2612 permit and an EIP-712
     `LockRequest`, and the settlement account submits them and pays the BTC gas.
   - **Pay with BTC** (`SiriusCheckout.buyWithBtc`). The BTC is swapped to MUSD on the Mezo Pools BTC/MUSD pool,
     bounded by Mezo's Skip BTC/USD oracle, then locked through the buyer's signed request in the same transaction.
   - A buyer short of MUSD can first **draw from a Mezo trove**. This is one signature on
     `BorrowerOperationsSignatures.withdrawMUSDWithSignature`, relayed by the app, and it checks the ratio
     floor, the borrowing capacity and Recovery Mode.
3. **Train.** The runner checks the loan terms against the chain, decrypts the dataset, trains the model,
   signs the result with the settlement key and derives the hashlock preimage.
4. **Release.** `release(loanKey, preimage)` settles the loan before the deadline. The provider is credited
   net of the platform fee: 2 %, or 1 % when `SiriusMezoFeePolicy` sees veMEZO. Revealing the preimage opens
   the model capsule for the buyer. All payouts are pull-only (`withdraw` / `withdrawFor`).
5. **Refund.** With no delivery by the deadline, anyone can call `refund`, and the buyer withdraws the full
   amount. A refund pays no fee.
6. **Certificate.** `/certificate/<loanId>` shows the result signature and checks it against the escrow's
   on-chain `lockAuthorizer`, with a link to the settlement transaction.

## Where MUSD goes next

- **Fees.** The escrow credits fees to `SiriusFeeRouter`. Anyone can call `distribute`: half goes to the
  treasury, and half is posted as a MUSD incentive on Mezo's BTC/MUSD gauge, for veBTC voters.
- **Provider earnings.** From the wallet page a provider can move earnings into Mezo's Stability Pool or the
  sMUSD savings vault, and back.
- **Agents.** `POST /api/x402/predict` sells one prediction for 0.001 MUSD over x402. Mezo's facilitator
  settles the transfer and pays the gas. See [MCP.md](MCP.md).

## Trust boundaries on this testnet

- **Runner.** The runner is not hardware-isolated on this instance. Use synthetic or non-sensitive data
  only. Each result is signed with the settlement key the escrow trusts, so anyone can check who produced it.
- **Raw data.** The browser encrypts the dataset before upload, and only the encrypted blob is stored. On this
  instance the runner runs inside the app server, so the dataset is decrypted in that server's memory for
  training.
- **Settlement account.** It signs lock authorizations, relays one-signature locks and trove draws, and
  pays their gas. It can never move a buyer's MUSD without the buyer's signature. Requests are rebuilt
  server-side and simulated before sending.
- **Contracts.** The escrow, checkout and fee router have no owner, proxy or upgrade path. `/break` replays 13 attacks
  against the deployed contracts and shows each revert.
- **KYB.** `SiriusOpenKybRegistry` validates every address on this hackathon instance. `SiriusKybRegistry`
  v3, with EIP-712 attestations, is in the repository.

## Feature flags

Each Mezo integration has its own environment flag, documented in `.env.example`:

- `SIRIUS_GASLESS_LOCK`
- `SIRIUS_PAY_WITH_BTC`
- `SIRIUS_BORROW_AND_BUY`
- `SIRIUS_MEZO_EARN`
- `SIRIUS_X402`
- `SIRIUS_MCP_ENABLED`
- `NEXT_PUBLIC_MEZO_PASSPORT`

`/status` shows which ones are on.
