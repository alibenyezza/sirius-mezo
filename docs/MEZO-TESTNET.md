# Mezo testnet — contract verification

Network: Mezo testnet, chain id `31611`. Explorer: https://explorer.test.mezo.org (Blockscout,
API at `https://api.explorer.test.mezo.org/api`). The deployed addresses live in
[`deployments/mezo-testnet.json`](../deployments/mezo-testnet.json).

## Verifying the contracts

The three contracts were source-verified on 31 October 2026 with the `hardhat verify` task
that ships in `@nomicfoundation/hardhat-toolbox-viem` (no extra package). It talks to the
Blockscout Etherscan-compatible endpoint declared under `etherscan.customChains` in
[`contracts/hardhat.config.ts`](../contracts/hardhat.config.ts) (network `mezoTestnet`,
any API key such as `blockscout` is accepted). Compiler settings come from the same config:
solc `0.8.24`, optimizer on with 200 runs, EVM `paris`.

Run everything from `contracts/`. Compile first so the artifacts match the sources being
submitted, then pass each contract's constructor arguments in order:

```bash
cd contracts
../node_modules/.bin/hardhat compile

# SiriusOpenKybRegistry — no constructor arguments
../node_modules/.bin/hardhat verify --network mezoTestnet \
  0xf0ab86b45202c1600cb54b49cbd35bd3e4bb5392

# SiriusDatasetRegistry(kyb_, admin_)  — admin is the deployer
../node_modules/.bin/hardhat verify --network mezoTestnet \
  0x2f7482e7cf68e9babda9e31b566ffcbaa3a9b969 \
  0xf0ab86b45202c1600cb54b49cbd35bd3e4bb5392 \
  0xF1b3C80fF7ffa2D6f609D51dC5483e8e8da036c1

# SiriusEscrow(usdc_, kyb_, datasets_, lockAuthorizer_) — usdc_ is MUSD
../node_modules/.bin/hardhat verify --network mezoTestnet \
  0xd14a0af1581bd7bd80d9da0f775c1c254967abda \
  0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 \
  0xf0ab86b45202c1600cb54b49cbd35bd3e4bb5392 \
  0x2f7482e7cf68e9babda9e31b566ffcbaa3a9b969 \
  0x2d017fb59077456E87C6f0E719dd75B03a910c8a
```

Each call ends with `Successfully verified contract <Name> on the block explorer.` The task
prints a deprecation warning about per-network Etherscan API keys; it is harmless here
because the endpoint is Blockscout, not Etherscan. If the two keys are ever removed, keep
the `customChains` entries and set a single `apiKey` string instead.

After a redeploy, take the new addresses and constructor arguments from
`deployments/mezo-testnet.json` (`contracts.*`, `settlementToken.address`, `deployer`,
`lockAuthorizer`) and rerun the three commands. If a contract was deployed from a source
that no longer matches the working tree, check out the commit that produced it before
compiling: the explorer compares the recompiled runtime bytecode byte for byte, ignoring
only the immutables and the metadata hash.

### Checking the result

The API reports the verification state; `is_fully_verified` must be `true` and `name` must
be the contract name:

```bash
curl -s https://api.explorer.test.mezo.org/api/v2/smart-contracts/0xd14a0af1581bd7bd80d9da0f775c1c254967abda \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.name,j.is_fully_verified,j.compiler_version,j.evm_version)})'
```

The explorer pages: `https://explorer.test.mezo.org/address/<address>?tab=contract`.

### Confirming the constructor arguments before verifying

The arguments must be the ones actually used at deployment, not the ones in a script. Two
independent sources agree for the current deployment:

- the trailing bytes of the creation transaction input, after the artifact's creation
  bytecode (`GET /api/v2/addresses/<address>` gives `creation_transaction_hash`,
  `GET /api/v2/transactions/<hash>` gives `raw_input`);
- the public getters: `SiriusEscrow.usdc()`, `kyb()`, `datasets()`, `lockAuthorizer()` and
  `SiriusDatasetRegistry.kyb()`, `admin()`.

### Fallback if the Hardhat task fails

The Blockscout API v2 accepts a standard-JSON submission directly, without any plugin.
`GET https://api.explorer.test.mezo.org/api/v2/smart-contracts/verification/config` lists the
supported compiler versions and license ids. Then:

