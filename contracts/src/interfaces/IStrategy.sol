// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Interface chung cho mọi strategy (Mock, Aave, Morpho, ...).
/// StrategyManager chỉ nói chuyện qua interface này — thêm strategy mới không
/// cần sửa StrategyManager hay Vault.
interface IStrategy {
    /// @notice Được gọi sau khi `amount` asset đã được transfer vào strategy.
    function deposit(uint256 amount) external;

    /// @notice Rút `amount` asset về cho `to`.
    function withdraw(uint256 amount, address to) external;

    /// @notice Tổng giá trị strategy đang nắm giữ (principal + lãi tích luỹ).
    function totalAssets() external view returns (uint256);

    /// @notice Token gốc strategy quản lý.
    function asset() external view returns (address);
}
