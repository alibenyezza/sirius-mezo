import { authorizedLockArgs, type LockArgs } from "./helpers/lock";
import { expect } from "chai";
import { createHash, randomBytes } from "node:crypto";
import hre from "hardhat";
import { keccak256, parseEther, toHex, zeroAddress, type Address, type Hex } from "viem";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { datasetIdHash } from "../../src/lib/evm/dataset-key";
import { loanIdHash } from "../../src/lib/evm/loan-key";
import { lockRequestTypedData, musdPermitTypedData, permitFromSignature, type LockRequest } from "../../src/lib/evm/lock-request";

/**
 * SiriusCheckout : payer un entraînement en BTC, en une transaction. Le BTC envoyé est
 * échangé en MUSD sur le pool BTC/MUSD de Mezo Pools, le MUSD arrive chez l'acheteur et
 * l'escrow le verrouille par sa requête signée. Le swap doit passer le minimum de
 * l'acheteur et un plancher calculé sur l'oracle BTC/USD.
 */

const DAY = 24 * 60 * 60;
const YEAR = 365 * DAY;
const TRAINING_PROFILE = keccak256(toHex("sirius.training-profile.v1:linear_regression:1.0.0"));
const PRICE = parseEther("77000"); // MUSD par BTC selon l'oracle
const AMOUNT = parseEther("5");
const BTC_IN = parseEther("0.0001"); // 7,7 MUSD au prix oracle
const SLIPPAGE_BPS = 300n;

type Wallet = Awaited<ReturnType<typeof hre.viem.getWalletClients>>[number];

async function fixture() {
  const [admin, verifier, borrower, provider, stranger] = await hre.viem.getWalletClients();
  const musd = await hre.viem.deployContract("SiriusTestUsdc");
  const kyb = await hre.viem.deployContract("SiriusKybRegistry", [admin.account.address, verifier.account.address]);
  const publicClient = await hre.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const grantKyb = async (wallet: Wallet) => {
    const subject = wallet.account.address;
    const expiresAt = (await time.latest()) + YEAR;
    const signature = await verifier.signTypedData({
      domain: { name: "SiriusKybRegistry", version: "2", chainId, verifyingContract: kyb.address },
      types: {
        KybAttestation: [
          { name: "subject", type: "address" },
          { name: "verifier", type: "address" },
          { name: "expiresAt", type: "uint40" },
          { name: "nonce", type: "uint256" },
          { name: "verifierEpoch", type: "uint64" },
        ],
      },
      primaryType: "KybAttestation",
      message: {
        subject, verifier: verifier.account.address, expiresAt, nonce: await kyb.read.nonces([subject]),
        verifierEpoch: await kyb.read.verifierEpoch([verifier.account.address]),
      },
    });
    await kyb.write.acceptAttestation([verifier.account.address, expiresAt, signature], { account: wallet.account });
  };
  await Promise.all([grantKyb(borrower), grantKyb(provider)]);
  const registry = await hre.viem.deployContract("SiriusDatasetRegistry", [kyb.address, admin.account.address]);
  const escrow = await hre.viem.deployContract("SiriusEscrow", [
    musd.address, kyb.address, registry.address, admin.account.address, zeroAddress, 0n, zeroAddress,
  ]);
  await registry.write.bindEscrow([escrow.address], { account: admin.account });
  await registry.write.mint([datasetIdHash("checkout"), keccak256(toHex("cid")), keccak256(toHex("root")), 1n, TRAINING_PROFILE], {
    account: provider.account,
  });
  const datasetId = await registry.read.datasetIdOf([provider.account.address, datasetIdHash("checkout")]);

  const btc = await hre.viem.deployContract("MockBtcPrecompile");
  const router = await hre.viem.deployContract("MockPoolsRouter");
  const feed = await hre.viem.deployContract("MockPriceFeed");
  await feed.write.set([PRICE, BigInt(await time.latest())]);
  await router.write.setRate([PRICE]);
  await musd.write.mint([router.address, parseEther("100000")]);
  const factory = "0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A" as Address;
  const checkout = await hre.viem.deployContract("SiriusCheckout", [
    escrow.address, btc.address, router.address, factory, feed.address, SLIPPAGE_BPS, 3600n,
  ]);
  return { admin, borrower, provider, stranger, musd, escrow, datasetId, btc, router, feed, checkout, publicClient, chainId };
}