```bash
# standard JSON input = the `input` field of contracts/artifacts/build-info/<hash>.json
node -e 'const b=require("./contracts/artifacts/build-info/"+require("fs").readdirSync("./contracts/artifacts/build-info")[0]);require("fs").writeFileSync("standard-input.json",JSON.stringify(b.input))'
curl -X POST "https://api.explorer.test.mezo.org/api/v2/smart-contracts/<address>/verification/via/standard-input" \
  -F "compiler_version=v0.8.24+commit.e11b9ed9" \
  -F "license_type=mit" \
  -F "contract_name=src/SiriusEscrow.sol:SiriusEscrow" \
  -F "files[0]=@standard-input.json"
```

It was not needed on 31 October 2026: the Hardhat route verified all three contracts.

## Redeploying the escrow

The escrow is immutable and `SiriusDatasetRegistry.bindEscrow` accepts exactly one escrow
(`EscrowAlreadyBound`). A new escrow — for example the v6 build that adds
`lockWithSignature` — therefore comes with a **new dataset registry**. The open KYB registry
(`0xf0ab86b45202c1600cb54b49cbd35bd3e4bb5392`, no state) and MUSD are reused.
`scripts/mezo-testnet.ts` does all of this in one run and keeps the history of the replaced
trio; its pure rules live in `scripts/mezo-manifest.ts` (tested without a chain).

Knobs read by the script (from `.env.local` or the shell):

| Variable | Default | Effect |
| --- | --- | --- |
| `SIRIUS_REUSE_KYB_ADDRESS` | `contracts.kyb` of `deployments/mezo-testnet.json` | KYB registry passed to the dataset registry and escrow constructors instead of deploying one. `contracts/scripts/deploy.ts` refuses an address without code on the target chain and reads `isKybValid(0x…dEaD)` on it (open mode; `isVerifier(verifier)` in strict mode) before sending anything. The address is still printed as `SIRIUS_KYB_ADDRESS=…`. |
| `SIRIUS_FRESH_KYB=true` | unset | Deploy a new open KYB registry anyway (ignored when `SIRIUS_REUSE_KYB_ADDRESS` is set). |
| `SIRIUS_LOCK_AUTHORIZER` | deployer | Lock signer of the new escrow: keep the application settlement account (`0x2d01…0c8a`) so the deployed Vercel instance can sign locks. |

### 1. Compile and run the deployment

```bash
cd contracts
../node_modules/.bin/hardhat compile
cd ..

# Reuses the KYB registry of the current manifest, deploys SiriusDatasetRegistry and
# SiriusEscrow, binds them, re-mints the demo dataset title and replays the 2 MUSD cycle.
node --import tsx scripts/mezo-testnet.ts
```

What the run changes locally:

- `.env.local`: `*_SIRIUS_ESCROW_ADDRESS`, `*_SIRIUS_DATASET_ADDRESS` (and the unchanged KYB /
  MUSD entries) point at the new trio; the replaced escrow is **appended** to
  `SIRIUS_LEGACY_ESCROW_ADDRESSES` (comma-separated, de-duplicated). Keep it: credits and
  refunds left on the old escrow stay readable and withdrawable through the application
  (`src/lib/evm/history.ts` only trusts the current escrow plus that list).
- `deployments/mezo-testnet.json`: the previous `contracts`, `lockAuthorizer`, `deployedAt`
  and `demo.transactions` move to the first element of the `previous` **array** (newest
  first; an older single `previous` object becomes the next element). `contracts.escrowVersion`
  is read from the contract's `VERSION()` and `contracts.escrowFeatures` lists
  `lockWithSignature` when the compiled ABI has it. The `verification` block is dropped
  (new addresses are unverified until step 2) and `evidence` is kept as is. The `demo`
  block is not carried over: fill it by hand from the explorer after the smoke, as before.
  `/proof` renders all of this (`src/lib/sirius/deployment-manifest.ts`).

`node --import tsx scripts/mezo-testnet.ts --smoke` replays the cycle on the manifest's
current trio without deploying anything.

### 2. Verify the new contracts

The dataset registry, the escrow and, with fees on (the default), the fee policy and the fee
router are new; the KYB registry keeps its verification.
Take the arguments from the manifest (`contracts.*`, `deployer`, `lockAuthorizer`,
`settlementToken.address`):

