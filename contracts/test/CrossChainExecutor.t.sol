// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {CCIPLocalSimulator} from "@chainlink/local/src/ccip/CCIPLocalSimulator.sol";
import {BurnMintERC677Helper} from "@chainlink/local/src/ccip/BurnMintERC677Helper.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StrategyManager} from "../src/StrategyManager.sol";
import {CrossChainExecutor} from "../src/CrossChainExecutor.sol";
import {CrossChainTimelock} from "../src/CrossChainTimelock.sol";
import {IStrategy} from "../src/interfaces/IStrategy.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Strategy test toi gian (khong tich luy lai) danh RIENG cho file test nay -
/// KHONG dung MockStrategy.sol (test-helper dung chung cua du an) vi co che "chot lai gia
/// lap" cua no dua vao 1 dac thu chi co o MockUSDC (mint khong gioi han cho bat ky ai goi -
/// xem MockStrategy._accrueYield). Token dung trong file nay la ccipBnM cua chinh CCIP
/// Local Simulator (BurnMintERC677) - mint cua no bi khoa qua MINTER_ROLE (chi chu so huu
/// - la CCIPLocalSimulator - cap duoc), nen goi thang MockStrategy sau khi vm.warp() qua
/// MIN_DELAY se lam _accrueYield() revert (mint that bai) - khong lien quan gi toi dung logic
/// CrossChainExecutor dang can verify o day. PassthroughTestStrategy chi giu nguyen principal,
/// khong co lai gia lap - dung dang cua 1 "strategy test toi gian" cho muc dich nay.
contract PassthroughTestStrategy is IStrategy {
    using SafeERC20 for IERC20;

    IERC20 public immutable assetToken;
    address public immutable caller;
    uint256 private principal;

    constructor(address _asset, address _caller) {
        assetToken = IERC20(_asset);
        caller = _caller;
    }

    modifier onlyCaller() {
        require(msg.sender == caller, "PassthroughTestStrategy: only caller");
        _;
    }

    function deposit(uint256 amount) external onlyCaller {
        principal += amount;
    }

    function withdraw(uint256 amount, address to) external onlyCaller {
        require(amount <= principal, "PassthroughTestStrategy: insufficient principal");
        principal -= amount;
        assetToken.safeTransfer(to, amount);
    }

    function asset() external view returns (address) {
        return address(assetToken);
    }

    function totalAssets() external view returns (uint256) {
        return principal;
    }
}

