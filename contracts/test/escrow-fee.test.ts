import { authorizedLockArgs, type LockArgs } from "./helpers/lock";
import { expect } from "chai";
import { createHash, randomBytes } from "node:crypto";
import hre from "hardhat";
import { getAddress, getContractAddress, keccak256, parseEther, toHex, zeroAddress, type Address, type Hex } from "viem";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { datasetIdHash } from "../../src/lib/evm/dataset-key";
import { loanIdHash } from "../../src/lib/evm/loan-key";

/**
 * Frais de plateforme et routage vers Mezo.
 *
 * L'escrow prélève un pourcentage figé au déploiement sur chaque libération, jamais sur un
 * remboursement, et le crédite au routeur. Une politique externe (veMEZO) peut seulement le
 * baisser ; si elle échoue, consomme tout son gas ou répond n'importe quoi, la libération
 * passe quand même au taux de base. Le routeur envoie la part trésorerie et verse la part
 * incitations en bribe MUSD sur le gauge BTC/MUSD, ou la garde quand le versement serait
 * perdu (gauge mort, aucun vote, bords d'époque).
 */

const DAY = 24 * 60 * 60;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;
const TRAINING_PROFILE = keccak256(toHex("sirius.training-profile.v1:linear_regression:1.0.0"));
const AMOUNT = parseEther("100");
const BASE_FEE_BPS = 200n;
const DISCOUNT_BPS = 100n;
const MIN_POWER = parseEther("10");

type Wallet = Awaited<ReturnType<typeof hre.viem.getWalletClients>>[number];

function teePreimage(): { preimage: Hex; hashlock: Hex } {
  const preimage = toHex(randomBytes(32));
  const hashlock = `0x${createHash("sha256").update(Buffer.from(preimage.slice(2), "hex")).digest("hex")}` as Hex;
  return { preimage, hashlock };
}

async function fixture() {
  const [admin, verifier, borrower, provider, treasury, stranger] = await hre.viem.getWalletClients();
  const musd = await hre.viem.deployContract("SiriusTestUsdc");
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
  await Promise.all([grantKyb(borrower), grantKyb(provider)]);

  const veMezo = await hre.viem.deployContract("MockVeMezo");
  const voter = await hre.viem.deployContract("MockMezoVoter");
  const bribe = await hre.viem.deployContract("MockMezoBribe");
  const gauge = getAddress("0x00000000000000000000000000000000000a0be1");
  await voter.write.setGauge([gauge, bribe.address, true]);
  await bribe.write.setTotalSupply([parseEther("1")]);
  const router = await hre.viem.deployContract("SiriusFeeRouter", [musd.address, voter.address, gauge, treasury.account.address, 5_000n]);
  const policy = await hre.viem.deployContract("SiriusMezoFeePolicy", [veMezo.address, MIN_POWER, DISCOUNT_BPS]);
  await musd.write.mint([borrower.account.address, parseEther("10000")]);
  const publicClient = await hre.viem.getPublicClient();
  return { admin, verifier, borrower, provider, treasury, stranger, musd, kyb, veMezo, voter, bribe, gauge, router, policy, publicClient };
}

type Ctx = Awaited<ReturnType<typeof fixture>>;

/** Escrow neuf (et son registre, lié une seule fois) avec les paramètres de frais donnés. */
async function deployEscrow(ctx: Ctx, feeRecipient: Address, feeBps: bigint, policy: Address = zeroAddress) {
  const registry = await hre.viem.deployContract("SiriusDatasetRegistry", [ctx.kyb.address, ctx.admin.account.address]);
  const escrow = await hre.viem.deployContract("SiriusEscrow", [
    ctx.musd.address, ctx.kyb.address, registry.address, ctx.admin.account.address, feeRecipient, feeBps, policy,
  ]);
  await registry.write.bindEscrow([escrow.address], { account: ctx.admin.account });
  const name = `fee-dataset-${randomBytes(4).toString("hex")}`;
  await registry.write.mint([datasetIdHash(name), keccak256(toHex(`${name}-cid`)), keccak256(toHex(`${name}-root`)), 1n, TRAINING_PROFILE], {
    account: ctx.provider.account,
  });
  const datasetId = await registry.read.datasetIdOf([ctx.provider.account.address, datasetIdHash(name)]);
  return { escrow, datasetId };
}

type Escrow = Awaited<ReturnType<typeof deployEscrow>>["escrow"];