type Ctx = Awaited<ReturnType<typeof fixture>>;

/** Requête, signature, permit et autorisation d'un achat, comme les prépare le serveur. */
async function signedPurchase(ctx: Ctx, amount = AMOUNT) {
  const preimage = randomBytes(32);
  const hashlock = `0x${createHash("sha256").update(preimage).digest("hex")}` as Hex;
  const deadline = BigInt((await time.latest()) + 300);
  const request: LockRequest = {
    borrower: ctx.borrower.account.address,
    provider: ctx.provider.account.address,
    amount,
    hashlock,
    challengeDays: 7,
    loanIdHash: loanIdHash(`loan_${randomBytes(8).toString("hex")}`),
    datasetId: ctx.datasetId,
    trainingProfile: TRAINING_PROFILE,
    nonce: await ctx.escrow.read.lockNonces([ctx.borrower.account.address]),
    deadline,
  };
  const signature = await ctx.borrower.signTypedData(lockRequestTypedData({ chainId: ctx.chainId, escrow: ctx.escrow.address, request }));
  const permitSignature = await ctx.borrower.signTypedData(musdPermitTypedData({
    chainId: ctx.chainId, token: ctx.musd.address, tokenName: "Sirius Test USDC", tokenVersion: "1",
    owner: ctx.borrower.account.address, spender: ctx.escrow.address, value: amount,
    nonce: await ctx.musd.read.nonces([ctx.borrower.account.address]), deadline,
  }));
  const permit = permitFromSignature(permitSignature, amount, deadline);
  const args: LockArgs = [request.provider as Address, amount, hashlock, 7, request.loanIdHash, ctx.datasetId, TRAINING_PROFILE];
  const authorization = (await authorizedLockArgs(ctx.admin, ctx.escrow.address, ctx.borrower.account.address, args))[7];
  return { request, signature, permit, authorization };
}