```bash
cd contracts

# SiriusDatasetRegistry(kyb_, admin_) — admin is the deployer
../node_modules/.bin/hardhat verify --network mezoTestnet \
  <contracts.datasets> \
  0xf0ab86b45202c1600cb54b49cbd35bd3e4bb5392 \
  <deployer>

# SiriusMezoFeePolicy(veMezo_, minPower_, discountedBps_) — veMEZO testnet, defaults 1e18 and 100
../node_modules/.bin/hardhat verify --network mezoTestnet \
  <contracts.feePolicy> \
  0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b 1000000000000000000 100

# SiriusFeeRouter(musd_, voter_, gauge_, treasury_, incentiveBps_) — PoolsVoter, BTC/MUSD gauge
../node_modules/.bin/hardhat verify --network mezoTestnet \
  <contracts.feeRouter> \
  0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 \
  0x263F1Fd5fB7F866881e1B6cD7d5d6c40Fd985F0D \
  0x72D88B0795373437E86792DEd8362D66dC43Cd2c \
  <treasury, the deployer by default> 5000

# SiriusEscrow(usdc_, kyb_, datasets_, lockAuthorizer_, feeRecipient_, feeBps_, feePolicy_)
../node_modules/.bin/hardhat verify --network mezoTestnet \
  <contracts.escrow> \
  0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 \
  0xf0ab86b45202c1600cb54b49cbd35bd3e4bb5392 \
  <contracts.datasets> \
  <lockAuthorizer> \
  <contracts.feeRouter> 200 <contracts.feePolicy>

# SiriusCheckout(escrow_, btc_, router_, poolFactory_, btcUsdFeed_, maxSlippageBps_, maxFeedAge_)
# BTC precompile, Mezo Pools router and factory, Skip BTC/USD feed precompile, 3 %, 1 h
../node_modules/.bin/hardhat verify --network mezoTestnet   <contracts.checkout>   <contracts.escrow>   0x7b7c000000000000000000000000000000000000   0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9   0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A   0x7b7c000000000000000000000000000000000015   300 3600
```

Then write the `verification` block back into `deployments/mezo-testnet.json` (see the
section above for its shape and the API check).

### 3. Update the Vercel environment