async function lockLoan(ctx: Ctx, escrow: Escrow, datasetId: Hex, amount = AMOUNT) {
  const { preimage, hashlock } = teePreimage();
  const loanHash = loanIdHash(`loan_${randomBytes(8).toString("hex")}`);
  const args: LockArgs = [ctx.provider.account.address, amount, hashlock, 7, loanHash, datasetId, TRAINING_PROFILE];
  await ctx.musd.write.approve([escrow.address, amount], { account: ctx.borrower.account });
  await escrow.write.lock(await authorizedLockArgs(ctx.admin, escrow.address, ctx.borrower.account.address, args), {
    account: ctx.borrower.account,
  });
  const loanKey = await escrow.read.loanKeyOf([ctx.borrower.account.address, loanHash]);
  return { loanKey, preimage };
}

/** Place la chaîne au milieu d'une époque Mezo (jeudi 00:00 UTC + 3 jours). */
async function midEpoch() {
  const now = await time.latest();
  const start = now - (now % WEEK);
  await time.increaseTo(start + WEEK + 3 * DAY);
}

describe("SiriusEscrow platform fee", () => {
  it("prélève le taux de base à la libération et le crédite au destinataire", async () => {
    const ctx = await loadFixture(fixture);
    const { escrow, datasetId } = await deployEscrow(ctx, ctx.router.address, BASE_FEE_BPS);
    const { loanKey, preimage } = await lockLoan(ctx, escrow, datasetId);
    const hash = await escrow.write.release([loanKey, preimage], { account: ctx.stranger.account });

    const fee = AMOUNT * BASE_FEE_BPS / 10_000n;
    expect(await escrow.read.creditOf([ctx.provider.account.address])).to.equal(AMOUNT - fee);
    expect(await escrow.read.creditOf([ctx.router.address])).to.equal(fee);
    const [locked, owed, balance] = await escrow.read.accounting();
    expect(locked).to.equal(0n);
    expect(owed).to.equal(AMOUNT);
    expect(balance >= locked + owed).to.equal(true);

    const events = await escrow.getEvents.FeeCharged({}, { blockHash: (await ctx.publicClient.getTransactionReceipt({ hash })).blockHash });
    expect(events).to.have.length(1);
    expect(events[0].args.fee).to.equal(fee);
    expect(events[0].args.feeBps).to.equal(BASE_FEE_BPS);
    expect(getAddress(events[0].args.recipient!)).to.equal(getAddress(ctx.router.address));
  });

  it("ne prélève rien sur un remboursement", async () => {
    const ctx = await loadFixture(fixture);
    const { escrow, datasetId } = await deployEscrow(ctx, ctx.router.address, BASE_FEE_BPS);
    const { loanKey } = await lockLoan(ctx, escrow, datasetId);
    await time.increase(8 * DAY);
    await escrow.write.refund([loanKey], { account: ctx.stranger.account });
    expect(await escrow.read.creditOf([ctx.borrower.account.address])).to.equal(AMOUNT);
    expect(await escrow.read.creditOf([ctx.router.address])).to.equal(0n);
  });

  it("refuse une configuration de frais incohérente", async () => {
    const ctx = await loadFixture(fixture);
    const cases: Array<[Address, bigint, Address]> = [
      [ctx.router.address, 1_001n, zeroAddress],
      [zeroAddress, BASE_FEE_BPS, zeroAddress],
      [ctx.router.address, 0n, zeroAddress],
      [zeroAddress, 0n, ctx.policy.address],
      [ctx.router.address, BASE_FEE_BPS, ctx.stranger.account.address],
    ];
    for (const [recipient, bps, policy] of cases) {
      await expect(deployEscrow(ctx, recipient, bps, policy)).to.be.rejectedWith("InvalidFee");
    }
  });

  it("applique la remise veMEZO au fournisseur qui a assez de pouvoir de vote", async () => {
    const ctx = await loadFixture(fixture);
    const { escrow, datasetId } = await deployEscrow(ctx, ctx.router.address, BASE_FEE_BPS, ctx.policy.address);
    expect(await escrow.read.feeBpsFor([ctx.provider.account.address])).to.equal(BASE_FEE_BPS);

    // Pouvoir réparti sur deux positions : la somme compte.
    await ctx.veMezo.write.give([ctx.provider.account.address, parseEther("6")]);
    await ctx.veMezo.write.give([ctx.provider.account.address, parseEther("4")]);
    expect(await escrow.read.feeBpsFor([ctx.provider.account.address])).to.equal(DISCOUNT_BPS);

    const { loanKey, preimage } = await lockLoan(ctx, escrow, datasetId);
    await escrow.write.release([loanKey, preimage]);
    expect(await escrow.read.creditOf([ctx.router.address])).to.equal(AMOUNT * DISCOUNT_BPS / 10_000n);
  });

  it("ne compte que les cinq premières positions veMEZO", async () => {
    const ctx = await loadFixture(fixture);
    for (let i = 0; i < 5; i++) await ctx.veMezo.write.give([ctx.provider.account.address, parseEther("1")]);
    await ctx.veMezo.write.give([ctx.provider.account.address, parseEther("100")]);
    expect(await ctx.policy.read.countedPower([ctx.provider.account.address])).to.equal(parseEther("5"));
    expect(await ctx.policy.read.feeBpsFor([ctx.provider.account.address, BASE_FEE_BPS])).to.equal(BASE_FEE_BPS);
  });

  for (const name of ["MockRevertingFeePolicy", "MockGreedyFeePolicy", "MockGasBurnerFeePolicy"] as const) {
    it(`retombe sur le taux de base si la politique déraille (${name})`, async () => {
      const ctx = await loadFixture(fixture);
      const bad = await hre.viem.deployContract(name);
      const { escrow, datasetId } = await deployEscrow(ctx, ctx.router.address, BASE_FEE_BPS, bad.address);
      const { loanKey, preimage } = await lockLoan(ctx, escrow, datasetId);
      await escrow.write.release([loanKey, preimage]);
      expect(await escrow.read.creditOf([ctx.router.address])).to.equal(AMOUNT * BASE_FEE_BPS / 10_000n);
      expect(await escrow.read.creditOf([ctx.provider.account.address])).to.equal(AMOUNT - AMOUNT * BASE_FEE_BPS / 10_000n);
    });
  }
});

