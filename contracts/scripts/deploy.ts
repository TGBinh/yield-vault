import { ethers, network } from "hardhat";

/// Deploy mặc định dùng MockStrategy (local/hardhat). Trên testnet thật, nếu env
/// AAVE_POOL_ADDRESS + AAVE_ATOKEN_ADDRESS được set thì deploy AaveStrategy thay thế.
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Network:", network.name);

  const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDCFactory.deploy();
  await usdc.waitForDeployment();
  console.log("MockUSDC:", await usdc.getAddress());

  const VaultFactory = await ethers.getContractFactory("Vault");
  const vault = await VaultFactory.deploy(await usdc.getAddress(), deployer.address);
  await vault.waitForDeployment();
  console.log("Vault:", await vault.getAddress());

  const StrategyManagerFactory = await ethers.getContractFactory("StrategyManager");
  const strategyManager = await StrategyManagerFactory.deploy(
    await usdc.getAddress(),
    await vault.getAddress(),
    deployer.address
  );
  await strategyManager.waitForDeployment();
  console.log("StrategyManager:", await strategyManager.getAddress());

  const setManagerTx = await vault.setStrategyManager(await strategyManager.getAddress());
  await setManagerTx.wait();
  console.log("Vault.strategyManager set.");

  const aavePool = process.env.AAVE_POOL_ADDRESS;
  const aaveAToken = process.env.AAVE_ATOKEN_ADDRESS;

  let strategyAddress: string;
  let strategyType: string;

  if (aavePool && aaveAToken) {
    const AaveStrategyFactory = await ethers.getContractFactory("AaveStrategy");
    const strategy = await AaveStrategyFactory.deploy(
      await usdc.getAddress(),
      aaveAToken,
      aavePool,
      await strategyManager.getAddress()
    );
    await strategy.waitForDeployment();
    strategyAddress = await strategy.getAddress();
    strategyType = "AaveStrategy";
    console.log("AaveStrategy:", strategyAddress);
  } else {
    const MockStrategyFactory = await ethers.getContractFactory("MockStrategy");
    const strategy = await MockStrategyFactory.deploy(
      await usdc.getAddress(),
      await strategyManager.getAddress()
    );
    await strategy.waitForDeployment();
    strategyAddress = await strategy.getAddress();
    strategyType = "MockStrategy";
    console.log("MockStrategy:", strategyAddress);
  }

  const registerTx = await strategyManager.registerStrategy(strategyAddress);
  await registerTx.wait();
  // Phân bổ 100% đầu tiên gọi trực tiếp bằng deployer (bootstrap, chưa có Timelock) -
  // đúng trình tự thật: cấu hình ban đầu trước, chuyển giao quyền rebalance sau.
  const allocateTx = await strategyManager.setAllocations([strategyAddress], [10_000]);
  await allocateTx.wait();
  console.log(`${strategyType} registered and allocated 100% on StrategyManager.`);

  // Vault Readiness Report - Phase 0: deploy RebalanceTimelock rồi chuyển giao
  // EXECUTOR_ROLE cho nó, thu hồi khỏi deployer - từ đây, mọi lần rebalance thật đều
  // phải qua queueRebalance() -> chờ MIN_DELAY -> executeRebalance() (permissionless).
  // Trên production, GOVERNANCE_MULTISIG_ADDRESS phải là địa chỉ Safe thật, không phải
  // 1 EOA - nếu không set, mặc định dùng chính deployer (CHỈ chấp nhận được cho local/dev).
  const proposerAddress = process.env.GOVERNANCE_MULTISIG_ADDRESS ?? deployer.address;
  const RebalanceTimelockFactory = await ethers.getContractFactory("RebalanceTimelock");
  const timelock = await RebalanceTimelockFactory.deploy(
    deployer.address,
    proposerAddress,
    await strategyManager.getAddress()
  );
  await timelock.waitForDeployment();
  console.log("RebalanceTimelock:", await timelock.getAddress(), "proposer:", proposerAddress);

  const executorRole = await strategyManager.EXECUTOR_ROLE();
  await (await strategyManager.grantRole(executorRole, await timelock.getAddress())).wait();
  await (await strategyManager.revokeRole(executorRole, deployer.address)).wait();
  console.log("EXECUTOR_ROLE transferred to RebalanceTimelock and revoked from deployer.");

  console.log("\n--- Deploy done ---");
  console.log(JSON.stringify({
    usdc: await usdc.getAddress(),
    vault: await vault.getAddress(),
    strategyManager: await strategyManager.getAddress(),
    strategy: strategyAddress,
    strategyType,
    rebalanceTimelock: await timelock.getAddress(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
