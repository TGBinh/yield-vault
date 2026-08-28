// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IStrategy} from "./interfaces/IStrategy.sol";
import {IStrategyManager} from "./interfaces/IStrategyManager.sol";

/// @notice Giai đoạn 3 — quản lý NHIỀU strategy active đồng thời, phân bổ theo trọng số
/// (basis points). Vault chỉ nói chuyện với StrategyManager, không bao giờ gọi thẳng
/// strategy nào — cho phép thêm/bớt/rebalance strategy mà không cần sửa Vault.
///
/// Nguyên tắc an toàn cốt lõi (Strategy isolation — xem PLAN.md §4): 1 strategy lỗi
/// KHÔNG ĐƯỢC kéo sập cả vault. Cụ thể:
/// - `withdraw()` bọc try/catch quanh từng strategy: nếu 1 strategy revert (bị pause,
///   hết thanh khoản...), bỏ qua và rút tiếp từ strategy khác — chỉ revert nếu tổng số
///   rút được từ TẤT CẢ strategy + idle balance vẫn không đủ `amount` yêu cầu.
/// - `deposit()` KHÔNG bọc try/catch, vì asset đã được transfer vào strategy trước khi
///   gọi `deposit()` (theo hợp đồng IStrategy) — nếu bọc try/catch mà không rollback được
///   transfer đó, tiền sẽ bị kẹt "vô hình" tại strategy lỗi mà manager không hay biết.
///   Chấp nhận đánh đổi: deposit có thể revert nếu 1 strategy trong danh sách bị lỗi,
///   nhưng không bao giờ làm mất tiền — an toàn quan trọng hơn tiện lợi.
contract StrategyManager is IStrategyManager, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant STRATEGIST_ROLE = keccak256("STRATEGIST_ROLE");
    uint16 public constant BPS_DENOMINATOR = 10_000;

    error OnlyVault();
    error UnknownStrategy();
    error NoActiveStrategy();
    error InsufficientLiquidity();
    error LengthMismatch();
    error WeightSumMismatch();
    error ZeroAddress();

    IERC20 public immutable assetToken;
    address public immutable vault;

    mapping(address => bool) public isRegisteredStrategy;
    address[] public registeredStrategies;

    address[] public activeStrategies;
    mapping(address => uint16) public weightBps;

    event StrategyRegistered(address indexed strategy);
    event AllocationsUpdated(address[] strategies, uint16[] weightsBps);

    constructor(address _asset, address _vault, address admin) {
        if (_asset == address(0) || _vault == address(0)) revert ZeroAddress();
        assetToken = IERC20(_asset);
        vault = _vault;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(STRATEGIST_ROLE, admin);
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    /// @notice Đăng ký 1 strategy mới (chưa active). Phải đăng ký trước khi có thể đưa
    /// vào danh sách active qua `setAllocations`.
    function registerStrategy(address strategy) external onlyRole(STRATEGIST_ROLE) {
        if (strategy == address(0)) revert ZeroAddress();
        require(!isRegisteredStrategy[strategy], "StrategyManager: already registered");
        isRegisteredStrategy[strategy] = true;
        registeredStrategies.push(strategy);
        emit StrategyRegistered(strategy);
    }

    /// @notice Thay toàn bộ danh sách strategy active + trọng số phân bổ (basis points,
    /// tổng phải đúng 10000). Rút hết vốn khỏi strategy bị loại khỏi danh sách, sau đó
    /// triển khai lại idle balance theo trọng số mới.
    function setAllocations(address[] calldata strategies, uint16[] calldata weightsBps)
        external
        onlyRole(STRATEGIST_ROLE)
    {
        if (strategies.length != weightsBps.length) revert LengthMismatch();

        uint256 sum;
        for (uint256 i = 0; i < strategies.length; i++) {
            if (!isRegisteredStrategy[strategies[i]]) revert UnknownStrategy();
            sum += weightsBps[i];
        }
        if (sum != BPS_DENOMINATOR) revert WeightSumMismatch();

        // Rút hết vốn khỏi các strategy active cũ (kể cả những cái vẫn còn trong danh
        // sách mới - trọng số của chúng có thể đã đổi, nên rebalance lại từ đầu cho đơn
        // giản và đúng, thay vì tính delta phức tạp).
        // Slither báo reentrancy-no-eth (activeStrategies bị xoá/ghi lại sau external
        // call) - chấp nhận được: hàm này chỉ STRATEGIST_ROLE (admin tin cậy) gọi được,
        // giống lý do đã ghi ở `withdraw()`.
        for (uint256 i = 0; i < activeStrategies.length; i++) {
            address strategy = activeStrategies[i];
            uint256 amount = IStrategy(strategy).totalAssets();
            if (amount > 0) {
                IStrategy(strategy).withdraw(amount, address(this));
            }
            weightBps[strategy] = 0;
        }
        delete activeStrategies;

        for (uint256 i = 0; i < strategies.length; i++) {
            activeStrategies.push(strategies[i]);
            weightBps[strategies[i]] = weightsBps[i];
        }

        uint256 idle = assetToken.balanceOf(address(this));
        if (idle > 0) {
            _distribute(idle);
        }

        emit AllocationsUpdated(strategies, weightsBps);
    }

    /// @notice Vault đã transfer `amount` asset vào manager trước khi gọi hàm này.
    function deposit(uint256 amount) external onlyVault {
        if (activeStrategies.length == 0) revert NoActiveStrategy();
        _distribute(amount);
    }

    /// @dev Chia `amount` theo trọng số cho các strategy active; strategy cuối nhận phần
    /// dư để không mất mát do làm tròn số nguyên.
    function _distribute(uint256 amount) private {
        uint256 len = activeStrategies.length;
        uint256 distributed;
        for (uint256 i = 0; i < len; i++) {
            address strategy = activeStrategies[i];
            uint256 portion =
                i == len - 1 ? amount - distributed : (amount * weightBps[strategy]) / BPS_DENOMINATOR;
            if (portion == 0) continue;

            distributed += portion;
            assetToken.safeTransfer(strategy, portion);
            IStrategy(strategy).deposit(portion);
        }
    }

    /// @notice Rút `amount` asset về `to`. Ưu tiên idle balance trước, sau đó rút lần
    /// lượt từng strategy active (waterfall theo thứ tự đăng ký) - strategy nào lỗi
    /// (revert khi gọi `totalAssets()`/`withdraw()`) bị bỏ qua, không làm hỏng cả giao
    /// dịch. Chỉ revert nếu tổng rút được từ mọi nguồn vẫn không đủ `amount`.
    /// @dev Slither báo reentrancy-balance (HIGH) - "remaining có thể stale sau external
    /// call". Đánh giá kỹ: đây là false positive thật, không chỉ nhận định chủ quan -
    /// `remaining` là biến local, không phải state; kịch bản tấn công duy nhất khả dĩ là
    /// `to` (contract độc hại) reentrant khi nhận token, nhưng hàm này chỉ gọi được qua
    /// `onlyVault`, và MỌI entrypoint public của Vault (`deposit`/`withdraw`/`redeem`) đã
    /// có `nonReentrant` riêng - reentry qua đường hợp lệ duy nhất đã bị chặn từ tầng
    /// Vault trước khi tới được đây. Suppress có chủ đích, không phải bỏ qua cảnh báo.
    // slither-disable-next-line reentrancy-balance
    function withdraw(uint256 amount, address to) external onlyVault {
        uint256 remaining = amount;

        uint256 idle = assetToken.balanceOf(address(this));
        if (idle > 0) {
            uint256 fromIdle = idle < remaining ? idle : remaining;
            assetToken.safeTransfer(to, fromIdle);
            remaining -= fromIdle;
        }

        uint256 len = activeStrategies.length;
        for (uint256 i = 0; i < len && remaining > 0; i++) {
            address strategy = activeStrategies[i];

            uint256 available;
            try IStrategy(strategy).totalAssets() returns (uint256 a) {
                available = a;
            } catch {
                continue;
            }
            if (available == 0) continue;

            uint256 portion = available < remaining ? available : remaining;
            try IStrategy(strategy).withdraw(portion, to) {
                remaining -= portion;
            } catch {
                continue;
            }
        }

        if (remaining > 0) revert InsufficientLiquidity();
    }

    /// @notice Tổng giá trị quản lý: idle balance + tổng của mọi strategy active. Bọc
    /// try/catch để 1 strategy lỗi không làm sập luôn view này (Vault.totalAssets() gọi
    /// hàm này liên tục để tính share price).
    function totalAssets() external view returns (uint256) {
        uint256 total = assetToken.balanceOf(address(this));
        uint256 len = activeStrategies.length;
        for (uint256 i = 0; i < len; i++) {
            try IStrategy(activeStrategies[i]).totalAssets() returns (uint256 a) {
                total += a;
            } catch {}
        }
        return total;
    }

    function getActiveStrategies() external view returns (address[] memory) {
        return activeStrategies;
    }
}