describe("SiriusFeeRouter", () => {
  async function feesInRouter(ctx: Ctx) {
    const { escrow, datasetId } = await deployEscrow(ctx, ctx.router.address, BASE_FEE_BPS);
    const { loanKey, preimage } = await lockLoan(ctx, escrow, datasetId);
    await escrow.write.release([loanKey, preimage]);
    return { escrow, fee: AMOUNT * BASE_FEE_BPS / 10_000n };
  }

  it("tire les frais de l'escrow, paie la trésorerie et verse la bribe MUSD", async () => {
    const ctx = await loadFixture(fixture);
    const { escrow, fee } = await feesInRouter(ctx);
    await midEpoch();
    const treasuryBefore = await ctx.musd.read.balanceOf([ctx.treasury.account.address]);
    await ctx.router.write.distribute([escrow.address], { account: ctx.stranger.account });

    expect(await escrow.read.creditOf([ctx.router.address])).to.equal(0n);
    expect(await ctx.musd.read.balanceOf([ctx.treasury.account.address]) - treasuryBefore).to.equal(fee / 2n);
    expect(await ctx.bribe.read.received([ctx.musd.address])).to.equal(fee / 2n);
    expect(await ctx.router.read.pendingIncentive()).to.equal(0n);
    expect(await ctx.musd.read.allowance([ctx.router.address, ctx.bribe.address])).to.equal(0n);
    expect(await ctx.router.read.totalIncentivized()).to.equal(fee / 2n);
  });

  it("garde la part incitations quand personne ne vote, puis la verse", async () => {
    const ctx = await loadFixture(fixture);
    const { escrow, fee } = await feesInRouter(ctx);
    await midEpoch();
    await ctx.bribe.write.setTotalSupply([0n]);
    await ctx.router.write.distribute([escrow.address]);
    expect(await ctx.router.read.pendingIncentive()).to.equal(fee / 2n);
    expect(await ctx.bribe.read.notifications()).to.equal(0n);

    await ctx.bribe.write.setTotalSupply([parseEther("1")]);
    await ctx.router.write.distribute([zeroAddress]);
    expect(await ctx.bribe.read.received([ctx.musd.address])).to.equal(fee / 2n);
    expect(await ctx.router.read.pendingIncentive()).to.equal(0n);
  });

  it("envoie à la trésorerie l'incitation d'un gauge mort", async () => {
    const ctx = await loadFixture(fixture);
    const { escrow, fee } = await feesInRouter(ctx);
    await ctx.voter.write.setGauge([ctx.gauge, ctx.bribe.address, false]);
    await midEpoch();
    const treasuryBefore = await ctx.musd.read.balanceOf([ctx.treasury.account.address]);
    await ctx.router.write.distribute([escrow.address]);
    expect(await ctx.musd.read.balanceOf([ctx.treasury.account.address]) - treasuryBefore).to.equal(fee);
    expect(await ctx.router.read.pendingIncentive()).to.equal(0n);
    expect(await ctx.musd.read.balanceOf([ctx.router.address])).to.equal(0n);
    const redirected = await ctx.router.getEvents.IncentiveRedirected();
    expect(redirected[0].args.reason).to.equal(2); // GaugeKilled
    expect(redirected[0].args.amount).to.equal(fee / 2n);
  });

  it("ne verse pas au bord d'une époque, dans la première comme dans la dernière heure", async () => {
    const ctx = await loadFixture(fixture);
    const { escrow, fee } = await feesInRouter(ctx);
    const now = await time.latest();
    const next = now - (now % WEEK) + WEEK;
    await time.increaseTo(next + 30 * 60);
    await ctx.router.write.distribute([escrow.address]);
    expect(await ctx.router.read.pendingIncentive()).to.equal(fee / 2n);
    expect(await ctx.router.read.incentiveDeferral()).to.equal(4); // EpochEdge
    await time.increaseTo(next + 60 * 60);
    expect(await ctx.router.read.incentiveDeferral()).to.equal(0); // None : 1 h pile
    await time.increaseTo(next + WEEK - 60 * 60);
    expect(await ctx.router.read.incentiveDeferral()).to.equal(4); // 7 j - 1 h : déjà le bord
    await ctx.router.write.distribute([zeroAddress]);
    expect(await ctx.bribe.read.notifications()).to.equal(0n);
    expect(await ctx.router.read.stuckSince()).to.equal(0n);
  });

  it("une bribe qui échoue ne bloque ni la trésorerie ni les fonds, puis part à la trésorerie", async () => {
    const ctx = await loadFixture(fixture);
    const { escrow, fee } = await feesInRouter(ctx);
    await midEpoch();
    await ctx.bribe.write.setFailing([true]);
    const treasuryBefore = await ctx.musd.read.balanceOf([ctx.treasury.account.address]);
    await ctx.router.write.distribute([escrow.address]);
    expect(await ctx.musd.read.balanceOf([ctx.treasury.account.address]) - treasuryBefore).to.equal(fee / 2n);
    expect(await ctx.router.read.pendingIncentive()).to.equal(fee / 2n);
    expect(await ctx.musd.read.allowance([ctx.router.address, ctx.bribe.address])).to.equal(0n);
    const deferred = await ctx.router.getEvents.IncentiveDeferred();
    expect(deferred[0].args.reason).to.equal(5); // PostFailed
    expect(await ctx.router.read.stuckSince() > 0n).to.equal(true);

    await time.increase(4 * WEEK);
    await midEpoch();
    await ctx.router.write.distribute([zeroAddress]);
    expect(await ctx.musd.read.balanceOf([ctx.treasury.account.address]) - treasuryBefore).to.equal(fee);
    expect(await ctx.router.read.pendingIncentive()).to.equal(0n);
    expect(await ctx.router.read.totalIncentivized()).to.equal(0n);
  });

  it("sans vote pendant quatre semaines, l'incitation part à la trésorerie", async () => {
    const ctx = await loadFixture(fixture);
    const { escrow, fee } = await feesInRouter(ctx);
    await midEpoch();
    await ctx.bribe.write.setTotalSupply([0n]);
    await ctx.router.write.distribute([escrow.address]);
    const since = await ctx.router.read.stuckSince();
    await time.increaseTo(Number(since) + 4 * WEEK - DAY);
    await ctx.router.write.distribute([zeroAddress]);
    expect(await ctx.router.read.pendingIncentive()).to.equal(fee / 2n);
    await time.increaseTo(Number(since) + 4 * WEEK);
    await ctx.router.write.distribute([zeroAddress]);
    expect(await ctx.router.read.pendingIncentive()).to.equal(0n);
    expect(await ctx.router.read.totalToTreasury()).to.equal(fee);
  });

  it("un vote revenu à temps remet le compteur à zéro", async () => {
    const ctx = await loadFixture(fixture);
    const { escrow, fee } = await feesInRouter(ctx);
    await midEpoch();
    await ctx.bribe.write.setTotalSupply([0n]);
    await ctx.router.write.distribute([escrow.address]);
    await ctx.bribe.write.setTotalSupply([parseEther("1")]);
    await ctx.router.write.distribute([zeroAddress]);
    expect(await ctx.bribe.read.received([ctx.musd.address])).to.equal(fee / 2n);
    expect(await ctx.router.read.stuckSince()).to.equal(0n);
  });

  it("partage aussi un MUSD envoyé directement au routeur", async () => {
    const ctx = await loadFixture(fixture);
    await midEpoch();
    await ctx.musd.write.transfer([ctx.router.address, parseEther("10")], { account: ctx.borrower.account });
    await ctx.router.write.distribute([zeroAddress]);
    expect(await ctx.bribe.read.received([ctx.musd.address])).to.equal(parseEther("5"));
    expect(await ctx.router.read.totalToTreasury()).to.equal(parseEther("5"));
  });

  it("refuse un gauge sans bribe et un partage au-dessus de 100 %", async () => {
    const ctx = await loadFixture(fixture);
    const orphan = getAddress("0x000000000000000000000000000000000000dead");
    await expect(hre.viem.deployContract("SiriusFeeRouter", [ctx.musd.address, ctx.voter.address, orphan, ctx.treasury.account.address, 5_000n]))
      .to.be.rejectedWith("BribeMismatch");
    await expect(hre.viem.deployContract("SiriusFeeRouter", [ctx.musd.address, ctx.voter.address, ctx.gauge, ctx.treasury.account.address, 10_001n]))
      .to.be.rejectedWith("InvalidSplit");
  });

  for (const [bps, toTreasury] of [[0n, 10n], [10_000n, 0n]] as const) {
    it(`partage ${bps} bps : la trésorerie reçoit ${toTreasury} MUSD sur 10`, async () => {
      const ctx = await loadFixture(fixture);
      const router = await hre.viem.deployContract("SiriusFeeRouter", [ctx.musd.address, ctx.voter.address, ctx.gauge, ctx.treasury.account.address, bps]);
      await midEpoch();
      await ctx.musd.write.transfer([router.address, parseEther("10")], { account: ctx.borrower.account });
      await router.write.distribute([zeroAddress]);
      expect(await router.read.totalToTreasury()).to.equal(parseEther(toTreasury.toString()));
      expect(await ctx.bribe.read.received([ctx.musd.address])).to.equal(parseEther((10n - toTreasury).toString()));
      expect(await router.read.pendingIncentive()).to.equal(0n);
      if (bps === 0n) expect(await router.getEvents.IncentiveDeferred()).to.have.length(0);
    });
  }

  it("refuse la réentrance d'une fausse source", async () => {
    const ctx = await loadFixture(fixture);
    const source = await hre.viem.deployContract("MockReentrantSource");
    await source.write.setRouter([ctx.router.address]);
    await expect(ctx.router.write.distribute([source.address])).to.be.rejectedWith("Reentrancy");
  });
});

