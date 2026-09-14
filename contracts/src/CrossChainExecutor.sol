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
import {ICrossChainAccounting} from "./interfaces/ICrossChainAccounting.sol";

/// @notice GD6 Milestone 6.2 - thay the SimpleBridge (chi de hoc, xem SimpleBridge.sol)
/// bang lop messaging THAT da duoc audit: Chainlink CCIP. Deploy 1 instance moi chain,
/// moi cap chain phai duoc admin whitelist qua `setPeer` truoc khi gui/nhan duoc.
///
/// Vault Security Audit (GD6.2 cross-chain review) - Critical-1 FIX, thay doi kien truc
/// quan trong nhat: ban dau, moi lan chuyen von = rut that khoi StrategyManager nguon roi
/// deposit thang vao StrategyManager dich - nhung Vault nguon va Vault dich la 2 vault
/// DOC LAP, moi ben co share token/depositor rieng. Ket qua: von "bien mat" khoi ke toan
/// cua depositor nguon (khong burn share) va "tu nhien xuat hien" trong ke toan cua
/// depositor dich (khong mint share) - ai deposit vao vault dich dung luc tien toi roi rut
/// ra ngay co the an trang toan bo so tien chuyen sang, mien phi.
///
/// Fix bang co che "custody, khong commingle": moi CCIP message mang theo 1 co (`data`)
/// phan biet 2 loai:
/// - DEPOSIT: von CUA CHINH depositor chain gui di, lan dau roi khoi chain do. Ben gui
///   tang `remoteAssets[dest]` (van duoc StrategyManager.totalAssets() cong vao - xem
///   totalRemoteAssets() - nen gia share KHONG doi). Ben nhan tang `heldForRemote[source]`
///   va GIU NGUYEN token o dang idle trong chinh contract nay - KHONG bao gio dem vao
///   totalAssets() cua StrategyManager dich, KHONG bao gio duoc `_distribute` vao strategy
///   dich - day chinh la diem chan hoan toan lo hong "depositor dich an chan tien remote".
/// - RETURN: von quay VE nha (chain da tung gui no di truoc do, qua `returnHeldFunds` -
///   duoc goi boi chain dang GIU custody, rut tu `heldForRemote`, KHONG dung
///   `withdrawToExecutor`/StrategyManager vi token da nam san trong contract nay). Ben
///   nhan giam `remoteAssets[source]` VA thuc su tich hop lai vao StrategyManager noi bo
///   (dung `depositFromExecutor`, co the that bai/retry giong luong cu) - luc nay tien MOI
///   thuc su thuoc ve depositor cua chain nhan tro lai.
///
/// Trust assumption (khac SimpleBridge Milestone 6.1): khong con 1 relayer EOA duoc admin
/// cap quyen thu cong - viec xac minh finality/chuyen tin nhan do mang luoi Chainlink DON
/// (Decentralized Oracle Network) dam nhiem, cung co che dang bao ve hang ty USD TVL
/// thuc te tren nhieu giao thuc DeFi khac - day chinh la ly do PLAN.md GD6 §4 dat day la
/// "giai phap messaging da duoc audit" thay the buoc hoc tap Milestone 6.1.
contract CrossChainExecutor is CCIPReceiver, AccessControl, Pausable, ReentrancyGuard, ICrossChainAccounting {
    using SafeERC20 for IERC20;

    /// @notice Loai message CCIP - encode vao `Client.EVM2AnyMessage.data` de _ccipReceive
    /// biet xu ly theo dung nhanh ke toan (xem NatSpec dau file).
    enum CrossChainMessageType {
        DEPOSIT,
        RETURN
    }

    /// @notice Quyen goi initiateTransfer/returnHeldFunds - chi grant cho CrossChainTimelock
    /// (xem CrossChainTimelock.sol), KHONG grant truc tiep cho EOA/Keeper nao, de moi lan
    /// chuyen von cross-chain deu phai qua cua so huy cong khai truoc.
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    /// @notice Gas limit danh cho _ccipReceive() o chain dich - Chainlink tinh phi CCIP
    /// dua tren gia tri nay. Vault Security Audit High-3: KHONG con la constant - 400k
    /// (gia tri cu) chi du cho test dung strategy gia lap (~5k gas), qua thap so voi 1
    /// strategy Aave/Morpho that (~200-250k gas). Admin-tunable de dieu chinh theo so luong
    /// strategy dich thuc te ma khong can redeploy.
    uint256 public ccipGasLimit = 1_500_000;

    /// @notice Gas du tru lai cho nhanh catch (ghi failedMessages + emit event) khi goi
    /// depositFromExecutor - Vault Security Audit High-3: neu khong du tru, EIP-150 (63/64
    /// rule) co the khien nhanh catch khong du gas de ghi state, lam _ccipReceive revert
    /// hoan toan (dung dieu file nay co chu dich tranh - xem NatSpec _ccipReceive).
    uint256 public constant CATCH_GAS_RESERVE = 100_000;

    StrategyManager public immutable strategyManager;
    IERC20 public immutable asset;

    /// @notice destinationChainSelector => dia chi CrossChainExecutor duoc tin tuong tren
    /// chain do. Bat buoc phai set truoc khi gui/nhan - chan hoan toan gia mao tu 1
    /// contract khong lien quan tren 1 chain khac gia danh la "peer" that.
    mapping(uint64 => address) public peers;

    /// @notice chainSelector => gia tri (don vi asset) depositor CUA CHAIN NAY hien dang
    /// "gui remote" o chain do, chua quay ve. Duoc StrategyManager.totalAssets() cong vao
    /// qua totalRemoteAssets() - xem NatSpec dau file.
    mapping(uint64 => uint256) public remoteAssets;
    uint256 private _totalRemoteAssets;

    /// @notice chainSelector => gia tri (don vi asset) contract nay dang GIU HO cho
    /// depositor cua chain do (nhan qua message DEPOSIT). KHONG thuoc so huu cua depositor
    /// chain nay - co tinh KHONG dua vao StrategyManager.totalAssets() cua chain nay, KHONG
    /// bao gio duoc dau tu vao strategy noi bo. Token nam idle trong balance cua chinh
    /// contract nay cho toi khi returnHeldFunds() gui tra lai.
    mapping(uint64 => uint256) public heldForRemote;

    /// @notice Message CCIP loai RETURN da toi noi nhung tich hop lai vao StrategyManager
    /// that bai (vd. strategy dich dang bi pause). Token van nam AN TOAN trong contract nay
    /// (khong bi mat) cho toi khi retry thanh cong hoac admin rescue thu cong. Message loai
    /// DEPOSIT KHONG BAO GIO vao day - do chi la but toan (heldForRemote += amount), khong
    /// co external call nen khong the that bai.
    struct FailedMessage {
        uint256 amount;
        uint64 sourceChainSelector;
        bool recovered;
    }
    mapping(bytes32 => FailedMessage) public failedMessages;

    event PeerSet(uint64 indexed chainSelector, address indexed executorAddress);
    event TransferInitiated(
        bytes32 indexed messageId, uint64 indexed destinationChainSelector, uint256 amount, uint256 fee
    );
    event TransferReturned(
        bytes32 indexed messageId, uint64 indexed destinationChainSelector, uint256 amount, uint256 fee
    );
    event RemoteCustodyReceived(bytes32 indexed messageId, uint64 indexed sourceChainSelector, uint256 amount);
    event TransferReceived(bytes32 indexed messageId, uint64 indexed sourceChainSelector, uint256 amount);
    event MessageFailed(bytes32 indexed messageId, uint256 amount, bytes reason);
    event MessageRetried(bytes32 indexed messageId);
    event MessageRescued(bytes32 indexed messageId, address indexed to, uint256 amount);
    event CcipGasLimitSet(uint256 gasLimit);
    event NativeSwept(address indexed to, uint256 amount);

    error UnknownPeer(uint64 chainSelector);
    error UnauthorizedSender(uint64 chainSelector, address sender);
    error InsufficientGasBalance(uint256 required, uint256 available);
    error MessageNotFailed(bytes32 messageId);
    error MessageAlreadyRecovered(bytes32 messageId);
    error NoTokensInMessage();
    error UnexpectedToken(address token);
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientRemoteHolding(uint64 chainSelector, uint256 requested, uint256 held);

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

    /// @notice ICrossChainAccounting - xem StrategyManager.totalAssets().
    function totalRemoteAssets() external view returns (uint256) {
        return _totalRemoteAssets;
    }

    function setPeer(uint64 chainSelector, address executorAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        peers[chainSelector] = executorAddress;
        emit PeerSet(chainSelector, executorAddress);
    }

    /// @notice Vault Security Audit High-3: gia tri cu (constant 400k) khong du cho
    /// production that voi >=2 strategy dich - cho phep admin dieu chinh khi so luong/loai
    /// strategy dich thay doi, khong can redeploy toan bo executor.
    function setCcipGasLimit(uint256 gasLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        ccipGasLimit = gasLimit;
        emit CcipGasLimitSet(gasLimit);
    }

    /// @notice Nap gas native de tra phi CCIP - ai cung gui duoc, khong phai lo hong bao
    /// mat (chi la "nap tien" cho hop dong, khong co logic nao dua vao msg.sender o day).
    receive() external payable {}

    /// @notice Vault Security Audit Medium-3: phi CCIP tra bang native currency nhung
    /// truoc day KHONG co duong rut ra - nap du/thay executor moi se khoa vinh vien so du
    /// con lai. Chi admin rut duoc, khong anh huong toi tinh nang chinh (initiateTransfer
    /// van tu revert InsufficientGasBalance neu rut qua tay lam thieu phi).
    /// @dev Slither bao arbitrary-send-eth (Medium) - dung, ham nay gui ETH ve dia chi tuy
    /// y - nhung day la hanh vi CO CHU DICH (rut phi CCIP con du ve vi admin/Safe chi
    /// dinh), cung muc do tin cay voi `rescueFailedMessage` (gui ERC20 tuy y, cung
    /// onlyRole(DEFAULT_ADMIN_ROLE)) da duoc chap nhan o tren. Suppress co chu dich, kem
    /// zero-check chan truong hop go go dia chi.
    // slither-disable-next-line arbitrary-send-eth
    function sweepNative(address payable to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{value: amount}("");
        require(ok, "CrossChainExecutor: native sweep failed");
        emit NativeSwept(to, amount);
    }

    /// @notice Rut `amount` khoi StrategyManager chain nay (von CUA depositor chain nay),
    /// gui qua CCIP sang `destinationChainSelector` duoi dang message DEPOSIT. Chi
    /// EXECUTOR_ROLE (CrossChainTimelock) goi duoc.
    function initiateTransfer(uint64 destinationChainSelector, uint256 amount)
        external
        onlyRole(EXECUTOR_ROLE)
        whenNotPaused
        nonReentrant
        returns (bytes32 messageId)
    {
        if (amount == 0) revert ZeroAmount();
        address peer = peers[destinationChainSelector];
        if (peer == address(0)) revert UnknownPeer(destinationChainSelector);

        // Rut khoi StrategyManager, nhung BU LAI ngay bang remoteAssets - tong
        // totalAssets() cua chain nay KHONG doi (xem NatSpec dau file, Critical-1 fix).
        strategyManager.withdrawToExecutor(amount, address(this));
        remoteAssets[destinationChainSelector] += amount;
        _totalRemoteAssets += amount;

        uint256 fee;
        (messageId, fee) = _sendCcip(destinationChainSelector, peer, amount, CrossChainMessageType.DEPOSIT);
        emit TransferInitiated(messageId, destinationChainSelector, amount, fee);
    }

    /// @notice Gui tra `amount` dang GIU HO (heldForRemote) ve dung chain so huu, duoi
    /// dang message RETURN. Token da nam san trong contract nay tu luc nhan DEPOSIT truoc
    /// do - KHONG dung StrategyManager/CROSS_CHAIN_ROLE o day vi day khong phai von cua
    /// depositor chain nay. Chi EXECUTOR_ROLE (CrossChainTimelock) goi duoc - moi lan gui
    /// di deu phai qua cung 1 cua so timelock/Safe, du la gui von cua minh hay tra lai von
    /// cua chain khac.
    function returnHeldFunds(uint64 destinationChainSelector, uint256 amount)
        external
        onlyRole(EXECUTOR_ROLE)
        whenNotPaused
        nonReentrant
        returns (bytes32 messageId)
    {
        if (amount == 0) revert ZeroAmount();
        address peer = peers[destinationChainSelector];
        if (peer == address(0)) revert UnknownPeer(destinationChainSelector);

        uint256 held = heldForRemote[destinationChainSelector];
        if (amount > held) revert InsufficientRemoteHolding(destinationChainSelector, amount, held);
        heldForRemote[destinationChainSelector] = held - amount;

        uint256 fee;
        (messageId, fee) = _sendCcip(destinationChainSelector, peer, amount, CrossChainMessageType.RETURN);
        emit TransferReturned(messageId, destinationChainSelector, amount, fee);
    }

    function _sendCcip(uint64 destinationChainSelector, address peer, uint256 amount, CrossChainMessageType msgType)
        private
        returns (bytes32 messageId, uint256 fee)
    {
        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        tokenAmounts[0] = Client.EVMTokenAmount({token: address(asset), amount: amount});

        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(peer),
            data: abi.encode(msgType),
            tokenAmounts: tokenAmounts,
            extraArgs: Client._argsToBytes(
                Client.GenericExtraArgsV2({gasLimit: ccipGasLimit, allowOutOfOrderExecution: true})
            ),
            feeToken: address(0) // tra phi bang native currency, khong dung LINK
        });

        IRouterClient router = IRouterClient(getRouter());
        fee = router.getFee(destinationChainSelector, message);
        if (address(this).balance < fee) revert InsufficientGasBalance(fee, address(this).balance);

        asset.forceApprove(address(router), amount);
        messageId = router.ccipSend{value: fee}(destinationChainSelector, message);
    }

    /// @dev Goi boi CCIPReceiver.ccipReceive() (da tu kiem tra msg.sender == router qua
    /// modifier onlyRouter - khong can lap lai o day). KHONG con `whenNotPaused` o day
    /// (Vault Security Audit Medium-2: pause tung lam _ccipReceive tu revert, bien chinh
    /// thiet ke "khong ket message o tang CCIP" thanh ket that khi pause dung luc co message
    /// den) - pause() gio chi chan initiateTransfer/returnHeldFunds/retryFailedMessage
    /// (gui di / tich hop lai vao strategy), khong chan viec NHAN/ghi nhan custody.
    function _ccipReceive(Client.Any2EVMMessage memory message) internal override {
        address sender = abi.decode(message.sender, (address));
        if (peers[message.sourceChainSelector] != sender) {
            revert UnauthorizedSender(message.sourceChainSelector, sender);
        }
        // Vault Security Audit Medium-1: truoc day chi doc .amount, bo qua .token hoan
        // toan - 1 peer loi/bi chiem quyen gui nham token khac se bi rut nham tu balance
        // `asset` cua contract nay (co the la tien cua 1 message khac dang ket o
        // failedMessages).
        if (message.destTokenAmounts.length != 1) revert NoTokensInMessage();
        if (message.destTokenAmounts[0].token != address(asset)) {
            revert UnexpectedToken(message.destTokenAmounts[0].token);
        }

        uint256 amount = message.destTokenAmounts[0].amount;
        CrossChainMessageType msgType = abi.decode(message.data, (CrossChainMessageType));

        if (msgType == CrossChainMessageType.DEPOSIT) {
            // Von CUA depositor chain nguon, lan dau roi khoi chain do - CHI ghi nhan
            // custody (but toan don thuan, khong external call, khong the that bai), KHONG
            // bao gio dau tu vao StrategyManager/strategy noi bo cua CHAIN NAY - day chinh
            // la diem chan lo hong Critical-1 (ngan depositor chain nay "an chan" tien cua
            // depositor chain khac qua deposit-roi-rut ngay sau khi tien toi).
            heldForRemote[message.sourceChainSelector] += amount;
            emit RemoteCustodyReceived(message.messageId, message.sourceChainSelector, amount);
            return;
        }

        // RETURN: von quay ve nha - neu dang pause, KHONG thu tich hop vao strategy (co the
        // dang la ly do bi pause), giu an toan trong failedMessages cho retry sau, giong
        // het nhu 1 lan tich hop that bai binh thuong.
        if (paused()) {
            failedMessages[message.messageId] =
                FailedMessage({amount: amount, sourceChainSelector: message.sourceChainSelector, recovered: false});
            emit MessageFailed(message.messageId, amount, bytes("paused"));
            return;
        }

        uint256 gasForDeposit = gasleft() > CATCH_GAS_RESERVE ? gasleft() - CATCH_GAS_RESERVE : 0;
        try strategyManager.depositFromExecutor{gas: gasForDeposit}(amount) {
            _settleRemoteAssets(message.sourceChainSelector, amount);
            emit TransferReceived(message.messageId, message.sourceChainSelector, amount);
        } catch (bytes memory reason) {
            failedMessages[message.messageId] =
                FailedMessage({amount: amount, sourceChainSelector: message.sourceChainSelector, recovered: false});
            emit MessageFailed(message.messageId, amount, reason);
        }
    }

    /// @dev Giam remoteAssets[chain] dung bang phan da tich hop thanh cong tro lai
    /// StrategyManager - chi goi SAU KHI depositFromExecutor thanh cong (o _ccipReceive,
    /// retryFailedMessage) hoac khi admin xac nhan tu bo thu hoi (rescueFailedMessage), KHONG
    /// BAO GIO goi truoc/trong luc cho ket qua external call - neu goi som se lam
    /// totalAssets() tam thoi dem thieu von trong luc message dang o trang thai that bai
    /// cho retry (khong mat an toan, nhung sai lech ke toan khong can thiet).
    function _settleRemoteAssets(uint64 sourceChainSelector, uint256 amount) private {
        uint256 owed = remoteAssets[sourceChainSelector];
        uint256 settleAmount = amount > owed ? owed : amount;
        remoteAssets[sourceChainSelector] = owed - settleAmount;
        _totalRemoteAssets -= settleAmount;
    }

    /// @notice Thu deposit lai 1 message RETURN da that bai - dung khi nguyen nhan tam
    /// thoi (vd. strategy dich tam pause) da duoc go bo. Permissionless (giong
    /// executeRebalance cua RebalanceTimelock) - khong can quyen dac biet de "sua" 1 loi da
    /// xac nhan. `whenNotPaused` MOI (khac ban dau): retry cung goi depositFromExecutor
    /// giong duong chinh, phai chiu cung 1 lenh pause khan cap.
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
    function retryFailedMessage(bytes32 messageId) external whenNotPaused nonReentrant {
        FailedMessage storage failed = failedMessages[messageId];
        if (failed.amount == 0) revert MessageNotFailed(messageId);
        if (failed.recovered) revert MessageAlreadyRecovered(messageId);

        uint256 amount = failed.amount;
        uint64 sourceChainSelector = failed.sourceChainSelector;
        failed.recovered = true;
        try strategyManager.depositFromExecutor(amount) {
            _settleRemoteAssets(sourceChainSelector, amount);
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
    /// Cung giam remoteAssets tuong ung - neu khong, totalAssets() se dem "ao" von da bi
    /// rescue di noi khac, lam gia share bi thoi phong sai vinh vien.
    function rescueFailedMessage(bytes32 messageId, address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        FailedMessage storage failed = failedMessages[messageId];
        if (failed.amount == 0) revert MessageNotFailed(messageId);
        if (failed.recovered) revert MessageAlreadyRecovered(messageId);

        uint256 amount = failed.amount;
        failed.recovered = true;
        _settleRemoteAssets(failed.sourceChainSelector, amount);
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
