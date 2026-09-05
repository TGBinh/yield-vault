// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {StrategyManager} from "./StrategyManager.sol";

/// @notice Vault Readiness Report - Phase 0 (nghiem trong nhat): trươc day, khi Policy
/// Engine APPROVED va Safe multisig 2-of-3 ky xong, `StrategyManager.setAllocations()`
/// co hieu luc NGAY LAP TUC - khong co khoang tre cong khai de user rut von neu quyet
/// dinh do sai (bug logic, key multisig bi lo, hoac AI loi). Contract nay chen 1 buoc
/// bat buoc o giua: multisig chi duoc `queueRebalance()`, con `executeRebalance()` la
/// permissionless nhung phai cho `MIN_DELAY` sau khi queue.
///
/// Trien khai production PHAI: (1) grant EXECUTOR_ROLE cua StrategyManager cho dia chi
/// cua contract nay, (2) revoke EXECUTOR_ROLE khoi admin/multisig - neu khong lam buoc
/// (2), multisig van co the bo qua Timelock nay va rebalance truc tiep, lam vo hieu toan
/// bo muc dich cua contract. Xem scripts/deploy.ts.
contract RebalanceTimelock is AccessControl {
    /// @notice Vai tro cua Safe multisig - chi duoc de xuat (queue) va huy (cancel),
    /// khong bao gio duoc thuc thi ngay lap tuc.
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");

    /// @notice Khoang tre bat buoc giua queue va execute. 24h la du de user theo doi
    /// dashboard/on-chain event phat hien va rut von neu khong dong y voi rebalance sap toi.
    uint256 public constant MIN_DELAY = 24 hours;

    struct QueuedRebalance {
        uint256 eta;
        bool executed;
        bool canceled;
    }

    StrategyManager public immutable strategyManager;

    mapping(bytes32 => QueuedRebalance) public queuedRebalances;

    event RebalanceQueued(bytes32 indexed id, address[] strategies, uint16[] weightsBps, uint256 eta);
    event RebalanceExecuted(bytes32 indexed id);
    event RebalanceCanceled(bytes32 indexed id);

    constructor(address admin, address proposer, StrategyManager _strategyManager) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PROPOSER_ROLE, proposer);
        strategyManager = _strategyManager;
    }

    /// @notice Multisig de xuat 1 rebalance moi. Bat dau dem nguoc `MIN_DELAY` tu day.
    function queueRebalance(address[] calldata strategies, uint16[] calldata weightsBps)
        external
        onlyRole(PROPOSER_ROLE)
        returns (bytes32 id)
    {
        id = _rebalanceId(strategies, weightsBps);
        require(queuedRebalances[id].eta == 0, "RebalanceTimelock: already queued");

        uint256 eta = block.timestamp + MIN_DELAY;
        queuedRebalances[id] = QueuedRebalance({eta: eta, executed: false, canceled: false});
        emit RebalanceQueued(id, strategies, weightsBps, eta);
    }

    /// @notice Bat ky ai cung goi duoc (permissionless theo dung tinh chat timelock) sau
    /// khi da qua `eta` - khong can multisig ky lan 2, tranh diem tap trung hoa them.
    function executeRebalance(address[] calldata strategies, uint16[] calldata weightsBps) external {
        bytes32 id = _rebalanceId(strategies, weightsBps);
        QueuedRebalance storage entry = queuedRebalances[id];

        require(entry.eta != 0, "RebalanceTimelock: not queued");
        require(!entry.executed, "RebalanceTimelock: already executed");
        require(!entry.canceled, "RebalanceTimelock: canceled");
        require(block.timestamp >= entry.eta, "RebalanceTimelock: too early");

        entry.executed = true;
        strategyManager.setAllocations(strategies, weightsBps);
        emit RebalanceExecuted(id);
    }

    /// @notice Multisig huy 1 de xuat truoc khi thuc thi - dung khi phat hien de xuat sai
    /// hoac khong con phu hop trong luc cho het delay.
    function cancelRebalance(address[] calldata strategies, uint16[] calldata weightsBps)
        external
        onlyRole(PROPOSER_ROLE)
    {
        bytes32 id = _rebalanceId(strategies, weightsBps);
        QueuedRebalance storage entry = queuedRebalances[id];

        require(entry.eta != 0, "RebalanceTimelock: not queued");
        require(!entry.executed, "RebalanceTimelock: already executed");
        require(!entry.canceled, "RebalanceTimelock: already canceled");

        entry.canceled = true;
        emit RebalanceCanceled(id);
    }

    function _rebalanceId(address[] calldata strategies, uint16[] calldata weightsBps)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(strategies, weightsBps));
    }
}