describe("Frais : cycle complet et bornes", () => {
  it("lock, release, retraits : la comptabilité finit à zéro", async () => {
    const ctx = await loadFixture(fixture);
    const { escrow, datasetId } = await deployEscrow(ctx, ctx.router.address, BASE_FEE_BPS, ctx.policy.address);
    const { loanKey, preimage } = await lockLoan(ctx, escrow, datasetId);
    await escrow.write.release([loanKey, preimage]);
    await escrow.write.withdrawFor([ctx.provider.account.address]);
    await midEpoch();
    await ctx.router.write.distribute([escrow.address]);
    const [locked, owed, balance] = await escrow.read.accounting();
    expect(locked).to.equal(0n);
    expect(owed).to.equal(0n);
    expect(balance).to.equal(0n);
    const fee = AMOUNT * BASE_FEE_BPS / 10_000n;
    expect(await ctx.musd.read.balanceOf([ctx.provider.account.address])).to.equal(AMOUNT - fee);
    expect(await ctx.musd.read.balanceOf([ctx.bribe.address])).to.equal(fee / 2n);
  });

  it("accepte le plafond de 10 % et refuse un destinataire qui serait l'escrow ou le jeton", async () => {
    const ctx = await loadFixture(fixture);
    const { escrow } = await deployEscrow(ctx, ctx.router.address, 1_000n);
    expect(await escrow.read.feeBps()).to.equal(1_000n);
    await expect(deployEscrow(ctx, ctx.musd.address, BASE_FEE_BPS)).to.be.rejectedWith("InvalidFee");

    const registry = await hre.viem.deployContract("SiriusDatasetRegistry", [ctx.kyb.address, ctx.admin.account.address]);
    const nonce = await ctx.publicClient.getTransactionCount({ address: ctx.admin.account.address });
    const predicted = getContractAddress({ from: ctx.admin.account.address, nonce: BigInt(nonce) });
    await expect(hre.viem.deployContract("SiriusEscrow", [
      ctx.musd.address, ctx.kyb.address, registry.address, ctx.admin.account.address, predicted, BASE_FEE_BPS, zeroAddress,
    ])).to.be.rejectedWith("InvalidFee");
  });

  for (const [name, expectedBps] of [
    ["MockReturnBombFeePolicy", BASE_FEE_BPS], ["MockSilentFeePolicy", BASE_FEE_BPS], ["MockTwoWordFeePolicy", BASE_FEE_BPS], ["MockZeroFeePolicy", 0n],
  ] as const) {
    it(`politique ${name} : ${expectedBps} bps`, async () => {
      const ctx = await loadFixture(fixture);
      const policy = await hre.viem.deployContract(name);
      const { escrow, datasetId } = await deployEscrow(ctx, ctx.router.address, BASE_FEE_BPS, policy.address);
      expect(await escrow.read.feeBpsFor([ctx.provider.account.address])).to.equal(expectedBps);
      const { loanKey, preimage } = await lockLoan(ctx, escrow, datasetId);
      const hash = await escrow.write.release([loanKey, preimage]);
      const receipt = await ctx.publicClient.getTransactionReceipt({ hash });
      expect(await escrow.read.creditOf([ctx.router.address])).to.equal(AMOUNT * expectedBps / 10_000n);
      const charged = await escrow.getEvents.FeeCharged({}, { blockHash: receipt.blockHash });
      expect(charged).to.have.length(expectedBps === 0n ? 0 : 1);
      if (name === "MockReturnBombFeePolicy") expect(receipt.gasUsed < 400_000n).to.equal(true);
    });
  }

  it("une libération au gas minimal garde la remise veMEZO", async () => {
    const ctx = await loadFixture(fixture);
    for (let i = 0; i < 4; i++) await ctx.veMezo.write.give([ctx.provider.account.address, parseEther("1")]);
    await ctx.veMezo.write.give([ctx.provider.account.address, parseEther("1")]);
    // Le seuil n'est atteint qu'à la cinquième position : le chemin le plus long de la politique.
    const policy = await hre.viem.deployContract("SiriusMezoFeePolicy", [ctx.veMezo.address, parseEther("5"), DISCOUNT_BPS]);
    const { escrow, datasetId } = await deployEscrow(ctx, ctx.router.address, BASE_FEE_BPS, policy.address);
    const { loanKey, preimage } = await lockLoan(ctx, escrow, datasetId);
    const gas = await escrow.estimateGas.release([loanKey, preimage], { account: ctx.stranger.account });
    await escrow.write.release([loanKey, preimage], { account: ctx.stranger.account, gas });
    expect(await escrow.read.creditOf([ctx.router.address])).to.equal(AMOUNT * DISCOUNT_BPS / 10_000n);
  });
});

