// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {CrossChainExecutor} from "./CrossChainExecutor.sol";
import {StrategyManager} from "./StrategyManager.sol";

/// @notice GD6 Milestone 6.2 - cung nguyen tac voi RebalanceTimelock.sol (xem file do)
/// nhung ap dung cho lenh CHUYEN VON QUA CHAIN KHAC thay vi rebalance noi bo. Multisig
/// chi `queueTransfer()`, `executeTransfer()` la permissionless sau `MIN_DELAY`.
///
/// Diem khac biet quan trong voi RebalanceTimelock: "huy" (cancel) o day CHI co y nghia
/// TRUOC khi executeTransfer() duoc goi. Sau khi executeTransfer() goi thanh cong
/// CrossChainExecutor.initiateTransfer() (roi router.ccipSend()), von da roi khoi
/// StrategyManager va nam trong custody cua CCIP - khong con cach nao "huy" tu phia
/// contract nay nua, dung nhu moi bridge/messaging layer that (xem PLAN.md GD6 §3: trust
/// assumption cua CCIP). Vi vay cua so MIN_DELAY 48h (dai hon 24h cua RebalanceTimelock -
/// cross-chain rui ro cao hon) chinh la "co che refund" thuc su duy nhat co the lam duoc
/// o tang nay: cho user/guardian thoi gian phat hien va cancelTransfer() TRUOC diem
/// khong quay dau, khong phai rut tien ve SAU khi da gui.
///
/// Vault Security Audit (GD6.2 cross-chain review):
/// - High-1 fix: them GRACE_PERIOD - truoc day 1 de xuat da qua eta co the bi thuc thi
///   VINH VIEN boi bat ky ai, ke ca rat lau sau khi dieu kien (TVL, ly do kinh te) da doi
///   khac han. Qua GRACE_PERIOD ma khong ai executeTransfer, de xuat coi nhu het han, phai
///   queue lai tu dau (qua lai MIN_DELAY).
/// - High-2 fix: them MAX_TRANSFER_BPS kiem tra ONCHAIN (doc truc tiep
///   StrategyManager.totalAssets() that, khong tin bat ky con so nao tu backend/off-chain
///   gui len) tai CA 2 thoi diem queue VA execute - truoc day tran "20% TVL/lan" chi ton
///   tai o backend Policy Engine (PolicyService.evaluateCrossChainTransfer), tinh tu TVL do
///   CHINH nguoi goi tu khai bao trong request - hoan toan co the noi doi, va Safe van co
///   the tu goi thang queueTransfer ma khong can qua Policy Engine. Kiem tra lai o execute
///   (khong chi luc queue) de 1 de xuat cu (TVL da doi khac nhieu do rut tien) khong the
///   vuot tran so voi TVL HIEN TAI.
/// - Ho tro ca 2 chieu: OUTBOUND (gui von CUA depositor chain nay di) va RETURN (tra lai
///   von dang giu ho cho chain khac) - ca 2 deu phai qua CUNG 1 cua so timelock/Safe, chi
///   khac o cho RETURN khong bi ap MAX_TRANSFER_BPS (khong phai von cua depositor chain
///   nay, xem CrossChainExecutor.sol NatSpec).
contract CrossChainTimelock is AccessControl {
    /// @notice Vai tro cua Safe multisig - chi de xuat (queue) va huy (cancel), khong bao
    /// gio duoc thuc thi ngay lap tuc.
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");

    /// @notice Dai hon RebalanceTimelock.MIN_DELAY (24h) vi day la "diem khong quay dau"
    /// that su (khac rebalance noi bo van co the sua bang 1 lan rebalance khac) - can
    /// nhieu thoi gian hon de phat hien sai sot truoc khi thuc thi.
    uint256 public constant MIN_DELAY = 48 hours;

    /// @notice Vault Security Audit High-1: cua so cho phep thuc thi sau khi het MIN_DELAY.
    /// Qua khoi day, de xuat het han - phai queue lai (qua lai du 48h) thay vi bi thuc thi
    /// boi ai do voi dieu kien TVL/kinh te da thay doi tu lau.
    uint256 public constant GRACE_PERIOD = 7 days;

    /// @notice Vault Security Audit High-2: tran %TVL nguon/1 lan chuyen OUTBOUND, kiem tra
    /// ONCHAIN doc that tu StrategyManager.totalAssets() - PHAI khop voi
    /// MAX_CROSSCHAIN_TVL_BPS o backend/src/policy/policy.service.ts (20%), nhung day moi
    /// la kiem tra THAT SU khong the bo qua (backend chi la lop khuyen nghi/UX, khong con
    /// la "gac cong" duy nhat nua).
    uint16 public constant MAX_TRANSFER_BPS = 2_000;
    uint16 private constant BPS_DENOMINATOR = 10_000;

    /// @notice Phan biet lenh gui von CUA depositor chain nay di (OUTBOUND, bi ap tran
    /// %TVL) va lenh tra lai von dang giu ho cho chain khac (RETURN, khong ap tran vi
    /// khong phai von cua depositor chain nay) - xem CrossChainExecutor.sol.
    enum TransferKind {
        OUTBOUND,
        RETURN
    }

    /// @notice `eta == 0` nghia la khong co de xuat nao dang cho (chua tung queue, hoac
    /// da bi xoa sau khi thuc thi/huy/het han).
    struct QueuedTransfer {
        uint256 eta;
    }

    CrossChainExecutor public immutable executor;

    mapping(bytes32 => QueuedTransfer) public queuedTransfers;

    event TransferQueued(
        bytes32 indexed id, uint64 indexed destinationChainSelector, uint256 amount, TransferKind kind, uint256 eta
    );
    event TransferExecuted(bytes32 indexed id, bytes32 ccipMessageId, TransferKind kind);
    event TransferCanceled(bytes32 indexed id);

    error ExceedsTvlCap(uint256 amount, uint256 tvl);
    error ZeroTvl();

    constructor(address admin, address proposer, CrossChainExecutor _executor) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PROPOSER_ROLE, proposer);
        executor = _executor;
    }

    /// @notice Multisig de xuat 1 lan chuyen von cross-chain moi. Bat dau dem nguoc
    /// `MIN_DELAY` tu day. Lenh OUTBOUND bi kiem tra tran %TVL ngay tu buoc nay (fail som,
    /// khong bat Safe cho 48h roi moi biet de xuat vo hieu).
    function queueTransfer(uint64 destinationChainSelector, uint256 amount, TransferKind kind)
        external
        onlyRole(PROPOSER_ROLE)
        returns (bytes32 id)
    {
        if (kind == TransferKind.OUTBOUND) {
            _checkTvlCap(amount);
        }

        id = _transferId(destinationChainSelector, amount, kind);
        require(queuedTransfers[id].eta == 0, "CrossChainTimelock: already queued");

        uint256 eta = block.timestamp + MIN_DELAY;
        queuedTransfers[id] = QueuedTransfer({eta: eta});
        emit TransferQueued(id, destinationChainSelector, amount, kind, eta);
    }

    /// @notice Permissionless sau khi het delay va truoc khi het han, dung nguyen tac voi
    /// RebalanceTimelock (khong tap trung them quyen o day). Xoa entry TRUOC khi goi ngoai
    /// (CEI) va cho phep requeue lai dung to hop sau nay (vd. lap lai dinh ky) - cung ly do
    /// da ap dung o RebalanceTimelock sau khi vá bug "re-queue-blocked-forever". Kiem tra
    /// lai tran %TVL (Vault Security Audit High-1/High-2 ket hop): TVL co the da doi khac
    /// nhieu trong 48h+ cho, 1 de xuat hop le luc queue co the da vuot tran luc execute.
    function executeTransfer(uint64 destinationChainSelector, uint256 amount, TransferKind kind) external {
        bytes32 id = _transferId(destinationChainSelector, amount, kind);
        QueuedTransfer memory entry = queuedTransfers[id];

        require(entry.eta != 0, "CrossChainTimelock: not queued");
        require(block.timestamp >= entry.eta, "CrossChainTimelock: too early");
        require(block.timestamp <= entry.eta + GRACE_PERIOD, "CrossChainTimelock: expired");

        if (kind == TransferKind.OUTBOUND) {
            _checkTvlCap(amount);
        }

        delete queuedTransfers[id];
        bytes32 messageId = kind == TransferKind.OUTBOUND
            ? executor.initiateTransfer(destinationChainSelector, amount)
            : executor.returnHeldFunds(destinationChainSelector, amount);
        emit TransferExecuted(id, messageId, kind);
    }

    /// @notice Multisig huy 1 de xuat truoc khi thuc thi - day la "refund/huy" CO Y NGHIA
    /// DUY NHAT o tang contract nay (xem NatSpec dau file). Xoa entry ngay sau khi huy de
    /// cho phep de xuat lai.
    function cancelTransfer(uint64 destinationChainSelector, uint256 amount, TransferKind kind)
        external
        onlyRole(PROPOSER_ROLE)
    {
        bytes32 id = _transferId(destinationChainSelector, amount, kind);
        QueuedTransfer memory entry = queuedTransfers[id];

        require(entry.eta != 0, "CrossChainTimelock: not queued");

        delete queuedTransfers[id];
        emit TransferCanceled(id);
    }

    function _checkTvlCap(uint256 amount) private view {
        StrategyManager manager = executor.strategyManager();
        uint256 tvl = manager.totalAssets();
        if (tvl == 0) revert ZeroTvl();
        if (amount * BPS_DENOMINATOR > tvl * MAX_TRANSFER_BPS) revert ExceedsTvlCap(amount, tvl);
    }

    function _transferId(uint64 destinationChainSelector, uint256 amount, TransferKind kind)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(destinationChainSelector, amount, kind));
    }
}
