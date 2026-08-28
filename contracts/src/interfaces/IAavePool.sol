// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Interface tối giản của Aave v3 Pool — chỉ 2 hàm strategy cần dùng.
/// Không import trọn gói core Aave để tránh xung đột phiên bản solc/OZ.
interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;

    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}