describe("SiriusMezoFeePolicy", () => {
  it("donne la remise au seuil exact, jamais au-dessus du taux de base", async () => {
    const ctx = await loadFixture(fixture);
    await ctx.veMezo.write.give([ctx.provider.account.address, MIN_POWER]);
    expect(await ctx.policy.read.feeBpsFor([ctx.provider.account.address, BASE_FEE_BPS])).to.equal(DISCOUNT_BPS);
    expect(await ctx.policy.read.feeBpsFor([ctx.provider.account.address, 50n])).to.equal(50n);
    expect(await ctx.policy.read.feeBpsFor([ctx.stranger.account.address, BASE_FEE_BPS])).to.equal(BASE_FEE_BPS);
  });

  it("refuse un seuil nul et un veMEZO sans code", async () => {
    const ctx = await loadFixture(fixture);
    await expect(hre.viem.deployContract("SiriusMezoFeePolicy", [ctx.veMezo.address, 0n, DISCOUNT_BPS])).to.be.rejectedWith("InvalidPolicy");
    await expect(hre.viem.deployContract("SiriusMezoFeePolicy", [ctx.stranger.account.address, MIN_POWER, DISCOUNT_BPS])).to.be.rejectedWith("InvalidPolicy");
    await expect(hre.viem.deployContract("SiriusMezoFeePolicy", [zeroAddress, MIN_POWER, DISCOUNT_BPS])).to.be.rejectedWith("ZeroAddress");
  });
});
