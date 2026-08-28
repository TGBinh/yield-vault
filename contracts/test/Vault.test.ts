import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { MockUSDC, MockStrategy, StrategyManager, Vault } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const ONE_USDC = 10n ** 6n;

async function deployFixture() {
  const [admin, guardianButNotAdmin, alice, bob] = await ethers.getSigners();

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
  const strategy = (await MockStrategyFactory.deploy(
    await usdc.getAddress(),
    await strategyManager.getAddress()
  )) as unknown as MockStrategy;

  await strategyManager.connect(admin).registerStrategy(await strategy.getAddress());
  await strategyManager.connect(admin).setAllocations([await strategy.getAddress()], [10_000]);

  for (const user of [alice, bob]) {
    await usdc.mint(user.address, 1_000_000n * ONE_USDC);
    await usdc.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
  }

  return { admin, guardianButNotAdmin, alice, bob, usdc, vault, strategyManager, strategy };
}

describe("Vault (Phase 2)", () => {
  describe("deposit/withdraw", () => {
    it("mints shares 1:1 with assets on the first deposit", async () => {
      const { alice, vault } = await loadFixture(deployFixture);
      const amount = 1_000n * ONE_USDC;

      await expect(vault.connect(alice).deposit(amount, alice.address)).to.not.be.reverted;

      expect(await vault.balanceOf(alice.address)).to.equal(amount);
      expect(await vault.totalAssets()).to.equal(amount);
    });

    it("returns exactly the deposited amount when withdrawing immediately", async () => {
      const { alice, vault, usdc } = await loadFixture(deployFixture);
      const amount = 1_000n * ONE_USDC;
      await vault.connect(alice).deposit(amount, alice.address);

      const balanceBefore = await usdc.balanceOf(alice.address);
      await vault.connect(alice).redeem(await vault.balanceOf(alice.address), alice.address, alice.address);
      const balanceAfter = await usdc.balanceOf(alice.address);

      expect(balanceAfter - balanceBefore).to.equal(amount);
      expect(await vault.totalSupply()).to.equal(0);
    });

    it("increases share value over time due to MockStrategy's simulated yield", async () => {
      const { alice, vault } = await loadFixture(deployFixture);
      const amount = 10_000n * ONE_USDC;
      await vault.connect(alice).deposit(amount, alice.address);

      await time.increase(365 * 24 * 60 * 60); // +1 year

      const shares = await vault.balanceOf(alice.address);
      const assetsForShares = await vault.convertToAssets(shares);
      expect(assetsForShares).to.be.gt(amount);
    });
  });

  describe("access control & pause", () => {
    it("only GUARDIAN_ROLE can pause", async () => {
      const { alice, vault } = await loadFixture(deployFixture);
      await expect(vault.connect(alice).pause()).to.be.reverted;
    });

    it("pause blocks deposit but NEVER blocks withdraw/redeem", async () => {
      const { admin, alice, vault } = await loadFixture(deployFixture);
      const amount = 1_000n * ONE_USDC;
      await vault.connect(alice).deposit(amount, alice.address);

      await vault.connect(admin).pause();

      await expect(vault.connect(alice).deposit(amount, alice.address)).to.be.reverted;
      await expect(
        vault.connect(alice).redeem(await vault.balanceOf(alice.address), alice.address, alice.address)
      ).to.not.be.reverted;
    });

    it("only DEFAULT_ADMIN_ROLE can set the strategy manager, and only once", async () => {
      const { alice, vault, strategyManager } = await loadFixture(deployFixture);
      await expect(
        vault.connect(alice).setStrategyManager(await strategyManager.getAddress())
      ).to.be.reverted;
    });
  });

  describe("StrategyManager", () => {
    it("only the vault can call deposit/withdraw on the strategy manager", async () => {
      const { alice, strategyManager } = await loadFixture(deployFixture);
      await expect(strategyManager.connect(alice).deposit(1n)).to.be.reverted;
      await expect(strategyManager.connect(alice).withdraw(1n, alice.address)).to.be.reverted;
    });

    it("only STRATEGIST_ROLE can change the active allocations", async () => {
      const { alice, strategyManager, strategy } = await loadFixture(deployFixture);
      await expect(
        strategyManager.connect(alice).setAllocations([await strategy.getAddress()], [10_000])
      ).to.be.reverted;
    });
  });

  describe("accounting invariant", () => {
    it("totalAssets stays >= the converted value of totalSupply across multiple deposits/redeems", async () => {
      const { alice, bob, vault } = await loadFixture(deployFixture);

      await vault.connect(alice).deposit(5_000n * ONE_USDC, alice.address);
      await vault.connect(bob).deposit(3_000n * ONE_USDC, bob.address);
      await time.increase(30 * 24 * 60 * 60);
      await vault.connect(alice).redeem(await vault.balanceOf(alice.address), alice.address, alice.address);

      const totalSupply = await vault.totalSupply();
      const impliedAssets = await vault.convertToAssets(totalSupply);
      expect(await vault.totalAssets()).to.be.gte(impliedAssets);
    });
  });
});
