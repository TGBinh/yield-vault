// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {CCIPLocalSimulator} from "@chainlink/local/src/ccip/CCIPLocalSimulator.sol";
import {BurnMintERC677Helper} from "@chainlink/local/src/ccip/BurnMintERC677Helper.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
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
///
/// Vault Security Audit (GD6.2 cross-chain review) - bo test nay viet lai gan nhu toan bo
/// sau khi phat hien Critical-1 (thieu ke toan liên chain) va Critical-2 (thieu ban giao
/// quyen admin), cong them cac test truoc day BI THIEU ma audit chi dich danh la "unverified
/// claim": gia mao peer dau vao, double-recovery, tran TVL onchain, grace period.
contract CrossChainExecutorTest is Test {
    CCIPLocalSimulator simulator;
    uint64 chainSelector;
    IRouterClient sourceRouter;
    IRouterClient destRouter;
    BurnMintERC677Helper token;
    BurnMintERC677Helper otherToken;

    StrategyManager sourceManager;
    StrategyManager destManager;
    CrossChainExecutor sourceExecutor;
    CrossChainExecutor destExecutor;
    CrossChainTimelock sourceTimelock;
    CrossChainTimelock destTimelock;

    PassthroughTestStrategy sourceStrategy;
    PassthroughTestStrategy destStrategy;

    address admin = address(0xAD417);
    address multisig = address(0x54F3);
    address fakeVault = address(0x1234);

    uint256 constant SEED_AMOUNT = 1e18; // BurnMintERC677Helper.drip() luon mint dung 1e18
    // MAX_TRANSFER_BPS cua CrossChainTimelock la 2000 (20%) - moi test "happy path" phai
    // nam duoi nguong nay de khong bi ExceedsTvlCap chan.
    uint256 constant WITHIN_CAP_AMOUNT = (SEED_AMOUNT * 15) / 100; // 15% < 20%
    uint256 constant OVER_CAP_AMOUNT = (SEED_AMOUNT * 30) / 100; // 30% > 20%

    function setUp() public {
        simulator = new CCIPLocalSimulator();
        (
            uint64 chainSelector_,
            IRouterClient sourceRouter_,
            IRouterClient destinationRouter_,
            ,
            ,
            BurnMintERC677Helper ccipBnM_,
            BurnMintERC677Helper ccipLnM_
        ) = simulator.configuration();
        chainSelector = chainSelector_;
        sourceRouter = sourceRouter_;
        destRouter = destinationRouter_;
        token = ccipBnM_;
        otherToken = ccipLnM_;

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

        // Vault Security Audit Critical-1: wiring bat buoc de totalAssets() cong dung gia
        // tri remote - thieu buoc nay la mot trong nhung dieu kien de tai hien bug goc.
        sourceManager.setCrossChainExecutor(address(sourceExecutor));
        destManager.setCrossChainExecutor(address(destExecutor));

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

        destTimelock = new CrossChainTimelock(admin, multisig, destExecutor);
        destExecutor.grantRole(destExecutor.EXECUTOR_ROLE(), address(destTimelock));
        vm.stopPrank();

        // Seed von vao source strategy giong cach Vault lam that: push token vao
        // StrategyManager truoc, roi goi deposit() (onlyVault).
        token.drip(address(this));
        token.transfer(address(sourceManager), SEED_AMOUNT);
        vm.prank(fakeVault);
        sourceManager.deposit(SEED_AMOUNT);

        // Nap gas native cho ca 2 executor tra phi CCIP (mock router mac dinh fee = 0,
        // nhung nap san de test khong phu thuoc vao hanh vi fee cua mock).
        vm.deal(address(sourceExecutor), 10 ether);
        vm.deal(address(destExecutor), 10 ether);
    }

    function _queueAndWarpOutbound(uint256 amount) internal {
        vm.prank(multisig);
        sourceTimelock.queueTransfer(chainSelector, amount, CrossChainTimelock.TransferKind.OUTBOUND);
        vm.warp(block.timestamp + sourceTimelock.MIN_DELAY());
    }

    // ------------------------------------------------------------------
    // Critical-1 fix: ke toan liên chain - dung trong tam cua dot audit nay.
    // ------------------------------------------------------------------

    function test_outboundTransferDoesNotChangeSourceTotalAssets() public {
        assertEq(sourceManager.totalAssets(), SEED_AMOUNT, "sanity: seeded correctly");

        _queueAndWarpOutbound(WITHIN_CAP_AMOUNT);
        sourceTimelock.executeTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.OUTBOUND);

        // Day chinh la fix Critical-1: von roi khoi strategy noi bo nhung
        // totalAssets() TUYET DOI KHONG DOI - gia share cua depositor nguon khong sut.
        assertEq(
            sourceManager.totalAssets(), SEED_AMOUNT, "source totalAssets must stay unchanged right after send"
        );
        assertEq(sourceStrategy.totalAssets(), SEED_AMOUNT - WITHIN_CAP_AMOUNT, "strategy balance did decrease");
        assertEq(sourceExecutor.remoteAssets(chainSelector), WITHIN_CAP_AMOUNT, "receivable tracked correctly");
    }

    function test_inboundDepositDoesNotInflateDestinationTotalAssets() public {
        _queueAndWarpOutbound(WITHIN_CAP_AMOUNT);
        sourceTimelock.executeTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.OUTBOUND);

        // Day la nua con lai cua fix Critical-1: depositor o chain dich KHONG duoc huong
        // loi gi tu von dang qua canh - totalAssets() cua ho phai giu nguyen 0, tien nam
        // ngoai ke toan Vault/StrategyManager hoan toan (custody, khong commingle).
        assertEq(destManager.totalAssets(), 0, "destination depositors must see zero exposure to custody funds");
        assertEq(destStrategy.totalAssets(), 0, "custody funds must NOT be auto-invested into destination strategies");
        assertEq(token.balanceOf(address(destExecutor)), WITHIN_CAP_AMOUNT, "funds sit idle in custody");
        assertEq(destExecutor.heldForRemote(chainSelector), WITHIN_CAP_AMOUNT, "custody ledger updated");
    }

    /// @notice Kich ban khai thac cu (truoc fix): "deposit vao vault dich dung luc tien
    /// toi roi rut ra ngay" - gio phai HOAN TOAN VO NGHIA vi totalAssets() dich khong bao
    /// gio bi anh huong boi custody funds.
    function test_destinationDepositorCannotSiphonInFlightFunds() public {
        _queueAndWarpOutbound(WITHIN_CAP_AMOUNT);
        sourceTimelock.executeTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.OUTBOUND);

        // "Attacker" o chain dich thu deposit ngay sau khi tien toi.
        address attacker = address(0xBAD);
        token.drip(attacker);
        uint256 attackerDeposit = token.balanceOf(attacker);

        vm.startPrank(attacker);
        token.transfer(address(destManager), attackerDeposit);
        vm.stopPrank();
        vm.prank(fakeVault);
        destManager.deposit(attackerDeposit);

        // TVL dich chi tang dung bang phan attacker tu deposit - khong an them 1 dong nao
        // tu custody funds.
        assertEq(destManager.totalAssets(), attackerDeposit, "attacker cannot inflate TVL using custody funds");
    }

    function test_fullRoundTripPreservesSourceTotalAssetsThroughout() public {
        _queueAndWarpOutbound(WITHIN_CAP_AMOUNT);
        sourceTimelock.executeTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.OUTBOUND);
        assertEq(sourceManager.totalAssets(), SEED_AMOUNT, "unchanged after send");

        // Chain dich (Safe cua no) quyet dinh tra lai von dang giu ho.
        vm.prank(multisig);
        destTimelock.queueTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.RETURN);
        vm.warp(block.timestamp + destTimelock.MIN_DELAY());
        destTimelock.executeTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.RETURN);

        // Von da ve nha va duoc tich hop lai vao strategy noi bo cua chain nguon.
        assertEq(sourceManager.totalAssets(), SEED_AMOUNT, "still unchanged after round trip");
        assertEq(sourceStrategy.totalAssets(), SEED_AMOUNT, "funds re-integrated into local strategy");
        assertEq(sourceExecutor.remoteAssets(chainSelector), 0, "receivable cleared");
        assertEq(destExecutor.heldForRemote(chainSelector), 0, "custody released");
        assertEq(destManager.totalAssets(), 0, "destination never touched throughout");
    }

    // ------------------------------------------------------------------
    // High-1: grace period.
    // ------------------------------------------------------------------

    function test_cannotExecuteBeforeDelay() public {
        vm.prank(multisig);
        sourceTimelock.queueTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.OUTBOUND);

        vm.expectRevert("CrossChainTimelock: too early");
        sourceTimelock.executeTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.OUTBOUND);
    }

    function test_executeRevertsAfterGracePeriodExpires() public {
        _queueAndWarpOutbound(WITHIN_CAP_AMOUNT);
        vm.warp(block.timestamp + sourceTimelock.GRACE_PERIOD() + 1);

        vm.expectRevert("CrossChainTimelock: expired");
        sourceTimelock.executeTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.OUTBOUND);
    }

    function test_cancelBeforeExecutionPreventsTransfer() public {
        vm.startPrank(multisig);
        sourceTimelock.queueTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.OUTBOUND);
        sourceTimelock.cancelTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.OUTBOUND);
        vm.stopPrank();

        vm.warp(block.timestamp + sourceTimelock.MIN_DELAY());
        vm.expectRevert("CrossChainTimelock: not queued");
        sourceTimelock.executeTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.OUTBOUND);

        assertEq(destExecutor.heldForRemote(chainSelector), 0, "no funds should have moved");
    }

    // ------------------------------------------------------------------
    // High-2: tran %TVL onchain that su, khong chi loi hua o backend.
    // ------------------------------------------------------------------

    function test_queueRejectsAmountExceedingTvlCap() public {
        vm.prank(multisig);
        vm.expectRevert(
            abi.encodeWithSelector(CrossChainTimelock.ExceedsTvlCap.selector, OVER_CAP_AMOUNT, SEED_AMOUNT)
        );
        sourceTimelock.queueTransfer(chainSelector, OVER_CAP_AMOUNT, CrossChainTimelock.TransferKind.OUTBOUND);
    }

    /// @notice De xuat HOP LE luc queue (duoi tran) nhung TVL da co rut bot truoc khi
    /// execute, khien no VUOT tran so voi TVL hien tai - phai bi chan lai o buoc execute,
    /// khong chi kiem tra 1 lan duy nhat luc queue.
    function test_executeRejectsWhenTvlShrankBelowCapAfterQueue() public {
        _queueAndWarpOutbound(WITHIN_CAP_AMOUNT);

        // TVL nguon rut bot xuong con thap hon WITHIN_CAP_AMOUNT / 20% ratio ban dau.
        uint256 shrinkTo = WITHIN_CAP_AMOUNT / 2; // sau khi rut, WITHIN_CAP_AMOUNT se > 20% cua so du con lai
        uint256 currentTvl = sourceManager.totalAssets();
        vm.prank(fakeVault);
        sourceManager.withdraw(currentTvl - shrinkTo, address(0xCAFE));

        vm.expectRevert(
            abi.encodeWithSelector(CrossChainTimelock.ExceedsTvlCap.selector, WITHIN_CAP_AMOUNT, shrinkTo)
        );
        sourceTimelock.executeTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.OUTBOUND);
    }

    // ------------------------------------------------------------------
    // Access control.
    // ------------------------------------------------------------------

    function test_onlyExecutorRoleCanInitiateTransferDirectly() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), sourceExecutor.EXECUTOR_ROLE()
            )
        );
        sourceExecutor.initiateTransfer(chainSelector, 1);
    }

    function test_unknownPeerRejectsTransfer() public {
        vm.prank(admin);
        sourceExecutor.setPeer(chainSelector, address(0));

        vm.prank(multisig);
        sourceTimelock.queueTransfer(chainSelector, 1, CrossChainTimelock.TransferKind.OUTBOUND);
        vm.warp(block.timestamp + sourceTimelock.MIN_DELAY());

        vm.expectRevert(abi.encodeWithSelector(CrossChainExecutor.UnknownPeer.selector, chainSelector));
        sourceTimelock.executeTransfer(chainSelector, 1, CrossChainTimelock.TransferKind.OUTBOUND);
    }

    /// @notice Vault Security Audit - "unverified claim": truoc day KHONG co test nao cho
    /// _ccipReceive's UnauthorizedSender, du day duoc mo ta la "co che xac thuc DUY NHAT
    /// cho inbound message". Mo phong 1 ke tan cong goi thang router.ccipSend (bo qua hoan
    /// toan CrossChainExecutor) nham vao destExecutor - msg.sender o tang router se la
    /// dia chi test contract nay, KHONG khop voi peers[chainSelector] (= sourceExecutor
    /// that), nen phai bi tu choi.
    function test_inboundMessageFromUnwhitelistedSenderIsRejected() public {
        uint256 amount = 1e17;
        token.drip(address(this));
        token.approve(address(destRouter), amount);

        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        tokenAmounts[0] = Client.EVMTokenAmount({token: address(token), amount: amount});
        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(address(destExecutor)),
            data: abi.encode(CrossChainExecutor.CrossChainMessageType.DEPOSIT),
            tokenAmounts: tokenAmounts,
            extraArgs: Client._argsToBytes(
                Client.GenericExtraArgsV2({gasLimit: 1_500_000, allowOutOfOrderExecution: true})
            ),
            feeToken: address(0)
        });

        // MockCCIPRouter.ccipSend() goi thang _ccipReceive trong CUNG giao dich va bubble
        // revert cua no len (xem MockRouter.sol: `if (!success) revert ReceiverError(...)`) -
        // khac CCIP that (async), nhung van chung minh dung 1 dieu: message tu sender la
        // (this) khong duoc chap nhan.
        vm.expectRevert();
        destRouter.ccipSend(chainSelector, message);

        assertEq(destExecutor.heldForRemote(chainSelector), 0, "spoofed message must not be credited");
    }

    /// @notice Medium-1: message mang token KHAC voi `asset` cua executor phai bi tu choi,
    /// khong duoc am tham rut nham tu balance `asset` that.
    function test_inboundMessageWithWrongTokenIsRejected() public {
        // "sourceExecutor" gia mao gui nham ccipLnM thay vi ccipBnM - mo phong bang cach
        // tu goi router truc tiep VOI dia chi sourceExecutor lam nguoi goi (prank), giu
        // dung "sender" hop le nhung sai token.
        uint256 amount = 1e17;
        otherToken.drip(address(sourceExecutor));

        vm.startPrank(address(sourceExecutor));
        otherToken.approve(address(sourceRouter), amount);

        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        tokenAmounts[0] = Client.EVMTokenAmount({token: address(otherToken), amount: amount});
        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(address(destExecutor)),
            data: abi.encode(CrossChainExecutor.CrossChainMessageType.DEPOSIT),
            tokenAmounts: tokenAmounts,
            extraArgs: Client._argsToBytes(
                Client.GenericExtraArgsV2({gasLimit: 1_500_000, allowOutOfOrderExecution: true})
            ),
            feeToken: address(0)
        });

        vm.expectRevert();
        sourceRouter.ccipSend(chainSelector, message);
        vm.stopPrank();

        assertEq(destExecutor.heldForRemote(chainSelector), 0, "wrong-token message must not be credited");
    }

    // ------------------------------------------------------------------
    // Failure / retry / rescue on the RETURN leg (the only leg that can fail - DEPOSIT is
    // pure bookkeeping and cannot revert).
    // ------------------------------------------------------------------

    function _sendOutboundThenQueueReturn(uint256 amount) internal {
        _queueAndWarpOutbound(amount);
        sourceTimelock.executeTransfer(chainSelector, amount, CrossChainTimelock.TransferKind.OUTBOUND);

        vm.prank(multisig);
        destTimelock.queueTransfer(chainSelector, amount, CrossChainTimelock.TransferKind.RETURN);
        vm.warp(block.timestamp + destTimelock.MIN_DELAY());
    }

    /// @notice Mo phong dung "duong rut lui" that (PLAN.md GD6 §4/§9): source StrategyManager
    /// tam thoi thu hoi CROSS_CHAIN_ROLE cua sourceExecutor de gia lap 1 loi tam thoi bat
    /// ky trong duong tich hop lai RETURN - CrossChainExecutor phai KHONG revert (tranh
    /// ket o tang CCIP), giu token an toan, roi cho phep retry sau khi van de duoc khac
    /// phuc, khong can gui lai tu dau.
    function test_failedReturnIsRecoverableViaRetry() public {
        bytes32 crossChainRole = sourceManager.CROSS_CHAIN_ROLE();
        _sendOutboundThenQueueReturn(WITHIN_CAP_AMOUNT);

        // Chi thu hoi role SAU KHI leg OUTBOUND da gui thanh cong - withdrawToExecutor()
        // (OUTBOUND) va depositFromExecutor() (RETURN) dung CHUNG 1 role, thu hoi som se
        // lam hong ca leg gui di truoc khi kip toi luot gia lap loi o leg tra ve.
        vm.prank(admin);
        sourceManager.revokeRole(crossChainRole, address(sourceExecutor));

        vm.recordLogs();
        destTimelock.executeTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.RETURN);
        bytes32 messageId = _extractMessageFailedId();

        // Token da toi noi nhung tich hop lai that bai (thieu role) -> nam an toan trong
        // sourceExecutor, KHONG bi mat, KHONG lam ket ca giao dich CCIP. remoteAssets van
        // giu nguyen (chua "ve nha" that su) - khong bi dem thieu.
        assertEq(token.balanceOf(address(sourceExecutor)), WITHIN_CAP_AMOUNT, "tokens sit safely pending retry");
        assertEq(sourceStrategy.totalAssets(), SEED_AMOUNT - WITHIN_CAP_AMOUNT, "not re-integrated yet");
        assertEq(sourceExecutor.remoteAssets(chainSelector), WITHIN_CAP_AMOUNT, "receivable untouched while pending");
        assertEq(sourceManager.totalAssets(), SEED_AMOUNT, "totalAssets still correct via remoteAssets");

        vm.prank(admin);
        sourceManager.grantRole(crossChainRole, address(sourceExecutor));
        sourceExecutor.retryFailedMessage(messageId);

        assertEq(sourceStrategy.totalAssets(), SEED_AMOUNT, "retry completed the re-integration");
        assertEq(sourceExecutor.remoteAssets(chainSelector), 0, "receivable cleared after retry");
        assertEq(sourceManager.totalAssets(), SEED_AMOUNT, "still correct after retry");
    }

    function test_retryFailedMessageRevertsForUnknownMessageId() public {
        vm.expectRevert(abi.encodeWithSelector(CrossChainExecutor.MessageNotFailed.selector, bytes32(uint256(1))));
        sourceExecutor.retryFailedMessage(bytes32(uint256(1)));
    }

    function test_cannotRetryTwiceAfterSuccessfulRecovery() public {
        bytes32 crossChainRole = sourceManager.CROSS_CHAIN_ROLE();
        _sendOutboundThenQueueReturn(WITHIN_CAP_AMOUNT);
        vm.prank(admin);
        sourceManager.revokeRole(crossChainRole, address(sourceExecutor));

        vm.recordLogs();
        destTimelock.executeTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.RETURN);
        bytes32 messageId = _extractMessageFailedId();

        vm.prank(admin);
        sourceManager.grantRole(crossChainRole, address(sourceExecutor));
        sourceExecutor.retryFailedMessage(messageId);

        vm.expectRevert(abi.encodeWithSelector(CrossChainExecutor.MessageAlreadyRecovered.selector, messageId));
        sourceExecutor.retryFailedMessage(messageId);
    }

    /// @notice TRADEOFF-1 cua audit: xac nhan admin KHONG the rescue 1 message da duoc
    /// retry thanh cong truoc do - `recovered` phai chan dung ca 2 chieu.
    function test_cannotRescueAfterSuccessfulRetry() public {
        bytes32 crossChainRole = sourceManager.CROSS_CHAIN_ROLE();
        _sendOutboundThenQueueReturn(WITHIN_CAP_AMOUNT);
        vm.prank(admin);
        sourceManager.revokeRole(crossChainRole, address(sourceExecutor));

        vm.recordLogs();
        destTimelock.executeTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.RETURN);
        bytes32 messageId = _extractMessageFailedId();

        vm.prank(admin);
        sourceManager.grantRole(crossChainRole, address(sourceExecutor));
        sourceExecutor.retryFailedMessage(messageId);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(CrossChainExecutor.MessageAlreadyRecovered.selector, messageId));
        sourceExecutor.rescueFailedMessage(messageId, address(0xCAFE));
    }

    /// @notice Duong rut lui cuoi cung: neu retry khong bao gio thanh cong duoc, admin co
    /// the rut token bi ket ve 1 dia chi bat ky de xu ly thu cong - va remoteAssets phai
    /// duoc don dep dung theo (khong con "no ao").
    function test_adminCanRescueFailedMessageAsLastResort() public {
        bytes32 crossChainRole = sourceManager.CROSS_CHAIN_ROLE();
        _sendOutboundThenQueueReturn(WITHIN_CAP_AMOUNT);
        vm.prank(admin);
        sourceManager.revokeRole(crossChainRole, address(sourceExecutor));

        vm.recordLogs();
        destTimelock.executeTransfer(chainSelector, WITHIN_CAP_AMOUNT, CrossChainTimelock.TransferKind.RETURN);
        bytes32 messageId = _extractMessageFailedId();

        address rescueTarget = address(0xCAFE);
        vm.prank(admin);
        sourceExecutor.rescueFailedMessage(messageId, rescueTarget);

        assertEq(token.balanceOf(rescueTarget), WITHIN_CAP_AMOUNT, "rescued funds land at admin-specified address");
        assertEq(sourceExecutor.remoteAssets(chainSelector), 0, "receivable cleared, no phantom value left");
        assertEq(
            sourceManager.totalAssets(),
            SEED_AMOUNT - WITHIN_CAP_AMOUNT,
            "totalAssets now honestly reflects the funds given away"
        );

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(CrossChainExecutor.MessageAlreadyRecovered.selector, messageId));
        sourceExecutor.rescueFailedMessage(messageId, rescueTarget);
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
