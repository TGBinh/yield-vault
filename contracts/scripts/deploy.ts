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
  //
  // Bug thật đã gặp: dùng `??` thay vì `||` khiến 1 dòng "GOVERNANCE_MULTISIG_ADDRESS="
  // (khai báo nhưng để trống, đúng như .env.example) không rơi về mặc định như mong đợi -
  // dotenv đọc ra chuỗi rỗng "" (không phải undefined/null), mà `??` chỉ coi undefined/null
  // là "chưa có giá trị". Chuỗi rỗng "" bị truyền thẳng làm địa chỉ proposer, ethers không
  // nhận ra là địa chỉ hợp lệ nên thử phân giải như tên ENS, rồi crash với
  // NotImplementedError trên mạng Hardhat local (không hỗ trợ ENS). Dùng `||` để coi CẢ
  // chuỗi rỗng lẫn undefined/null là "chưa set".
  const proposerAddress = process.env.GOVERNANCE_MULTISIG_ADDRESS || deployer.address;
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

  // Vault Readiness Report - Phase 0: GUARDIAN_ROLE (pause khẩn cấp) phải nằm ở những
  // địa chỉ CÓ THỂ HÀNH ĐỘNG MỘT MÌNH, NGAY LẬP TỨC - tách hẳn khỏi
  // GOVERNANCE_MULTISIG_ADDRESS (Safe 2-of-3) vốn cần thu thập đủ chữ ký mới thực thi
  // được. Cấp thêm (KHÔNG thay thế) - admin bootstrap vẫn giữ GUARDIAN_ROLE cho tới khi
  // owner transfer sang Safe (xem SafeGovernance.test.ts), nhưng mọi guardian ca nhan
  // trong GUARDIAN_ADDRESSES co the pause() ngay, khong can cho Safe gom du chu ky.
  // GUARDIAN_ADDRESSES: danh sach dia chi phan cach boi dau phay, vi du 3 thanh vien
  // team giu 3 private key rieng biet (KHONG phai la 1 multisig contract - neu la
  // multisig thi lai quay lai dung van de bao cao chi ra: phai gom chu ky moi pause
  // duoc).
  const guardianAddresses = (process.env.GUARDIAN_ADDRESSES ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

  if (guardianAddresses.length > 0) {
    const guardianRole = await vault.GUARDIAN_ROLE();
    for (const guardian of guardianAddresses) {
      await (await vault.grantRole(guardianRole, guardian)).wait();
      console.log("GUARDIAN_ROLE granted to individual guardian:", guardian);
    }
  } else {
    console.log(
      "GUARDIAN_ADDRESSES not set - only the bootstrap admin can pause() for now (dev/local only)."
    );
  }

  // Vault Readiness Report - Phase 1: TVL cap giới hạn thiệt hại tối đa trong giai đoạn
  // đầu ra mắt (chưa audit thuê ngoài/bug bounty). DEPOSIT_CAP_RAW là số nguyên đơn vị
  // nhỏ nhất của asset (USDC 6 decimals - ví dụ "1000000000" = 1000 USDC), KHÔNG tự động
  // quy đổi đơn vị để tránh giả định sai lệch nếu sau này đổi asset. Không set = giữ mặc
  // định uncapped (type(uint256).max) của Vault.sol.
  const depositCapRaw = process.env.DEPOSIT_CAP_RAW;
  if (depositCapRaw) {
    await (await vault.setDepositCap(BigInt(depositCapRaw))).wait();
    console.log("Vault.depositCap set to:", depositCapRaw);
  } else {
    console.log("DEPOSIT_CAP_RAW not set - vault stays uncapped (dev/local default).");
  }

  // GD6 Milestone 6.2: CrossChainExecutor chi deploy duoc tren network co dia chi CCIP
  // Router THAT (Chainlink docs.chain.link/ccip/directory - khac nhau moi chain, khong
  // co gia tri "mac dinh" hop le nao de doan). Khong set CCIP_ROUTER_ADDRESS = bo qua
  // hoan toan buoc nay (dung cho local/hardhat va moi testnet chua can cross-chain).
  const ccipRouterAddress = process.env.CCIP_ROUTER_ADDRESS;
  let crossChainExecutorAddress: string | undefined;
  let crossChainTimelockAddress: string | undefined;

  if (ccipRouterAddress) {
    // Vault Security Audit (GD6.2 review) - Low-4: truoc day luon dung chinh MockUSDC vua
    // deploy o tren lam asset cho CrossChainExecutor - nhung MockUSDC khong co CCIP
    // TokenPool nao ca, moi ccipSend() se revert UnsupportedToken tren network THAT. Cho
    // phep override qua CCIP_ASSET_ADDRESS (vd. dia chi CCIP-BnM tren testnet, hoac USDC
    // that qua CCTP/token pool chinh thuc tren mainnet) - khong set = giu hanh vi cu (dung
    // MockUSDC, CHI hop le cho local/hardhat mo phong qua CCIPLocalSimulator, KHONG dung
    // duoc voi router that).
    // Cùng lớp bug với proposerAddress ở trên - dùng `||` thay vì `??` để chuỗi rỗng "" (từ
    // 1 dòng CCIP_ASSET_ADDRESS= để trống trong .env) cũng rơi về mặc định đúng như mong đợi.
    const ccipAssetAddress = process.env.CCIP_ASSET_ADDRESS || (await usdc.getAddress());
    if (!process.env.CCIP_ASSET_ADDRESS) {
      console.log(
        "WARNING: CCIP_ASSET_ADDRESS not set - defaulting to MockUSDC, which has NO real CCIP TokenPool. " +
          "ccipSend() will revert on any real CCIP router. Set CCIP_ASSET_ADDRESS for a real deployment."
      );
    }

    const CrossChainExecutorFactory = await ethers.getContractFactory("CrossChainExecutor");
    const executor = await CrossChainExecutorFactory.deploy(
      deployer.address,
      ccipRouterAddress,
      await strategyManager.getAddress(),
      ccipAssetAddress
    );
    await executor.waitForDeployment();
    crossChainExecutorAddress = await executor.getAddress();
    console.log("CrossChainExecutor:", crossChainExecutorAddress, "router:", ccipRouterAddress);

    const crossChainRole = await strategyManager.CROSS_CHAIN_ROLE();
    await (await strategyManager.grantRole(crossChainRole, crossChainExecutorAddress)).wait();
    console.log("CROSS_CHAIN_ROLE granted to CrossChainExecutor.");

    // Vault Security Audit (GD6.2 review) - Critical-1 fix: StrategyManager.totalAssets()
    // phai biet doc lai gia tri "dang gui remote" tu CrossChainExecutor, neu khong gia
    // share se sut ngay khi initiateTransfer() rut von di (xem StrategyManager.sol +
    // ICrossChainAccounting.sol).
    await (await strategyManager.setCrossChainExecutor(crossChainExecutorAddress)).wait();
    console.log("StrategyManager.crossChainExecutor set - totalAssets() now accounts for in-flight cross-chain funds.");

    const CrossChainTimelockFactory = await ethers.getContractFactory("CrossChainTimelock");
    const crossChainTimelock = await CrossChainTimelockFactory.deploy(
      deployer.address,
      proposerAddress,
      crossChainExecutorAddress
    );
    await crossChainTimelock.waitForDeployment();
    crossChainTimelockAddress = await crossChainTimelock.getAddress();
    console.log("CrossChainTimelock:", crossChainTimelockAddress, "proposer:", proposerAddress);

    const executorRoleOnCrossChain = await executor.EXECUTOR_ROLE();
    await (await executor.grantRole(executorRoleOnCrossChain, crossChainTimelockAddress)).wait();
    console.log("EXECUTOR_ROLE (CrossChainExecutor) granted to CrossChainTimelock.");

    // Vault Security Audit (GD6.2 review) - Critical-2 fix: truoc day deployer EOA giu
    // nguyen DEFAULT_ADMIN_ROLE tren CA 2 contract nay (khong nam trong quy trinh ban giao
    // cho Safe da ap dung cho Vault/StrategyManager - xem SafeGovernance.test.ts) - 1
    // private key ca nhan bi lo la du de setPeer() toi 1 dia chi tuy y + tu grant
    // EXECUTOR_ROLE cho chinh no + rut sach TVL cross-chain, bo qua hoan toan Timelock 48h
    // va Safe. Ap dung dung quy trinh da chuan hoa: grant cho Safe truoc, revoke khoi
    // deployer sau - chi khi proposerAddress la 1 dia chi Safe that (khac deployer); giu
    // nguyen quyen deployer trong moi truong dev/local (GOVERNANCE_MULTISIG_ADDRESS chua
    // set) de khong tu khoa chinh minh giua chung script.
    if (proposerAddress.toLowerCase() !== deployer.address.toLowerCase()) {
      const executorAdminRole = await executor.DEFAULT_ADMIN_ROLE();
      await (await executor.grantRole(executorAdminRole, proposerAddress)).wait();
      await (await executor.revokeRole(executorAdminRole, deployer.address)).wait();
      console.log("CrossChainExecutor.DEFAULT_ADMIN_ROLE transferred to Safe and revoked from deployer.");

      const timelockAdminRole = await crossChainTimelock.DEFAULT_ADMIN_ROLE();
      await (await crossChainTimelock.grantRole(timelockAdminRole, proposerAddress)).wait();
      await (await crossChainTimelock.revokeRole(timelockAdminRole, deployer.address)).wait();
      console.log("CrossChainTimelock.DEFAULT_ADMIN_ROLE transferred to Safe and revoked from deployer.");
    } else {
      console.log(
        "GOVERNANCE_MULTISIG_ADDRESS not set - deployer keeps DEFAULT_ADMIN_ROLE on " +
          "CrossChainExecutor/CrossChainTimelock (dev/local only, NOT safe for a funded deployment)."
      );
    }

    // Peer whitelist (setPeer) KHONG lam o day - can dia chi CrossChainExecutor cua chain
    // KIA, chi biet duoc SAU KHI da deploy ca 2 chain. Xem PLAN.md GD6 §4/§9: buoc noi cap
    // 2 executor lai voi nhau la thao tac thu cong rieng, chay sau khi deploy xong ca 2
    // phia (vi du qua 1 script wire-cross-chain-peers.ts o lan trien khai chain thu 2 -
    // chua lam trong lan nay vi moi co 1 chain deploy Executor tinh den thoi diem hien tai).
    console.log(
      "NOTE: CrossChainExecutor.setPeer() chua duoc goi - phai goi thu cong sau khi ca 2 chain deploy xong."
    );
  } else {
    console.log("CCIP_ROUTER_ADDRESS not set - skipping CrossChainExecutor/CrossChainTimelock deploy.");
  }

  console.log("\n--- Deploy done ---");
  console.log(JSON.stringify({
    usdc: await usdc.getAddress(),
    vault: await vault.getAddress(),
    strategyManager: await strategyManager.getAddress(),
    strategy: strategyAddress,
    strategyType,
    rebalanceTimelock: await timelock.getAddress(),
    crossChainExecutor: crossChainExecutorAddress ?? null,
    crossChainTimelock: crossChainTimelockAddress ?? null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