describe("SiriusCheckout", () => {
  it("échange le BTC en MUSD et verrouille l'achat en une transaction", async () => {
    const ctx = await loadFixture(fixture);
    const { request, signature, permit, authorization } = await signedPurchase(ctx);
    const hash = await ctx.checkout.write.buyWithBtc([AMOUNT, request, signature, permit, authorization], {
      account: ctx.borrower.account, value: BTC_IN,
    });
    const receipt = await ctx.publicClient.getTransactionReceipt({ hash });
    const loanKey = await ctx.escrow.read.loanKeyOf([ctx.borrower.account.address, request.loanIdHash]);
    const loan = await ctx.escrow.read.getLoan([loanKey]);
    expect(loan.status).to.equal(1); // Locked
    expect(loan.borrower.toLowerCase()).to.equal(ctx.borrower.account.address.toLowerCase());
    expect(loan.amount).to.equal(AMOUNT);
    // 7,7 MUSD reçus, 5 verrouillés : le reste reste à l'acheteur.
    expect(await ctx.musd.read.balanceOf([ctx.borrower.account.address])).to.equal(BTC_IN * PRICE / parseEther("1") - AMOUNT);
    expect(await ctx.musd.read.balanceOf([ctx.checkout.address])).to.equal(0n);
    expect(await ctx.btc.read.allowance([ctx.checkout.address, ctx.router.address])).to.equal(0n);
    expect(await ctx.btc.read.pulled()).to.equal(BTC_IN);
    const paid = await ctx.checkout.getEvents.PaidWithBtc({}, { blockHash: receipt.blockHash });
    expect(paid[0].args.loanKey).to.equal(loanKey);
    expect(paid[0].args.oraclePrice).to.equal(PRICE);
  });

  it("refuse un swap sous le plancher de l'oracle, même si l'acheteur accepte moins", async () => {
    const ctx = await loadFixture(fixture);
    await ctx.router.write.setRate([PRICE * 96n / 100n]); // pool 4 % sous l'oracle, tolérance 3 %
    const { request, signature, permit, authorization } = await signedPurchase(ctx);
    await expect(ctx.checkout.write.buyWithBtc([0n, request, signature, permit, authorization], {
      account: ctx.borrower.account, value: BTC_IN,
    })).to.be.rejectedWith("INSUFFICIENT_OUTPUT_AMOUNT");
  });

  it("respecte le minimum de l'acheteur quand il est au-dessus du plancher", async () => {
    const ctx = await loadFixture(fixture);
    const { request, signature, permit, authorization } = await signedPurchase(ctx);
    await expect(ctx.checkout.write.buyWithBtc([parseEther("8"), request, signature, permit, authorization], {
      account: ctx.borrower.account, value: BTC_IN,
    })).to.be.rejectedWith("INSUFFICIENT_OUTPUT_AMOUNT");
  });

  it("mesure ce que l'acheteur reçoit vraiment", async () => {
    const ctx = await loadFixture(fixture);
    await ctx.router.write.setShortchange([true]);
    const { request, signature, permit, authorization } = await signedPurchase(ctx);
    await expect(ctx.checkout.write.buyWithBtc([AMOUNT, request, signature, permit, authorization], {
      account: ctx.borrower.account, value: BTC_IN,
    })).to.be.rejectedWith("SwapShortfall");
  });

  it("refuse un oracle périmé, futur ou négatif", async () => {
    const ctx = await loadFixture(fixture);
    const { request, signature, permit, authorization } = await signedPurchase(ctx);
    const now = BigInt(await time.latest());
    for (const [answer, updatedAt, error] of [
      [PRICE, now - 7200n, "StaleOracle"], [PRICE, now + 600n, "StaleOracle"], [0n, now, "BadOraclePrice"], [-1n, now, "BadOraclePrice"],
    ] as const) {
      await ctx.feed.write.set([answer, updatedAt]);
      await expect(ctx.checkout.write.buyWithBtc([AMOUNT, request, signature, permit, authorization], {
        account: ctx.borrower.account, value: BTC_IN,
      })).to.be.rejectedWith(error);
    }
  });

  it("seul l'acheteur paie, avec du BTC, et la signature reste celle de l'escrow", async () => {
    const ctx = await loadFixture(fixture);
    const { request, signature, permit, authorization } = await signedPurchase(ctx);
    await expect(ctx.checkout.write.buyWithBtc([AMOUNT, request, signature, permit, authorization], {
      account: ctx.stranger.account, value: BTC_IN,
    })).to.be.rejectedWith("NotBuyer");
    await expect(ctx.checkout.write.buyWithBtc([AMOUNT, request, signature, permit, authorization], {
      account: ctx.borrower.account, value: 0n,
    })).to.be.rejectedWith("NoBtc");
    const forged = await ctx.stranger.signTypedData(lockRequestTypedData({ chainId: ctx.chainId, escrow: ctx.escrow.address, request }));
    await expect(ctx.checkout.write.buyWithBtc([AMOUNT, request, forged, permit, authorization], {
      account: ctx.borrower.account, value: BTC_IN,
    })).to.be.rejectedWith("InvalidBorrowerSignature");
  });

  it("refuse le BTC envoyé sans achat", async () => {
    const ctx = await loadFixture(fixture);
    await expect(ctx.borrower.sendTransaction({ to: ctx.checkout.address, value: 1n })).to.be.rejected;
  });

  it("refuse une configuration incohérente", async () => {
    const ctx = await loadFixture(fixture);
    const factory = "0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A" as Address;
    for (const [slippage, age] of [[0n, 3600n], [1_001n, 3600n], [300n, 0n], [300n, BigInt(2 * DAY)]] as const) {
      await expect(hre.viem.deployContract("SiriusCheckout", [
        ctx.escrow.address, ctx.btc.address, ctx.router.address, factory, ctx.feed.address, slippage, age,
      ])).to.be.rejectedWith("InvalidConfig");
    }
    await ctx.feed.write.setDecimals([8]);
    await expect(hre.viem.deployContract("SiriusCheckout", [
      ctx.escrow.address, ctx.btc.address, ctx.router.address, factory, ctx.feed.address, 300n, 3600n,
    ])).to.be.rejectedWith("InvalidConfig");
    await expect(hre.viem.deployContract("SiriusCheckout", [
      zeroAddress, ctx.btc.address, ctx.router.address, factory, ctx.feed.address, 300n, 3600n,
    ])).to.be.rejectedWith("ZeroAddress");
  });

  it("donne le plancher de l'oracle pour un montant de BTC", async () => {
    const ctx = await loadFixture(fixture);
    const [price, fair, floor] = await ctx.checkout.read.oracleFloor([BTC_IN]);
    expect(price).to.equal(PRICE);
    expect(fair).to.equal(parseEther("7.7"));
    expect(floor).to.equal(parseEther("7.7") * 9_700n / 10_000n);
  });
});
