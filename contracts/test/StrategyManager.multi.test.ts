import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { MockUSDC, MockStrategy, RevertingStrategy, StrategyManager, Vault } from "../typechain-types";

const ONE_USDC = 10n ** 6n;

async function deployMultiStrategyFixture() {
  const [admin, alice] = await ethers.getSigners();

  const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
  const usdc = (await MockUSDCFactory.deploy()) as unknown as MockUSDC;

  const VaultFactory = await ethers.getContractFactory("Vault");
  const vault = (await VaultFactory.deploy(
    await usdc.getAddress(),
    admin.address
  )) as unknown as Vault;

  const StrategyManagerFactory = await ethers.getContractFactory("StrategyManager");
  const strategyManager = (await StrategyManagerFactory.deploy(
    await usdc.getAddress(),
    await vault.getAddress(),
    admin.address
  )) as unknown as StrategyManager;

  await vault.connect(admin).setStrategyManager(await strategyManager.getAddress());

  const MockStrategyFactory = await ethers.getContractFactory("MockStrategy");
  const strategyA = (await MockStrategyFactory.deploy(
    await usdc.getAddress(),
    await strategyManager.getAddress()
  )) as unknown as MockStrategy;
  const strategyB = (await MockStrategyFactory.deploy(
    await usdc.getAddress(),
    await strategyManager.getAddress()
  )) as unknown as MockStrategy;

  await strategyManager.connect(admin).registerStrategy(await strategyA.getAddress());
  await strategyManager.connect(admin).registerStrategy(await strategyB.getAddress());
  await strategyManager
    .connect(admin)
    .setAllocations([await strategyA.getAddress(), await strategyB.getAddress()], [6_000, 4_000]);

  await usdc.mint(alice.address, 1_000_000n * ONE_USDC);
  await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);

  return { admin, alice, usdc, vault, strategyManager, strategyA, strategyB };
}

describe("StrategyManager (Phase 3 - multi-strategy)", () => {
  it("splits a deposit across active strategies by weight (60/40)", async () => {
    const { alice, vault, strategyA, strategyB } = await loadFixture(deployMultiStrategyFixture);
    const amount = 10_000n * ONE_USDC;

    await vault.connect(alice).deposit(amount, alice.address);

    expect(await strategyA.totalAssets()).to.equal((amount * 6_000n) / 10_000n);
    expect(await strategyB.totalAssets()).to.equal((amount * 4_000n) / 10_000n);
  });

  it("withdraw skips a broken strategy and pulls the rest from healthy ones (strategy isolation)", async () => {
    const { admin, alice, usdc, vault, strategyManager } = await loadFixture(deployMultiStrategyFixture);

    const RevertingStrategyFactory = await ethers.getContractFactory("RevertingStrategy");
    const brokenStrategy = (await RevertingStrategyFactory.deploy(
      await usdc.getAddress()
    )) as unknown as RevertingStrategy;

    const MockStrategyFactory = await ethers.getContractFactory("MockStrategy");
    const healthyStrategy = (await MockStrategyFactory.deploy(
      await usdc.getAddress(),
      await strategyManager.getAddress()
    )) as unknown as MockStrategy;

    await strategyManager.connect(admin).registerStrategy(await brokenStrategy.getAddress());
    await strategyManager.connect(admin).registerStrategy(await healthyStrategy.getAddress());
    // 50/50 while both are still healthy, so deposit (no try/catch by design) succeeds.
    await strategyManager
      .connect(admin)
      .setAllocations(
        [await brokenStrategy.getAddress(), await healthyStrategy.getAddress()],
        [5_000, 5_000]
      );

    const amount = 10_000n * ONE_USDC;
    await vault.connect(alice).deposit(amount, alice.address);
    expect(await brokenStrategy.totalAssets()).to.equal(amount / 2n);
    expect(await healthyStrategy.totalAssets()).to.equal(amount / 2n);

    // Now the protocol behind brokenStrategy "goes down" - deposit already happened,
    // this simulates a strategy failing AFTER it holds funds, which is the realistic
    // failure mode isolation must protect against.
    await brokenStrategy.setBroken(true);

    // totalAssets() try/catches each strategy - a broken one contributes 0 rather than
    // reverting the whole view. This is a deliberate conservative choice: the vault
    // never OVERSTATES what it can actually deliver right now, even though it means the
    // broken strategy's (possibly-recoverable) balance is temporarily invisible to
    // share-price accounting until it's healthy again or gets rebalanced away.
    // closeTo: healthyStrategy is a MockStrategy, which accrues a few wei of simulated
    // yield in the seconds between deposit and this assertion.
    const withdrawable = await vault.totalAssets();
    expect(withdrawable).to.be.closeTo(amount / 2n, 1_000n);

    const balanceBefore = await usdc.balanceOf(alice.address);
    const shares = await vault.balanceOf(alice.address);

    // Redeeming ALL shares must still succeed (and pulls only from the healthy
    // strategy) even though a strategy sitting right next to it in the active list is
    // completely broken - this is the actual isolation guarantee: 1 dead strategy
    // never blocks access to the rest of the vault's funds.
    await expect(vault.connect(alice).redeem(shares, alice.address, alice.address)).to.not.be.reverted;

    // closeTo again: another block/second passes between the totalAssets() snapshot
    // above and the redeem tx actually executing, accruing a few more wei of yield.
    const balanceAfter = await usdc.balanceOf(alice.address);
    expect(balanceAfter - balanceBefore).to.be.closeTo(withdrawable, 1_000n);
    expect(await healthyStrategy.totalAssets()).to.equal(0);
  });

  it("rebalancing via setAllocations moves capital to the new target weights", async () => {
    const { admin, alice, vault, strategyManager, strategyA, strategyB } =
      await loadFixture(deployMultiStrategyFixture);
    const amount = 10_000n * ONE_USDC;
    await vault.connect(alice).deposit(amount, alice.address);

    await strategyManager
      .connect(admin)
      .setAllocations([await strategyA.getAddress(), await strategyB.getAddress()], [2_000, 8_000]);

    // closeTo, not equal: a few seconds elapse between deposit and rebalance, and
    // MockStrategy accrues its simulated APR continuously, so a few wei of yield land
    // in strategyA before the rebalance withdraws its (now slightly-grown) balance.
    expect(await strategyA.totalAssets()).to.be.closeTo((amount * 2_000n) / 10_000n, 1_000n);
    expect(await strategyB.totalAssets()).to.be.closeTo((amount * 8_000n) / 10_000n, 1_000n);
  });

  it("rejects allocations that don't sum to 10000 bps", async () => {
    const { admin, strategyManager, strategyA, strategyB } = await loadFixture(deployMultiStrategyFixture);
    await expect(
      strategyManager
        .connect(admin)
        .setAllocations([await strategyA.getAddress(), await strategyB.getAddress()], [5_000, 4_000])
    ).to.be.revertedWithCustomError(strategyManager, "WeightSumMismatch");
  });

  it("totalAssets sums idle balance plus every active strategy", async () => {
    const { alice, vault, strategyManager } = await loadFixture(deployMultiStrategyFixture);
    const amount = 10_000n * ONE_USDC;
    await vault.connect(alice).deposit(amount, alice.address);

    expect(await strategyManager.totalAssets()).to.equal(amount);
    expect(await vault.totalAssets()).to.equal(amount);
  });
});
