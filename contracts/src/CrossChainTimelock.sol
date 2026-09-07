// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {CrossChainExecutor} from "./CrossChainExecutor.sol";

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
contract CrossChainTimelock is AccessControl {
    /// @notice Vai tro cua Safe multisig - chi de xuat (queue) va huy (cancel), khong bao
    /// gio duoc thuc thi ngay lap tuc.
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");

    /// @notice Dai hon RebalanceTimelock.MIN_DELAY (24h) vi day la "diem khong quay dau"
    /// that su (khac rebalance noi bo van co the sua bang 1 lan rebalance khac) - can
    /// nhieu thoi gian hon de phat hien sai sot truoc khi thuc thi.
    uint256 public constant MIN_DELAY = 48 hours;

    /// @notice `eta == 0` nghia la khong co de xuat nao dang cho (chua tung queue, hoac
    /// da bi xoa sau khi thuc thi/huy).
    struct QueuedTransfer {
        uint256 eta;
    }

    CrossChainExecutor public immutable executor;

    mapping(bytes32 => QueuedTransfer) public queuedTransfers;

    event TransferQueued(bytes32 indexed id, uint64 indexed destinationChainSelector, uint256 amount, uint256 eta);
    event TransferExecuted(bytes32 indexed id, bytes32 ccipMessageId);
    event TransferCanceled(bytes32 indexed id);

    constructor(address admin, address proposer, CrossChainExecutor _executor) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PROPOSER_ROLE, proposer);
        executor = _executor;
    }

    /// @notice Multisig de xuat 1 lan chuyen von cross-chain moi. Bat dau dem nguoc
    /// `MIN_DELAY` tu day.
    function queueTransfer(uint64 destinationChainSelector, uint256 amount)
        external
        onlyRole(PROPOSER_ROLE)
        returns (bytes32 id)
    {
        id = _transferId(destinationChainSelector, amount);
        require(queuedTransfers[id].eta == 0, "CrossChainTimelock: already queued");

        uint256 eta = block.timestamp + MIN_DELAY;
        queuedTransfers[id] = QueuedTransfer({eta: eta});
        emit TransferQueued(id, destinationChainSelector, amount, eta);
    }

    /// @notice Permissionless sau khi het delay, dung nguyen tac voi RebalanceTimelock
    /// (khong tap trung them quyen o day). Xoa entry TRUOC khi goi ngoai (CEI) va cho
    /// phep requeue lai dung to hop sau nay (vd. lap lai dinh ky) - cung ly do da ap dung
    /// o RebalanceTimelock sau khi vá bug "re-queue-blocked-forever".
    function executeTransfer(uint64 destinationChainSelector, uint256 amount) external {
        bytes32 id = _transferId(destinationChainSelector, amount);
        QueuedTransfer memory entry = queuedTransfers[id];

        require(entry.eta != 0, "CrossChainTimelock: not queued");
        require(block.timestamp >= entry.eta, "CrossChainTimelock: too early");

        delete queuedTransfers[id];
        bytes32 messageId = executor.initiateTransfer(destinationChainSelector, amount);
        emit TransferExecuted(id, messageId);
    }

    /// @notice Multisig huy 1 de xuat truoc khi thuc thi - day la "refund/huy" CO Y NGHIA
    /// DUY NHAT o tang contract nay (xem NatSpec dau file). Xoa entry ngay sau khi huy de
    /// cho phep de xuat lai.
    function cancelTransfer(uint64 destinationChainSelector, uint256 amount) external onlyRole(PROPOSER_ROLE) {
        bytes32 id = _transferId(destinationChainSelector, amount);
        QueuedTransfer memory entry = queuedTransfers[id];

        require(entry.eta != 0, "CrossChainTimelock: not queued");

        delete queuedTransfers[id];
        emit TransferCanceled(id);
    }

    function _transferId(uint64 destinationChainSelector, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encode(destinationChainSelector, amount));
    }
}
