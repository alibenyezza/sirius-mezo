import { authorizedLockArgs, type LockArgs } from "./helpers/lock";
import { expect } from "chai";
import { createHash, randomBytes } from "node:crypto";
import hre from "hardhat";
import { keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { datasetIdHash } from "../../src/lib/evm/dataset-key";
import { loanIdHash } from "../../src/lib/evm/loan-key";
import {
  NO_PERMIT, lockRequestTypedData, musdPermitTypedData, permitFromSignature, type LockRequest,
} from "../../src/lib/evm/lock-request";

/**
 * `lockWithSignature` : le borrower signe hors chaîne (EIP-712 + permit EIP-2612), un
 * relayer soumet la transaction. Le jeton de test `SiriusTestUsdc` expose `permit`
 * comme le MUSD canonique de Mezo.
 */

const DAY = 24 * 60 * 60;
const YEAR = 365 * DAY;
const DATASET_ID = "signature-dataset";
const DATASET_CID_HASH = keccak256(toHex("signature-cid"));
const DATASET_MERKLE_ROOT = keccak256(toHex("signature-merkle-root"));
const TRAINING_PROFILE = keccak256(toHex("sirius.training-profile.v1:linear_regression:1.0.0"));
const AMOUNT = parseEther("25");
const INITIAL_BALANCE = parseEther("1000");

type Wallet = Awaited<ReturnType<typeof hre.viem.getWalletClients>>[number];

function teePreimage(): { preimage: Hex; hashlock: Hex } {
  const preimage = randomBytes(32);
  return {
    preimage: `0x${preimage.toString("hex")}`,
    hashlock: `0x${createHash("sha256").update(preimage).digest("hex")}`,
  };
}

async function fixture() {
  const [admin, verifier, borrower, provider, stranger, relayer] = await hre.viem.getWalletClients();
  const usdc = await hre.viem.deployContract("SiriusTestUsdc");
  const kyb = await hre.viem.deployContract("SiriusKybRegistry", [admin.account.address, verifier.account.address]);
  const chainId = await (await hre.viem.getPublicClient()).getChainId();
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
  await Promise.all([grantKyb(borrower), grantKyb(provider), grantKyb(stranger)]);
  const registry = await hre.viem.deployContract("SiriusDatasetRegistry", [kyb.address, admin.account.address]);
  const escrow = await hre.viem.deployContract("SiriusEscrow", [usdc.address, kyb.address, registry.address, admin.account.address, "0x0000000000000000000000000000000000000000", 0n, "0x0000000000000000000000000000000000000000"]);
  await registry.write.bindEscrow([escrow.address], { account: admin.account });
  await registry.write.mint([datasetIdHash(DATASET_ID), DATASET_CID_HASH, DATASET_MERKLE_ROOT, 1n, TRAINING_PROFILE], {
    account: provider.account,
  });
  const datasetId = await registry.read.datasetIdOf([provider.account.address, datasetIdHash(DATASET_ID)]);
  const publicClient = await hre.viem.getPublicClient();
  await usdc.write.mint([borrower.account.address, INITIAL_BALANCE]);
  await usdc.write.mint([stranger.account.address, INITIAL_BALANCE]);
  return { escrow, registry, datasetId, kyb, usdc, publicClient, chainId, admin, verifier, borrower, provider, stranger, relayer };
}

type Ctx = Awaited<ReturnType<typeof fixture>>;

async function buildRequest(ctx: Ctx, overrides: Partial<LockRequest> = {}) {
  const { preimage, hashlock } = teePreimage();
  const request: LockRequest = {
    borrower: ctx.borrower.account.address,
    provider: ctx.provider.account.address,
    amount: AMOUNT,
    hashlock,
    challengeDays: 7,
    loanIdHash: loanIdHash(`loan_${randomBytes(8).toString("hex")}`),
    datasetId: ctx.datasetId,
    trainingProfile: TRAINING_PROFILE,
    nonce: await ctx.escrow.read.lockNonces([ctx.borrower.account.address]),
    deadline: BigInt((await time.latest()) + 3600),
    ...overrides,
  };
  return { request, preimage };
}

function signRequest(ctx: Ctx, signer: Wallet, request: LockRequest) {
  return signer.signTypedData(lockRequestTypedData({ chainId: ctx.chainId, escrow: ctx.escrow.address, request }));
}

async function signPermit(ctx: Ctx, signer: Wallet, value: bigint, deadline?: bigint) {
  const permitDeadline = deadline ?? BigInt((await time.latest()) + 3600);
  const signature = await signer.signTypedData(musdPermitTypedData({
    chainId: ctx.chainId, token: ctx.usdc.address, tokenName: "Sirius Test USDC", tokenVersion: "1",
    owner: signer.account.address, spender: ctx.escrow.address, value, nonce: await ctx.usdc.read.nonces([signer.account.address]),
    deadline: permitDeadline,
  }));
  return permitFromSignature(signature, value, permitDeadline);
}

/** Autorisation Sirius sur les mêmes termes que la requête : c'est elle qui lie le borrower. */
async function authorize(ctx: Ctx, request: LockRequest, borrower: Address = request.borrower as Address) {
  const args: LockArgs = [request.provider as Address, request.amount, request.hashlock, request.challengeDays,
    request.loanIdHash, request.datasetId, request.trainingProfile];
  return (await authorizedLockArgs(ctx.admin, ctx.escrow.address, borrower, args))[7];
}

async function relayedLock(ctx: Ctx, overrides: Partial<LockRequest> = {}) {
  const { request, preimage } = await buildRequest(ctx, overrides);
  const signature = await signRequest(ctx, ctx.borrower, request);
  const permit = await signPermit(ctx, ctx.borrower, request.amount);
  const authorization = await authorize(ctx, request);
  await ctx.escrow.write.lockWithSignature([request, signature, permit, authorization], { account: ctx.relayer.account });
  const loanKey = await ctx.escrow.read.loanKeyOf([ctx.borrower.account.address, request.loanIdHash]);
  return { request, preimage, loanKey };
}

describe("SiriusEscrow lockWithSignature", () => {
  it("un relayer verrouille pour le borrower avec sa signature et un permit frais", async () => {
    const ctx = await loadFixture(fixture);
    const { request, preimage } = await buildRequest(ctx);
    const signature = await signRequest(ctx, ctx.borrower, request);
    const permit = await signPermit(ctx, ctx.borrower, request.amount);
    const authorization = await authorize(ctx, request);

    expect(await ctx.usdc.read.allowance([ctx.borrower.account.address, ctx.escrow.address])).to.equal(0n);
    const hash = await ctx.escrow.write.lockWithSignature([request, signature, permit, authorization], { account: ctx.relayer.account });
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).to.equal("success");

    const loanKey = await ctx.escrow.read.loanKeyOf([ctx.borrower.account.address, request.loanIdHash]);
    const loan = await ctx.escrow.read.getLoan([loanKey]);
    expect(loan.borrower.toLowerCase()).to.equal(ctx.borrower.account.address.toLowerCase());
    expect(loan.provider.toLowerCase()).to.equal(ctx.provider.account.address.toLowerCase());
    expect(loan.amount).to.equal(AMOUNT);
    expect(loan.hashlock).to.equal(request.hashlock);
    expect(loan.status).to.equal(1);

    const events = await ctx.escrow.getEvents.LoanLocked({ loanKey });
    expect(events).to.have.lengthOf(1);
    expect(events[0].args.borrower?.toLowerCase()).to.equal(ctx.borrower.account.address.toLowerCase());

    expect(await ctx.usdc.read.balanceOf([ctx.escrow.address])).to.equal(AMOUNT);
    expect(await ctx.usdc.read.balanceOf([ctx.borrower.account.address])).to.equal(INITIAL_BALANCE - AMOUNT);
    expect(await ctx.usdc.read.balanceOf([ctx.relayer.account.address])).to.equal(0n);
    expect(await ctx.escrow.read.lockNonces([ctx.borrower.account.address])).to.equal(1n);
    expect(await ctx.usdc.read.nonces([ctx.borrower.account.address])).to.equal(1n);
    expect(await ctx.escrow.read.lockedUsdc()).to.equal(AMOUNT);
    expect(preimage).to.have.lengthOf(66);
  });

  it("refuse le rejeu d'une requête consommée (nonce)", async () => {
    const ctx = await loadFixture(fixture);
    const { request } = await buildRequest(ctx);
    const signature = await signRequest(ctx, ctx.borrower, request);
    const permit = await signPermit(ctx, ctx.borrower, request.amount * 2n);
    const authorization = await authorize(ctx, request);
    await ctx.escrow.write.lockWithSignature([request, signature, permit, authorization], { account: ctx.relayer.account });

    // Même signature, même permit déjà consommé, allowance restante suffisante : seul le nonce bloque.
    await expect(ctx.escrow.write.lockWithSignature([request, signature, permit, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("InvalidBorrowerSignature");
    // Un nonce avancé sans nouvelle signature ne passe pas non plus.
    await expect(ctx.escrow.write.lockWithSignature([{ ...request, nonce: 1n }, signature, permit, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("InvalidBorrowerSignature");
    expect(await ctx.escrow.read.lockedUsdc()).to.equal(AMOUNT);
  });

  it("refuse une requête expirée avant toute vérification de signature", async () => {
    const ctx = await loadFixture(fixture);
    const { request } = await buildRequest(ctx, { deadline: BigInt((await time.latest()) + 60) });
    const signature = await signRequest(ctx, ctx.borrower, request);
    const permit = await signPermit(ctx, ctx.borrower, request.amount);
    const authorization = await authorize(ctx, request);
    await time.increaseTo(Number(request.deadline));
    await expect(ctx.escrow.write.lockWithSignature([request, signature, permit, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("LockRequestExpired");
    expect(await ctx.escrow.read.lockNonces([ctx.borrower.account.address])).to.equal(0n);
  });

  it("refuse un mauvais signataire, une signature malformée et des termes altérés", async () => {
    const ctx = await loadFixture(fixture);
    const { request } = await buildRequest(ctx);
    const permit = await signPermit(ctx, ctx.borrower, request.amount);
    const authorization = await authorize(ctx, request);
    const genuine = await signRequest(ctx, ctx.borrower, request);

    const foreign = await signRequest(ctx, ctx.stranger, request);
    await expect(ctx.escrow.write.lockWithSignature([request, foreign, permit, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("InvalidBorrowerSignature");
    await expect(ctx.escrow.write.lockWithSignature([request, "0x", permit, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("InvalidBorrowerSignature");
    await expect(ctx.escrow.write.lockWithSignature([request, `${genuine}00` as Hex, permit, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("InvalidBorrowerSignature");
    // Le relayer modifie le montant : la signature du borrower ne couvre plus la requête.
    await expect(ctx.escrow.write.lockWithSignature([{ ...request, amount: request.amount + 1n }, genuine, permit, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("InvalidBorrowerSignature");
    // Signature d'un autre domaine (autre escrow) : refusée.
    const otherDomain = await ctx.borrower.signTypedData(lockRequestTypedData({ chainId: ctx.chainId, escrow: ctx.usdc.address, request }));
    await expect(ctx.escrow.write.lockWithSignature([request, otherDomain, permit, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("InvalidBorrowerSignature");
    // Un relayer ne peut pas non plus substituer un borrower : l'autorisation Sirius est liée à l'adresse.
    const { request: hijacked } = await buildRequest(ctx, { borrower: ctx.stranger.account.address, nonce: 0n });
    const strangerSignature = await signRequest(ctx, ctx.stranger, hijacked);
    const strangerPermit = await signPermit(ctx, ctx.stranger, hijacked.amount);
    await expect(ctx.escrow.write.lockWithSignature([hijacked, strangerSignature, strangerPermit, await authorize(ctx, hijacked, ctx.borrower.account.address)], { account: ctx.relayer.account }))
      .to.be.rejectedWith("InvalidLockAuthorization");

    await ctx.escrow.write.lockWithSignature([request, genuine, permit, authorization], { account: ctx.relayer.account });
    expect(await ctx.escrow.read.lockedUsdc()).to.equal(AMOUNT);
  });

  it("tolère un permit déjà consommé quand l'allowance couvre le montant", async () => {
    const ctx = await loadFixture(fixture);
    const { request } = await buildRequest(ctx);
    const signature = await signRequest(ctx, ctx.borrower, request);
    const permit = await signPermit(ctx, ctx.borrower, request.amount);
    const authorization = await authorize(ctx, request);

    // Un tiers rejoue le permit directement sur le jeton (front-running) : l'allowance est posée, le nonce consommé.
    await ctx.usdc.write.permit([ctx.borrower.account.address, ctx.escrow.address, permit.value, permit.deadline, permit.v, permit.r, permit.s], { account: ctx.stranger.account });
    expect(await ctx.usdc.read.nonces([ctx.borrower.account.address])).to.equal(1n);

    await ctx.escrow.write.lockWithSignature([request, signature, permit, authorization], { account: ctx.relayer.account });
    expect(await ctx.escrow.read.lockedUsdc()).to.equal(AMOUNT);
    expect(await ctx.usdc.read.nonces([ctx.borrower.account.address])).to.equal(1n);
  });

  it("verrouille sans permit sur une allowance préexistante", async () => {
    const ctx = await loadFixture(fixture);
    const { request } = await buildRequest(ctx);
    await ctx.usdc.write.approve([ctx.escrow.address, request.amount], { account: ctx.borrower.account });
    const signature = await signRequest(ctx, ctx.borrower, request);
    await ctx.escrow.write.lockWithSignature([request, signature, NO_PERMIT, await authorize(ctx, request)], { account: ctx.relayer.account });
    expect(await ctx.escrow.read.lockedUsdc()).to.equal(AMOUNT);
    expect(await ctx.usdc.read.nonces([ctx.borrower.account.address])).to.equal(0n);
  });

  it("refuse un permit invalide sans allowance de secours", async () => {
    const ctx = await loadFixture(fixture);
    const { request } = await buildRequest(ctx);
    const signature = await signRequest(ctx, ctx.borrower, request);
    const authorization = await authorize(ctx, request);

    const foreignPermit = await signPermit(ctx, ctx.stranger, request.amount);
    await expect(ctx.escrow.write.lockWithSignature([request, signature, foreignPermit, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("PermitFailed");
    const stale = await signPermit(ctx, ctx.borrower, request.amount, BigInt((await time.latest()) - 1));
    await expect(ctx.escrow.write.lockWithSignature([request, signature, stale, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("PermitFailed");
    // Permit valide mais trop petit : l'allowance posée ne couvre pas le montant, le transfert échoue.
    const short = await signPermit(ctx, ctx.borrower, request.amount - 1n);
    await expect(ctx.escrow.write.lockWithSignature([request, signature, short, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("TokenTransferFailed");
    expect(await ctx.escrow.read.lockedUsdc()).to.equal(0n);
    expect(await ctx.escrow.read.lockNonces([ctx.borrower.account.address])).to.equal(0n);
  });

  it("refuse qu'un borrower se paie lui-même", async () => {
    const ctx = await loadFixture(fixture);
    const { request } = await buildRequest(ctx, { provider: ctx.borrower.account.address });
    const signature = await signRequest(ctx, ctx.borrower, request);
    const permit = await signPermit(ctx, ctx.borrower, request.amount);
    await expect(ctx.escrow.write.lockWithSignature([request, signature, permit, await authorize(ctx, request)], { account: ctx.relayer.account }))
      .to.be.rejectedWith("SelfDealing");
  });

  it("applique les mêmes contrôles que lock : KYB du borrower et titre vivant", async () => {
    const ctx = await loadFixture(fixture);
    const { request } = await buildRequest(ctx);
    const signature = await signRequest(ctx, ctx.borrower, request);
    const permit = await signPermit(ctx, ctx.borrower, request.amount);
    const authorization = await authorize(ctx, request);
    await ctx.kyb.write.revoke([ctx.borrower.account.address], { account: ctx.verifier.account });
    await expect(ctx.escrow.write.lockWithSignature([request, signature, permit, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("KybRequired");
  });

  it("le prêt se libère, se rembourse et se retire exactement comme après lock", async () => {
    const ctx = await loadFixture(fixture);
    const released = await relayedLock(ctx, { challengeDays: 7 });
    await ctx.escrow.write.release([released.loanKey, released.preimage], { account: ctx.relayer.account });
    const [revealed, published] = await ctx.escrow.read.preimageOf([released.loanKey]);
    expect(revealed).to.equal(true);
    expect(published).to.equal(released.preimage);
    expect(await ctx.escrow.read.creditOf([ctx.provider.account.address])).to.equal(AMOUNT);
    await ctx.escrow.write.withdraw({ account: ctx.provider.account });
    expect(await ctx.usdc.read.balanceOf([ctx.provider.account.address])).to.equal(AMOUNT);

    const refunded = await relayedLock(ctx, { challengeDays: 1 });
    expect(await ctx.escrow.read.lockNonces([ctx.borrower.account.address])).to.equal(2n);
    await expect(ctx.escrow.write.refund([refunded.loanKey], { account: ctx.relayer.account })).to.be.rejectedWith("ChallengePeriodActive");
    await time.increase(2 * DAY);
    await ctx.escrow.write.refund([refunded.loanKey], { account: ctx.relayer.account });
    expect(await ctx.escrow.read.creditOf([ctx.borrower.account.address])).to.equal(AMOUNT);
    await ctx.escrow.write.withdrawFor([ctx.borrower.account.address], { account: ctx.relayer.account });
    expect(await ctx.usdc.read.balanceOf([ctx.borrower.account.address])).to.equal(INITIAL_BALANCE - AMOUNT);

    const [locked, owed, balance] = await ctx.escrow.read.accounting();
    expect(locked).to.equal(0n);
    expect(owed).to.equal(0n);
    expect(balance).to.equal(0n);
  });
});

describe("SiriusEscrow lockWithSignature : annulation et bornes", () => {
  it("cancelLockNonce annule une requête déjà signée", async () => {
    const ctx = await loadFixture(fixture);
    const { request } = await buildRequest(ctx);
    const signature = await signRequest(ctx, ctx.borrower, request);
    const permit = await signPermit(ctx, ctx.borrower, request.amount);
    const authorization = await authorize(ctx, request);
    await ctx.escrow.write.cancelLockNonce({ account: ctx.borrower.account });
    expect(await ctx.escrow.read.lockNonces([ctx.borrower.account.address])).to.equal(request.nonce + 1n);
    await expect(ctx.escrow.write.lockWithSignature([request, signature, permit, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("InvalidBorrowerSignature");
  });

  it("refuse un nonce futur", async () => {
    const ctx = await loadFixture(fixture);
    const { request } = await buildRequest(ctx, { nonce: 1n });
    const signature = await signRequest(ctx, ctx.borrower, request);
    const authorization = await authorize(ctx, request);
    await expect(ctx.escrow.write.lockWithSignature([request, signature, NO_PERMIT, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("InvalidBorrowerSignature");
  });

  it("refuse une requête valable plus d'un jour", async () => {
    const ctx = await loadFixture(fixture);
    const { request } = await buildRequest(ctx, { deadline: BigInt((await time.latest()) + 2 * DAY) });
    const signature = await signRequest(ctx, ctx.borrower, request);
    const authorization = await authorize(ctx, request);
    await expect(ctx.escrow.write.lockWithSignature([request, signature, NO_PERMIT, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("LockRequestExpired");
  });

  it("refuse une signature malléable (s haut) et un v brut 0 ou 1", async () => {
    const ctx = await loadFixture(fixture);
    const { request } = await buildRequest(ctx);
    const signature = await signRequest(ctx, ctx.borrower, request);
    const authorization = await authorize(ctx, request);
    const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
    const r = signature.slice(2, 66);
    const s = BigInt(`0x${signature.slice(66, 130)}`);
    const v = Number.parseInt(signature.slice(130, 132), 16);
    const highS = `0x${r}${(N - s).toString(16).padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}` as Hex;
    const rawV = `0x${signature.slice(2, 130)}${(v - 27).toString(16).padStart(2, "0")}` as Hex;
    for (const bad of [highS, rawV]) {
      await expect(ctx.escrow.write.lockWithSignature([request, bad, NO_PERMIT, authorization], { account: ctx.relayer.account }))
        .to.be.rejectedWith("InvalidBorrowerSignature");
    }
  });

  it("refuse une signature faite pour une autre chaîne", async () => {
    const ctx = await loadFixture(fixture);
    const { request } = await buildRequest(ctx);
    const otherChain = await ctx.borrower.signTypedData(lockRequestTypedData({ chainId: ctx.chainId + 1, escrow: ctx.escrow.address, request }));
    const authorization = await authorize(ctx, request);
    await expect(ctx.escrow.write.lockWithSignature([request, otherChain, NO_PERMIT, authorization], { account: ctx.relayer.account }))
      .to.be.rejectedWith("InvalidBorrowerSignature");
  });
});
