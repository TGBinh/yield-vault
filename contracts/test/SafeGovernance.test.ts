import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { MockUSDC, MockStrategy, RebalanceTimelock, StrategyManager, Vault } from "../typechain-types";
import { createSafe, deploySafeInfra, execSafeTransaction } from "../scripts/lib/safe";

const ONE_USDC = 10n ** 6n;

/// Phase 3 - xác thực việc chuyển quyền quản trị Vault/StrategyManager sang 1 Safe{Wallet}
/// đa chữ ký THẬT (dùng nguyên bytecode Safe chính thức, không phải mock), theo đúng yêu
/// cầu GĐ3: "Chuyển quyền Owner của contract sang Safe multisig". Test cả 2 chiều:
/// - EOA deployer đơn lẻ KHÔNG còn gọi được hàm admin sau khi transfer.
/// - Giao dịch có đủ chữ ký (đạt threshold) qua Safe THẬT thực thi được.
describe("Safe multisig governance (Phase 3)", () => {
  async function deployWithSafeFixture() {
    const [deployer, ownerB, ownerC, alice] = await ethers.getSigners();

    const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
    const usdc = (await MockUSDCFactory.deploy()) as unknown as MockUSDC;

    const VaultFactory = await ethers.getContractFactory("Vault");
    const vault = (await VaultFactory.deploy(
      await usdc.getAddress(),
      deployer.address
    )) as unknown as Vault;

    const StrategyManagerFactory = await ethers.getContractFactory("StrategyManager");
    const strategyManager = (await StrategyManagerFactory.deploy(
      await usdc.getAddress(),
      await vault.getAddress(),
      deployer.address
    )) as unknown as StrategyManager;

    await vault.setStrategyManager(await strategyManager.getAddress());

    const MockStrategyFactory = await ethers.getContractFactory("MockStrategy");
    const strategyA = (await MockStrategyFactory.deploy(
      await usdc.getAddress(),
      await strategyManager.getAddress()
    )) as unknown as MockStrategy;
    const strategyB = (await MockStrategyFactory.deploy(
      await usdc.getAddress(),
      await strategyManager.getAddress()
    )) as unknown as MockStrategy;
    await strategyManager.registerStrategy(await strategyA.getAddress());
    await strategyManager.registerStrategy(await strategyB.getAddress());
    // Kích hoạt strategy TRƯỚC khi chuyển quyền quản trị sang Safe - đúng trình tự
    // deploy thật (cấu hình ban đầu bằng EOA deployer, sau đó mới trao quyền cho multisig).
    await strategyManager.setAllocations([await strategyA.getAddress()], [10_000]);

    // Deploy 1 Safe THẬT (2-of-3) làm ví quản trị mới.
    const { safeSingleton, proxyFactory } = await deploySafeInfra();
    const safe = await createSafe(
      safeSingleton,
      proxyFactory,
      [deployer.address, ownerB.address, ownerC.address],
      2
    );
    const safeAddress = await safe.getAddress();

    // Vault Readiness Report - Phase 0: rebalance thật (`setAllocations`) không còn được
    // gọi trực tiếp bởi Safe nữa - phải đi qua RebalanceTimelock (Safe chỉ queue, ai cũng
    // execute được sau MIN_DELAY). Deploy Timelock với Safe làm PROPOSER_ROLE duy nhất.
    const RebalanceTimelockFactory = await ethers.getContractFactory("RebalanceTimelock");
    const timelock = (await RebalanceTimelockFactory.deploy(
      deployer.address,
      safeAddress,
      await strategyManager.getAddress()
    )) as unknown as RebalanceTimelock;

    // Chuyển quyền: grant DEFAULT_ADMIN_ROLE/STRATEGIST_ROLE cho Safe, rồi revoke khỏi
    // deployer EOA - đây chính là "Owner transfer" theo yêu cầu PLAN.md GĐ3.
    const defaultAdminRole = await vault.DEFAULT_ADMIN_ROLE();
    const guardianRole = await vault.GUARDIAN_ROLE();
    const strategistRole = await strategyManager.STRATEGIST_ROLE();
    const executorRole = await strategyManager.EXECUTOR_ROLE();

    await vault.grantRole(defaultAdminRole, safeAddress);
    await vault.grantRole(guardianRole, safeAddress);
    await strategyManager.grantRole(defaultAdminRole, safeAddress);
    await strategyManager.grantRole(strategistRole, safeAddress);

    // EXECUTOR_ROLE chỉ thuộc về Timelock - KHÔNG được cấp cho Safe, vì Safe có quyền
    // execute trực tiếp thì Timelock vô nghĩa (đây chính là bug đã tìm thấy khi viết lại
    // test này: EXECUTOR_ROLE quên revoke khỏi deployer sẽ để lộ y hệt lỗ hổng ban đầu).
    await strategyManager.grantRole(executorRole, await timelock.getAddress());

    await vault.revokeRole(guardianRole, deployer.address);
    await vault.revokeRole(defaultAdminRole, deployer.address);
    await strategyManager.revokeRole(strategistRole, deployer.address);
    await strategyManager.revokeRole(executorRole, deployer.address);
    await strategyManager.revokeRole(defaultAdminRole, deployer.address);

    await usdc.mint(alice.address, 1_000_000n * ONE_USDC);
    await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);

    return { deployer, ownerB, ownerC, alice, usdc, vault, strategyManager, strategyA, strategyB, safe, timelock };
  }

  it("deployer EOA alone can no longer call admin functions after transfer", async () => {
    const { deployer, vault, strategyManager, strategyA } = await loadFixture(deployWithSafeFixture);

    await expect(vault.connect(deployer).pause()).to.be.reverted;
    await expect(
      strategyManager.connect(deployer).setAllocations([await strategyA.getAddress()], [10_000])
    ).to.be.reverted;
  });

  it("a real 2-of-3 Safe transaction can queue a rebalance, executed only after the timelock delay", async () => {
    const { deployer, ownerB, strategyManager, strategyA, strategyB, safe, timelock } =
      await loadFixture(deployWithSafeFixture);

    const strategies = [await strategyA.getAddress(), await strategyB.getAddress()];
    const weights = [7_000, 3_000];
    const queueData = timelock.interface.encodeFunctionData("queueRebalance", [strategies, weights]);

    // 2 trong 3 owner (deployer + ownerB) approve - đủ threshold=2, nhưng chỉ QUEUE.
    await expect(
      execSafeTransaction(safe, await timelock.getAddress(), queueData, [deployer.address, ownerB.address])
    ).to.not.be.reverted;

    // Chưa hết MIN_DELAY -> execute (permissionless) phải revert.
    await expect(timelock.executeRebalance(strategies, weights)).to.be.reverted;

    await network.provider.send("evm_increaseTime", [Number(await timelock.MIN_DELAY())]);
    await network.provider.send("evm_mine");

    // Sau khi hết delay, BẤT KỲ AI cũng execute được - không cần chữ ký Safe lần 2.
    await timelock.executeRebalance(strategies, weights);

    expect(await strategyManager.weightBps(await strategyA.getAddress())).to.equal(7_000);
    expect(await strategyManager.weightBps(await strategyB.getAddress())).to.equal(3_000);
  });

  it("a Safe transaction with only 1 of 3 approvals (below threshold) fails to even queue", async () => {
    const { deployer, strategyManager, strategyA, safe, timelock } = await loadFixture(deployWithSafeFixture);

    const data = timelock.interface.encodeFunctionData("queueRebalance", [
      [await strategyA.getAddress()],
      [10_000],
    ]);

    await expect(
      execSafeTransaction(safe, await timelock.getAddress(), data, [deployer.address])
    ).to.be.reverted;
  });

  it("Safe alone cannot skip the timelock and rebalance StrategyManager directly", async () => {
    const { deployer, ownerB, strategyManager, strategyA, safe } = await loadFixture(deployWithSafeFixture);

    const data = strategyManager.interface.encodeFunctionData("setAllocations", [
      [await strategyA.getAddress()],
      [10_000],
    ]);

    // Ngay cả với đủ 2/3 chữ ký, Safe không còn giữ EXECUTOR_ROLE - đây chính là điểm
    // mấu chốt của Timelock: không có đường tắt nào bỏ qua khoảng trễ công khai.
    await expect(
      execSafeTransaction(safe, await strategyManager.getAddress(), data, [deployer.address, ownerB.address])
    ).to.be.reverted;
  });

  it("the Safe (via GUARDIAN_ROLE) can pause the vault, and pause never blocks withdraw", async () => {
    const { deployer, ownerB, alice, vault, safe } = await loadFixture(deployWithSafeFixture);

    const amount = 1_000n * ONE_USDC;
    await vault.connect(alice).deposit(amount, alice.address);

    const data = vault.interface.encodeFunctionData("pause", []);
    await execSafeTransaction(safe, await vault.getAddress(), data, [deployer.address, ownerB.address]);

    expect(await vault.paused()).to.equal(true);
    await expect(vault.connect(alice).deposit(amount, alice.address)).to.be.reverted;
    await expect(
      vault.connect(alice).redeem(await vault.balanceOf(alice.address), alice.address, alice.address)
    ).to.not.be.reverted;
  });
});