/// @notice GD6 Milestone 6.2 - verify CrossChainExecutor/CrossChainTimelock bang CCIP
/// LOCAL SIMULATOR (package chainlink/local) - mo phong gui/nhan CCIP tren CUNG 1 EVM test qua 1
/// MockCCIPRouter dai dien ca 2 chieu (dung nguyen tac "simulate cuc bo truoc" da ap dung
/// o GD5 - xem scripts/verify-multichain-sync.sh), KHONG can testnet/RPC/LINK that.
///
/// Dung token demo cua chinh simulator (`ccipBnM`, mot BurnMintERC677 da duoc dang ky san
/// voi TokenPool cua router mo phong) lam asset cho 2 StrategyManager gia lap - tranh phai
/// tu deploy/dang ky TokenPool cho MockUSDC (viec do la cua Circle/Chainlink lam that tren
/// production, khong phai viec cua project nay - xem NatSpec CrossChainExecutor.sol).
contract CrossChainExecutorTest is Test {
    CCIPLocalSimulator simulator;
    uint64 chainSelector;
    IRouterClient sourceRouter;
    IRouterClient destRouter;
    BurnMintERC677Helper token;

    StrategyManager sourceManager;
    StrategyManager destManager;
    CrossChainExecutor sourceExecutor;
    CrossChainExecutor destExecutor;
    CrossChainTimelock sourceTimelock;

    PassthroughTestStrategy sourceStrategy;
    PassthroughTestStrategy destStrategy;

    address admin = address(0xAD417);
    address multisig = address(0x54F3);
    address fakeVault = address(0x1234);

    uint256 constant SEED_AMOUNT = 1e18; // BurnMintERC677Helper.drip() luon mint dung 1e18

    function setUp() public {
        simulator = new CCIPLocalSimulator();
        (
            uint64 chainSelector_,
            IRouterClient sourceRouter_,
            IRouterClient destinationRouter_,
            ,
            ,
            BurnMintERC677Helper ccipBnM_,
        ) = simulator.configuration();
        chainSelector = chainSelector_;
        sourceRouter = sourceRouter_;
        destRouter = destinationRouter_;
        token = ccipBnM_;

        sourceManager = new StrategyManager(address(token), fakeVault, admin);
        destManager = new StrategyManager(address(token), fakeVault, admin);

        sourceExecutor = new CrossChainExecutor(admin, address(sourceRouter), sourceManager, IERC20(address(token)));
        destExecutor = new CrossChainExecutor(admin, address(destRouter), destManager, IERC20(address(token)));

        sourceStrategy = new PassthroughTestStrategy(address(token), address(sourceManager));
        destStrategy = new PassthroughTestStrategy(address(token), address(destManager));

        vm.startPrank(admin);
        sourceManager.registerStrategy(address(sourceStrategy));
        destManager.registerStrategy(address(destStrategy));

        // Grant CROSS_CHAIN_ROLE cho executor tren dung chain cua no.
        sourceManager.grantRole(sourceManager.CROSS_CHAIN_ROLE(), address(sourceExecutor));
        destManager.grantRole(destManager.CROSS_CHAIN_ROLE(), address(destExecutor));

        // Whitelist peer 2 chieu.
        sourceExecutor.setPeer(chainSelector, address(destExecutor));
        destExecutor.setPeer(chainSelector, address(sourceExecutor));

        address[] memory sourceStrategies = new address[](1);
        sourceStrategies[0] = address(sourceStrategy);
        uint16[] memory sourceWeights = new uint16[](1);
        sourceWeights[0] = 10_000;
        sourceManager.setAllocations(sourceStrategies, sourceWeights);

        address[] memory destStrategies = new address[](1);
        destStrategies[0] = address(destStrategy);
        uint16[] memory destWeights = new uint16[](1);
        destWeights[0] = 10_000;
        destManager.setAllocations(destStrategies, destWeights);

        sourceTimelock = new CrossChainTimelock(admin, multisig, sourceExecutor);
        sourceExecutor.grantRole(sourceExecutor.EXECUTOR_ROLE(), address(sourceTimelock));
        vm.stopPrank();

        // Seed von vao source strategy giong cach Vault lam that: push token vao
        // StrategyManager truoc, roi goi deposit() (onlyVault).
        token.drip(address(this));
        token.transfer(address(sourceManager), SEED_AMOUNT);
        vm.prank(fakeVault);
        sourceManager.deposit(SEED_AMOUNT);

        // Nap gas native cho executor nguon tra phi CCIP (mock router mac dinh fee = 0,
        // nhung nap san de test khong phu thuoc vao hanh vi fee cua mock).
        vm.deal(address(sourceExecutor), 10 ether);
    }

    function test_transferMovesFundsAcrossSimulatedChains() public {
        uint256 amount = SEED_AMOUNT / 2;
        assertEq(sourceStrategy.totalAssets(), SEED_AMOUNT);

        vm.prank(multisig);
        sourceTimelock.queueTransfer(chainSelector, amount);

        vm.warp(block.timestamp + sourceTimelock.MIN_DELAY());
        sourceTimelock.executeTransfer(chainSelector, amount);

        assertEq(destStrategy.totalAssets(), amount, "destination strategy should receive the transferred amount");
        assertEq(sourceStrategy.totalAssets(), SEED_AMOUNT - amount, "source strategy should be reduced accordingly");
    }

    function test_cannotExecuteBeforeDelay() public {
        uint256 amount = SEED_AMOUNT / 2;

        vm.prank(multisig);
        sourceTimelock.queueTransfer(chainSelector, amount);

        vm.expectRevert("CrossChainTimelock: too early");
        sourceTimelock.executeTransfer(chainSelector, amount);
    }

    function test_cancelBeforeExecutionPreventsTransfer() public {
        uint256 amount = SEED_AMOUNT / 2;

        vm.startPrank(multisig);
        sourceTimelock.queueTransfer(chainSelector, amount);
        sourceTimelock.cancelTransfer(chainSelector, amount);
        vm.stopPrank();

        vm.warp(block.timestamp + sourceTimelock.MIN_DELAY());
        vm.expectRevert("CrossChainTimelock: not queued");
        sourceTimelock.executeTransfer(chainSelector, amount);

        assertEq(destStrategy.totalAssets(), 0, "no funds should have moved");
    }

    function test_onlyExecutorRoleCanInitiateTransferDirectly() public {
        vm.expectRevert();
        sourceExecutor.initiateTransfer(chainSelector, 1);
    }

    function test_unknownPeerRejectsTransfer() public {
        vm.prank(admin);
        sourceExecutor.setPeer(chainSelector, address(0));

        vm.prank(multisig);
        sourceTimelock.queueTransfer(chainSelector, 1);
        vm.warp(block.timestamp + sourceTimelock.MIN_DELAY());

        vm.expectRevert(abi.encodeWithSelector(CrossChainExecutor.UnknownPeer.selector, chainSelector));
        sourceTimelock.executeTransfer(chainSelector, 1);
    }

    /// @notice Mo phong dung "duong rut lui" that (PLAN.md GD6 §4/§9): destination
    /// StrategyManager tam thoi thu hoi CROSS_CHAIN_ROLE cua executor (gia lap 1 loi tam
    /// thoi bat ky trong duong deposit lai) - CrossChainExecutor phai KHONG revert (tranh
    /// ket o tang CCIP), giu token an toan, roi cho phep retry sau khi van de duoc khac
    /// phuc, khong can gui lai tu dau.
    function test_failedDepositIsRecoverableViaRetry() public {
        bytes32 crossChainRole = destManager.CROSS_CHAIN_ROLE();
        vm.prank(admin);
        destManager.revokeRole(crossChainRole, address(destExecutor));

        uint256 amount = SEED_AMOUNT / 2;
        vm.prank(multisig);
        sourceTimelock.queueTransfer(chainSelector, amount);
        vm.warp(block.timestamp + sourceTimelock.MIN_DELAY());

        vm.recordLogs();
        sourceTimelock.executeTransfer(chainSelector, amount);
        bytes32 messageId = _extractMessageFailedId();

        // Token da toi noi nhung deposit that bai (thieu role) -> nam an toan trong
        // destExecutor, KHONG bi mat, KHONG lam ket ca giao dich CCIP.
        assertEq(token.balanceOf(address(destExecutor)), amount, "tokens should sit safely in dest executor");
        assertEq(destStrategy.totalAssets(), 0, "deposit should not have gone through yet");

        // Khac phuc nguyen nhan roi retry - permissionless, ai cung goi duoc.
        vm.prank(admin);
        destManager.grantRole(crossChainRole, address(destExecutor));
        destExecutor.retryFailedMessage(messageId);

        assertEq(destStrategy.totalAssets(), amount, "retry should complete the deposit");
        assertEq(token.balanceOf(address(destExecutor)), 0, "dest executor should hold nothing after recovery");
    }

    /// @notice Duong rut lui cuoi cung: neu retry khong bao gio thanh cong duoc, admin co
    /// the rut token bi ket ve 1 dia chi bat ky de xu ly thu cong.
    function test_adminCanRescueFailedMessageAsLastResort() public {
        bytes32 crossChainRole = destManager.CROSS_CHAIN_ROLE();
        vm.prank(admin);
        destManager.revokeRole(crossChainRole, address(destExecutor));

        uint256 amount = SEED_AMOUNT / 2;
        vm.prank(multisig);
        sourceTimelock.queueTransfer(chainSelector, amount);
        vm.warp(block.timestamp + sourceTimelock.MIN_DELAY());

        vm.recordLogs();
        sourceTimelock.executeTransfer(chainSelector, amount);
        bytes32 messageId = _extractMessageFailedId();

        address rescueTarget = address(0xCAFE);
        vm.prank(admin);
        destExecutor.rescueFailedMessage(messageId, rescueTarget);

        assertEq(token.balanceOf(rescueTarget), amount, "rescued funds should land at the admin-specified address");

        // Khong the rescue lan 2 cung 1 message.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(CrossChainExecutor.MessageAlreadyRecovered.selector, messageId));
        destExecutor.rescueFailedMessage(messageId, rescueTarget);
    }

    function _extractMessageFailedId() internal view returns (bytes32 messageId) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("MessageFailed(bytes32,uint256,bytes)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == topic) {
                return logs[i].topics[1];
            }
        }
        revert("MessageFailed event not found in recorded logs");
    }
}
