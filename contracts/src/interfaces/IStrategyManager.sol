// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Interface Vault dùng để nói chuyện với StrategyManager.
/// Vault KHÔNG BAO GIỜ gọi thẳng 1 strategy cụ thể — mọi truy cập đi qua đây,
/// để multi-strategy (GĐ3) không đòi hỏi sửa Vault.
interface IStrategyManager {
    function deposit(uint256 amount) external;

    function withdraw(uint256 amount, address to) external;

    function totalAssets() external view returns (uint256);
}