Set these on the project (Production and Preview), then redeploy so the server reads them:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SIRIUS_ESCROW_ADDRESS` | new `contracts.escrow` |
| `SIRIUS_ESCROW_ADDRESS` | new `contracts.escrow` |
| `NEXT_PUBLIC_SIRIUS_DATASET_ADDRESS` | new `contracts.datasets` |
| `SIRIUS_DATASET_ADDRESS` | new `contracts.datasets` |
| `SIRIUS_LEGACY_ESCROW_ADDRESSES` | previous value + `,<old contracts.escrow>` (the value written to `.env.local`) |

`*_SIRIUS_KYB_ADDRESS`, `*_SIRIUS_USDC_ADDRESS`, `SIRIUS_USDC_CODE_HASH` and
`SIRIUS_LOCK_AUTHORIZER` do not change when the KYB registry is reused and the signer is kept.
`/status` shows the addresses the instance runs with; `/proof` shows the manifest.

### 4. Datasets must be re-minted on the new registry

Dataset titles are soulbound tokens of the dataset registry; the new registry starts empty
and the application checks the title on the **configured** registry before every lock. What
exists today:

- the demo dataset (`mezo-demo-energy-consumption`) is re-minted by `scripts/mezo-testnet.ts`
  itself, by the demo provider account;
- datasets published through the UI by other providers keep their database row
  (`evmDatasetId`, `evmChainId`, `evmMintTxHash` in `prisma/schema.prisma`) but their title
  lives on the old registry: they must be re-published by their provider (new upload →
  new mint), since a registry binds one escrow only. There is no
  automated migration of titles;
- `src/lib/sirius/migration-check.ts` (run by `scripts/check-evm-migration.ts` at deploy
  time) checks **loans**, not datasets: it refuses to start if an old loan is still active on an
  undeclared escrow. `pnpm contracts:check-upgrade` (`src/lib/sirius/escrow-upgrade.ts`)
  checks the same on the live chain, including that nothing is still locked in the old
  escrows listed in `SIRIUS_LEGACY_ESCROW_ADDRESSES`;
- `scripts/mezo-adopt.ts <kyb> <datasets> <escrow>` adopts a trio that is already on-chain
  (e.g. after a lost receipt) and rewrites `.env.local` and the manifest **without** the
  `previous` history and without re-minting anything; prefer `mezo-testnet.ts` for a
  planned redeploy.

## MUSD yield venues

Two Mezo protocol contracts let idle MUSD earn. Sirius only reads them and builds calldata for
them (`src/lib/mezo/earn-abi.ts`, `src/lib/mezo/earn-transactions.ts`, `src/lib/mezo/earn.ts`);
the addresses are the proxies listed in `src/lib/mezo/protocol.ts` and shown on `/status`.
Both take MUSD (18 decimals) and need an ERC-20 `approve` on the MUSD token first
(testnet `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`).

### Stability Pool

Testnet proxy `0x1CCA7E410eE41739792eA0A24e00349Dd247680e`, mainnet
`0x73245Eff485aB3AAc1158B3c4d8f4b23797B0e32`. Deposits absorb liquidated trove debt and
receive the liquidated collateral (native BTC) in exchange. ABI: `mezo-org/musd`,
`solidity/artifacts/deployments/matsnet/StabilityPool.json`.

| Call | Purpose |
| --- | --- |
| `provideToSP(uint256 amount)` | deposit MUSD (after `approve`) |
| `withdrawFromSP(uint256 amount)` | withdraw MUSD; also pays out the pending BTC gain |
| `getCompoundedMUSDDeposit(address) view` | current deposit, net of absorbed liquidations |
| `getDepositorCollateralGain(address) view` | pending BTC gain, 18 decimals |
| `getTotalMUSDDeposits() view` | pool size |

**Testnet caveat.** `withdrawFromSP(amount > 0)` reverts while any trove is below the minimum
collateral ratio (MCR, 110 %). That is the case on testnet right now: the lowest trove has an
ICR of 1.081, so a positive withdrawal fails until that trove is liquidated or topped up.
`withdrawFromSP(0)` is still accepted and only claims the pending collateral gain. The check
sits in the protocol's `_requireNoUnderCollateralizedTroves`; a UI must expect the revert and
not treat it as a bug on its side.

### sMUSD savings vault (`MUSDSavingsRate`)

Testnet `0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16`, mainnet
`0xb4D498029af77680cD1eF828b967f010d06C51CC`. It is **not** an ERC-4626 vault: deposits mint
sMUSD shares 1:1 and the yield is tracked separately and claimed explicitly. Source verified on
Blockscout (`/api/v2/smart-contracts/0x92d12f0a60906b39d81acd9bf8977b6c824cd98c`).

| Call | Purpose |
| --- | --- |
| `deposit(uint256 amount)` | deposit MUSD (after `approve`), receive the same amount of sMUSD |
| `withdraw(uint256 amount)` | burn sMUSD, get MUSD back |
| `claimYield() returns (uint256)` | pay out the accrued yield in MUSD |
| `claimableYield(address) view` | accrued yield not yet claimed |
| `balanceOf(address)`, `totalSupply()`, `name()`, `symbol()` | standard token reads (`symbol()` = `sMUSD`) |

### Reading a position

`readEarnPosition(account, network)` (server only) returns the MUSD balance, the allowances
granted to both venues and the two positions. Each venue is read in its own `try/catch`: if one
contract fails the other is still returned and the failing one carries `available: false`.

## One-signature payment relay (`lockWithSignature`)

Flag: `SIRIUS_GASLESS_LOCK=true`. Requires an escrow that exposes `lockNonces` (v6 with
`lockWithSignature`, as deployed on 4 Nov 2026); on an older escrow the routes answer 409.

1. `POST /api/loans` prepares the loan as usual (runner hashlock, lock authorization).
2. `GET /api/loans/{id}/lock-with-signature` renews the authorization, decodes the exact lock terms the
   classic flow would send, reads `lockNonces(borrower)` on the escrow and `nonces(borrower)` plus the
   EIP-712 domain (`eip712Domain()`, fallback name/"1") on MUSD, and returns two typed-data payloads:
   the ERC-2612 `Permit` (spender = escrow, value = amount) and the `LockRequest`. `permitRequired` is
   false when the allowance already covers the amount.
3. The wallet signs both with `eth_signTypedData_v4`; no transaction is sent by the buyer.
4. `POST /api/loans/{id}/lock-with-signature` renews the authorization again, compares every signed term
   with the server-side terms, checks nonce and deadline, simulates `lockWithSignature` from the
   settlement account (a deterministic revert costs no gas), sends it, then runs the same
   `finalizeLoan` as the classic flow. `assertLoanLockTransaction` accepts a relayed lock whose signed
   `LockRequest.borrower` is the loan's borrower.

Limits: 3 relays per hour per account, 120 per hour per instance. The relayer only pays gas; the
LockAuthorization signed by Sirius and the LockRequest signed by the buyer both bind the full terms.

## Borrow & Buy relay (`withdrawMUSDWithSignature`)

Flag: `SIRIUS_BORROW_AND_BUY=true`. The buyer signs `WithdrawMUSD(amount, borrower, recipient = borrower,
nonce, deadline)` under the `BorrowerOperationsSignatures` domain (name "BorrowerOperationsSignatures",
version "1"). `POST /api/trove/draw` re-reads the trove, refuses a draw whose resulting collateral ratio
would fall under MCR × 1.10 (= 121 %), checks the nonce against `getNonce(borrower)`, recomputes the
sorted-troves hints (unsigned, gas only), simulates and submits from the settlement account, waits for
the receipt and returns the new position. The protocol adds the 0.1 % borrowing fee to the trove debt and
mints the MUSD to the buyer; the relayer never holds it. Limits: 5 draws per hour per account.

Demo prerequisite: the buyer needs an active trove on https://testnet.mezo.org (minimum 1,800 MUSD net
debt plus 200 MUSD gas compensation, so roughly 0.035 BTC of test collateral at 77k USD/BTC for a 121 %
ratio). None of the demo accounts had one on 31 October 2026.

## Earnings routes

Flag: `SIRIUS_MEZO_EARN=true` (server).
`GET /api/wallet/earn` returns the position in both venues; with `?action=provide|withdraw-sp|
deposit-savings|withdraw-savings|claim-yield&amount=<atomic>` it also returns the transactions to sign,
prefixed by an MUSD `approve` when the venue's allowance is short. The wallet signs them one by one.

## Platform fee routed back to Mezo

The escrow keeps `feeBps` (200 = 2 %, capped at 10 % in the contract) of every **released**
payment and credits it, pull-only, to `SiriusFeeRouter`. Refunds pay no fee.

- **veMEZO discount.** At release the escrow asks `SiriusMezoFeePolicy.feeBpsFor(provider, base)`
  through a 300k-gas `staticcall`. A provider whose veMEZO voting power (first five positions,
  `votingPowerOfNFT`) reaches `minPower` pays `discountedBps` (100 = 1 %). A revert, an
  out-of-gas, a malformed or a higher answer falls back to the base fee: the policy can never
  block a release or raise the fee. veMEZO returns zero power in the block an NFT moves, so a
  position cannot be flash-borrowed into the release.
- **Router.** `distribute(escrow)` is permissionless. It pulls the router's credit
  (`withdrawFor` is permissionless too, so the router holds no escrow address), sends
  `10000 - incentiveBps` to the treasury and posts the rest with
  `BribeVotingReward.notifyRewardAmount(MUSD, amount)` on the BTC/MUSD gauge of the v2
  PoolsVoter, so veBTC holders who vote for that pool earn from every run sold. It holds the
  incentive instead of posting when the gauge is dead, when the bribe has no votes (an
  epoch's reward would be unclaimable), and in the first and last hour of an epoch (Thursday
  00:00 UTC), and posts it on a later call.
- **Dependencies, read-only check.** `node --import tsx scripts/mezo-fee-check.ts [testnet|mainnet]`
  confirms the voter, gauge, bribe, MUSD whitelisting, votes on the bribe, veMEZO and veBTC.
  Addresses: `src/lib/mezo/governance.ts` (the v1 contracts in `mezo-org/tigris` are stale).
- **Distributing.** `node --import tsx scripts/mezo-distribute-fees.ts` simulates; add `--send`
  to send the transaction from the settlement or deployer key.
- **Configuration.** `SIRIUS_FEE_BPS` (0 disables the fee and deploys neither contract),
  `SIRIUS_FEE_TREASURY`, `SIRIUS_FEE_INCENTIVE_BPS` (default 5000), `SIRIUS_FEE_DISCOUNT_BPS`
  (default 100), `SIRIUS_FEE_MIN_VEMEZO_POWER` (default 1e18). `scripts/mezo-testnet.ts`
  deploys with 2 % and the deployer as treasury unless configured.

## Pay with BTC (Mezo Pools + oracle)

`SiriusCheckout` lets a buyer pay for a training run with BTC in one transaction. The BTC sent
with `buyWithBtc` is swapped to MUSD on the Mezo Pools BTC/MUSD basic pool
(`0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9`, router `0x9a1f…E7E9`), the MUSD lands in the
buyer's wallet, and the escrow locks the price from it through the buyer's signed `LockRequest`
(same signatures as the one-signature payment). The swap must clear the buyer's minimum (the
price) and an oracle floor: Mezo's Skip BTC/USD precompile (`0x7b7c…0015`), at most one hour old,
at most 3 % below. The contract never holds funds between calls and has no owner.

It was checked against live testnet state before deployment: `eth_call` with a state override
(checkout code at a free address, a stub escrow) swapped 0.0001 BTC for 7.858 MUSD through the
real router, BTC precompile and oracle, about 286k gas.

The deploy script deploys it after the escrow (`SIRIUS_CHECKOUT=false` skips it) and prints
`SIRIUS_CHECKOUT_ADDRESS`. Flags: `SIRIUS_PAY_WITH_BTC=true` plus `SIRIUS_CHECKOUT_ADDRESS`
(server) and `NEXT_PUBLIC_SIRIUS_CHECKOUT_ADDRESS`. Passport accounts do not see the button:
the escrow checks an EOA signature.
