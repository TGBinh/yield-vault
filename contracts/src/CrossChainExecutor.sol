// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CCIPReceiver} from "@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {IAny2EVMMessageReceiver} from "@chainlink/contracts-ccip/contracts/interfaces/IAny2EVMMessageReceiver.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {StrategyManager} from "./StrategyManager.sol";

/// @notice GD6 Milestone 6.2 - thay the SimpleBridge (chi de hoc, xem SimpleBridge.sol)
/// bang lop messaging THAT da duoc audit: Chainlink CCIP. Deploy 1 instance moi chain,
/// moi cap chain phai duoc admin whitelist qua `setPeer` truoc khi gui/nhan duoc.
///
/// Luong von: initiateTransfer() rut idle+strategy asset khoi StrategyManager (chain
/// nguon) qua CROSS_CHAIN_ROLE, roi giao token cho CCIP Router. _ccipReceive() (chain
/// dich) nhan token CCIP da chuyen thang vao contract nay, roi thu deposit lai vao
/// StrategyManager dich.
///
/// Trust assumption (khac SimpleBridge Milestone 6.1): khong con 1 relayer EOA duoc admin
/// cap quyen thu cong - viec xac minh finality/chuyen tin nhan do mang luoi Chainlink DON
/// (Decentralized Oracle Network) dam nhiem, cung co che dang bao ve hang ty USD TVL
/// thuc te tren nhieu giao thuc DeFi khac - day chinh la ly do PLAN.md GD6 §4 dat day la
/// "giai phap messaging da duoc audit" thay the buoc hoc tap Milestone 6.1.
contract CrossChainExecutor is CCIPReceiver, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Quyen goi initiateTransfer - chi grant cho CrossChainTimelock (xem
    /// CrossChainTimelock.sol), KHONG grant truc tiep cho EOA/Keeper nao, de moi lan
    /// chuyen von cross-chain deu phai qua cua so huy cong khai truoc.
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    /// @notice Gas limit danh cho _ccipReceive() o chain dich - Chainlink tinh phi CCIP
    /// dua tren gia tri nay, qua thap se khien message khong bao gio thuc thi duoc o dich.
    uint256 public constant CCIP_GAS_LIMIT = 400_000;

    StrategyManager public immutable strategyManager;
    IERC20 public immutable asset;

    /// @notice destinationChainSelector => dia chi CrossChainExecutor duoc tin tuong tren
    /// chain do. Bat buoc phai set truoc khi gui/nhan - chan hoan toan gia mao tu 1
    /// contract khong lien quan tren 1 chain khac gia danh la "peer" that.
    mapping(uint64 => address) public peers;

    /// @notice Message CCIP da toi noi nhung xu ly deposit lai vao StrategyManager that
    /// bai (vd. strategy dich dang bi pause). Token van nam AN TOAN trong contract nay
    /// (khong bi mat) cho toi khi retry thanh cong hoac admin rescue thu cong - day la
    /// "duong rut lui" PLAN.md GD6 §4/§9 yeu cau, ap dung dung pattern phong thu chinh
    /// thuc cua Chainlink CCIP (khong revert trong _ccipReceive de tranh ket message o
    /// tang CCIP - tu giu quyen kiem soat/retry o tang ung dung thay vi phai cho "Manual
    /// Execution" tu Chainlink Explorer).
    struct FailedMessage {
        uint256 amount;
        bool recovered;
    }
    mapping(bytes32 => FailedMessage) public failedMessages;

    event PeerSet(uint64 indexed chainSelector, address indexed executorAddress);
    event TransferInitiated(
        bytes32 indexed messageId, uint64 indexed destinationChainSelector, uint256 amount, uint256 fee
    );
    event TransferReceived(bytes32 indexed messageId, uint64 indexed sourceChainSelector, uint256 amount);
    event MessageFailed(bytes32 indexed messageId, uint256 amount, bytes reason);
    event MessageRetried(bytes32 indexed messageId);
    event MessageRescued(bytes32 indexed messageId, address indexed to, uint256 amount);

    error UnknownPeer(uint64 chainSelector);
    error UnauthorizedSender(uint64 chainSelector, address sender);
    error InsufficientGasBalance(uint256 required, uint256 available);
    error MessageNotFailed(bytes32 messageId);
    error MessageAlreadyRecovered(bytes32 messageId);
    error NoTokensInMessage();

    constructor(address admin, address router, StrategyManager _strategyManager, IERC20 _asset)
        CCIPReceiver(router)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        strategyManager = _strategyManager;
        asset = _asset;
        // Pre-approve StrategyManager de pull khi depositFromExecutor() duoc goi tu
        // _ccipReceive/retryFailedMessage - toi da 1 lan, khong can approve lai moi lan.
        asset.forceApprove(address(_strategyManager), type(uint256).max);
    }

    /// @dev CCIPReceiver va AccessControl deu implement supportsInterface(bytes4) rieng
    /// (ca 2 deu trace ve IERC165) - Solidity bat buoc override tuong minh khi ke thua
    /// "kim cuong" nhu the nay. KHONG the goi qua super/ten-contract nhu binh thuong vi
    /// CCIPReceiver khai bao ham nay la `pure` con AccessControl khai bao `view` - override
    /// chi duoc phep SIET CHAT mutability (view -> pure), khong duoc noi long (pure ->
    /// view), nen ham gop phai giu `pure` va tu tinh lai logic OR truc tiep bang
    /// interfaceId thay vi goi qua ham `view` cua AccessControl.
    function supportsInterface(bytes4 interfaceId)
        public
        pure
        override(CCIPReceiver, AccessControl)
        returns (bool)
    {
        return interfaceId == type(IAny2EVMMessageReceiver).interfaceId
            || interfaceId == type(IAccessControl).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }

    function setPeer(uint64 chainSelector, address executorAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        peers[chainSelector] = executorAddress;
        emit PeerSet(chainSelector, executorAddress);
    }

    /// @notice Nap gas native de tra phi CCIP - ai cung gui duoc, khong phai lo hong bao
    /// mat (chi la "nap tien" cho hop dong, khong co logic nao dua vao msg.sender o day).
    receive() external payable {}

    /// @notice Rut `amount` khoi StrategyManager chain nay, gui qua CCIP sang
    /// `destinationChainSelector`. Chi EXECUTOR_ROLE (CrossChainTimelock) goi duoc.
    function initiateTransfer(uint64 destinationChainSelector, uint256 amount)
        external
        onlyRole(EXECUTOR_ROLE)
        whenNotPaused
        nonReentrant
        returns (bytes32 messageId)
    {
        address peer = peers[destinationChainSelector];
        if (peer == address(0)) revert UnknownPeer(destinationChainSelector);

        // Diem khong quay dau bat dau tu day: sau khi rut khoi StrategyManager, von chi
        // con trong tay contract nay cho toi khi ccipSend() giao no cho CCIP Router.
        strategyManager.withdrawToExecutor(amount, address(this));

        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        tokenAmounts[0] = Client.EVMTokenAmount({token: address(asset), amount: amount});

        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(peer),
            data: "",
            tokenAmounts: tokenAmounts,
            extraArgs: Client._argsToBytes(
                Client.GenericExtraArgsV2({gasLimit: CCIP_GAS_LIMIT, allowOutOfOrderExecution: true})
            ),
            feeToken: address(0) // tra phi bang native currency, khong dung LINK
        });

        IRouterClient router = IRouterClient(getRouter());
        uint256 fee = router.getFee(destinationChainSelector, message);
        if (address(this).balance < fee) revert InsufficientGasBalance(fee, address(this).balance);

        asset.forceApprove(address(router), amount);
        messageId = router.ccipSend{value: fee}(destinationChainSelector, message);

        emit TransferInitiated(messageId, destinationChainSelector, amount, fee);
    }

    /// @dev Goi boi CCIPReceiver.ccipReceive() (da tu kiem tra msg.sender == router qua
    /// modifier onlyRouter - khong can lap lai o day). CO CHU DICH khong revert khi
    /// deposit lai that bai (khac paradigm try/catch thong thuong o StrategyManager) -
    /// neu revert o day, CCIP se coi message that bai va ket lai cho "Manual Execution"
    /// (ngoai tam kiem soat cua contract nay); giu lai token trong contract va tu quan ly
    /// trang thai that bai cho phep retry/rescue chu dong hon.
    function _ccipReceive(Client.Any2EVMMessage memory message) internal override whenNotPaused {
        address sender = abi.decode(message.sender, (address));
        if (peers[message.sourceChainSelector] != sender) {
            revert UnauthorizedSender(message.sourceChainSelector, sender);
        }
        if (message.destTokenAmounts.length == 0) revert NoTokensInMessage();

        uint256 amount = message.destTokenAmounts[0].amount;

        try strategyManager.depositFromExecutor(amount) {
            emit TransferReceived(message.messageId, message.sourceChainSelector, amount);
        } catch (bytes memory reason) {
            failedMessages[message.messageId] = FailedMessage({amount: amount, recovered: false});
            emit MessageFailed(message.messageId, amount, reason);
        }
    }

    /// @notice Thu deposit lai 1 message da that bai - dung khi nguyen nhan tam thoi (vd.
    /// strategy dich tam pause) da duoc go bo. Permissionless (giong executeRebalance cua
    /// RebalanceTimelock) - khong can quyen dac biet de "sua" 1 loi da xac nhan.
    /// Slither bao reentrancy-no-eth (Medium): `failed.recovered = false` ghi SAU external
    /// call `depositFromExecutor` trong nhanh catch. Danh gia ky: false positive, khong
    /// phai bo qua canh bao - (1) `nonReentrant` da chan moi lan goi lai vao chinh ham nay
    /// hoac bat ky ham nonReentrant nao khac cua CHINH contract nay trong luc dang thuc thi
    /// (initiateTransfer/rescueFailedMessage deu nonReentrant); (2) ke ca khong co
    /// nonReentrant, `failed.recovered = true` da duoc ghi TRUOC external call (dung CEI
    /// cho invariant quan trong nhat: khong bao gio "recover" 2 lan cung 1 message) - 1 lan
    /// goi lai (qua strategy doc hai) trong luc dang cho ket qua se thay `recovered == true`
    /// va tu dong bi chan boi chinh check o dau ham. Dong ghi `false` chi xay ra SAU khi
    /// external call da hoan tat (thanh cong hoac catch), khong con kha nang interleave nao
    /// trong cung 1 call frame EVM.
    // slither-disable-next-line reentrancy-no-eth
    function retryFailedMessage(bytes32 messageId) external nonReentrant {
        FailedMessage storage failed = failedMessages[messageId];
        if (failed.amount == 0) revert MessageNotFailed(messageId);
        if (failed.recovered) revert MessageAlreadyRecovered(messageId);

        uint256 amount = failed.amount;
        failed.recovered = true;
        try strategyManager.depositFromExecutor(amount) {
            emit MessageRetried(messageId);
        } catch (bytes memory reason) {
            failed.recovered = false;
            emit MessageFailed(messageId, amount, reason);
        }
    }

    /// @notice Duong rut lui cuoi cung (PLAN.md GD6 §4/§9 - "co duong rut lui khi bridge
    /// that bai giua chung"): admin/Safe multisig gui thang token bi ket ve 1 dia chi bat
    /// ky (vd. ve chinh Safe de xu ly thu cong) khi retry nhieu lan van khong thanh cong.
    /// Day KHONG phai "gui lai ve chain nguon" (that khong the lam duoc mot khi CCIP da
    /// nhan custody - xem NatSpec dau file) ma la thu hoi tai cho tren chinh chain dich.
    function rescueFailedMessage(bytes32 messageId, address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        FailedMessage storage failed = failedMessages[messageId];
        if (failed.amount == 0) revert MessageNotFailed(messageId);
        if (failed.recovered) revert MessageAlreadyRecovered(messageId);

        uint256 amount = failed.amount;
        failed.recovered = true;
        asset.safeTransfer(to, amount);
        emit MessageRescued(messageId, to, amount);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
