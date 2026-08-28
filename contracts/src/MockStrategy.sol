// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategy} from "./interfaces/IStrategy.sol";

/// @notice Mock lending strategy dùng cho testing/local/testnet. Mô phỏng lãi suất cố định
/// theo thời gian bằng cách mint thêm mUSDC (chỉ hợp lệ vì MockUSDC là token giả lập).
/// KHÔNG dùng cho production — sẽ được thay bằng AaveStrategy/MorphoStrategy ở Giai đoạn 2-3.
/// @dev `caller` là StrategyManager (không phải Vault trực tiếp) từ GĐ2 trở đi.
contract MockStrategy is IStrategy {
    using SafeERC20 for IERC20;

    error OnlyCaller();
    error ZeroAddress();

    IERC20 public immutable assetToken;
    address public immutable caller;

    /// @dev APR giả lập, đơn vị basis points (500 = 5.00%). Chỉ dùng cho mục đích học tập.
    uint256 public constant MOCK_APR_BPS = 500;
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    uint256 private principal;
    uint256 private lastAccrualTimestamp;

    constructor(address _asset, address _caller) {
        if (_asset == address(0) || _caller == address(0)) revert ZeroAddress();
        assetToken = IERC20(_asset);
        caller = _caller;
        lastAccrualTimestamp = block.timestamp;
    }

    modifier onlyCaller() {
        if (msg.sender != caller) revert OnlyCaller();
        _;
    }

    /// @notice StrategyManager gọi hàm này sau khi đã transfer `amount` asset vào strategy.
    function deposit(uint256 amount) external onlyCaller {
        _accrueYield();
        principal += amount;
    }

    /// @notice Rút `amount` asset về cho `to`. Tự động accrue lãi trước khi rút.
    function withdraw(uint256 amount, address to) external onlyCaller {
        _accrueYield();
        require(amount <= principal, "MockStrategy: insufficient principal");
        principal -= amount;
        assetToken.safeTransfer(to, amount);
    }

    function asset() external view returns (address) {
        return address(assetToken);
    }

    /// @notice Tổng giá trị strategy đang nắm giữ (principal + lãi giả lập chưa "chốt").
    function totalAssets() external view returns (uint256) {
        return principal + _pendingYield();
    }

    function _pendingYield() private view returns (uint256) {
        uint256 elapsed = block.timestamp - lastAccrualTimestamp;
        return (principal * MOCK_APR_BPS * elapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }

    /// @dev "Chốt" lãi giả lập bằng cách mint thêm mUSDC vào chính strategy này.
    /// Slither báo reentrancy-no-eth ở đây (state ghi sau external call) - chấp nhận được vì
    /// `assetToken` (MockUSDC) là contract tự triển khai, standard ERC20 không có hook/callback
    /// nào có thể gọi ngược lại, nên không có đường tấn công tái nhập thực sự.
    function _accrueYield() private {
        uint256 yield = _pendingYield();
        if (yield > 0) {
            (bool ok, ) = address(assetToken).call(
                abi.encodeWithSignature("mint(address,uint256)", address(this), yield)
            );
            require(ok, "MockStrategy: mock yield mint failed");
            principal += yield;
        }
        lastAccrualTimestamp = block.timestamp;
    }
}
