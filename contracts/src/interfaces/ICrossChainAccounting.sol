// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Vault Security Audit (GD6.2 cross-chain review) - Critical-1 fix: giao dien toi
/// gian de StrategyManager doc lai "tong gia tri hien dang nam remote" ma KHONG can import
/// toan bo CrossChainExecutor.sol (tranh phu thuoc vong: CrossChainExecutor da import
/// StrategyManager). Xem StrategyManager.totalAssets() va CrossChainExecutor.totalRemoteAssets().
interface ICrossChainAccounting {
    /// @notice Tong gia tri (don vi asset goc) ma chain nay hien dang "gui remote" o cac
    /// chain khac qua CrossChainExecutor - VAN thuoc ve depositor cua chain nay, chi la
    /// tam thoi khong nam trong StrategyManager/strategy noi bo. PHAI duoc cong vao
    /// totalAssets() cua StrategyManager de gia share KHONG bi sut giam khi von roi chain
    /// (day chinh la lo hong Critical-1 da phat hien: truoc day von roi StrategyManager ma
    /// khong co gi bu lai trong totalAssets(), lam gia share sut that su vinh vien).
    function totalRemoteAssets() external view returns (uint256);
}
