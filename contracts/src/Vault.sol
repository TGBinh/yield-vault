// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategyManager} from "./interfaces/IStrategyManager.sol";

/// @notice Giai đoạn 2 — Vault ERC-4626 nối với StrategyManager (không gọi thẳng strategy).
/// Multi-strategy allocation sẽ được thêm ở Giai đoạn 3 mà không cần sửa Vault.
///
/// Nguyên tắc an toàn: pause() chỉ chặn deposit/mint (vốn mới vào), KHÔNG BAO GIỜ
/// chặn withdraw/redeem — người dùng luôn có đường rút khẩn cấp (non-custodial).
contract Vault is ERC4626, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    IStrategyManager public strategyManager;

    event StrategyManagerSet(address indexed strategyManager);

    constructor(IERC20 _asset, address admin)
        ERC20("Yield Vault Share", "yvUSDC")
        ERC4626(_asset)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
    }

    /// @notice Gắn StrategyManager cho vault. Chỉ gọi được 1 lần (GĐ2 chưa hỗ trợ migrate).
    function setStrategyManager(address _strategyManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(address(strategyManager) == address(0), "Vault: strategy manager already set");
        require(_strategyManager != address(0), "Vault: zero address");
        strategyManager = IStrategyManager(_strategyManager);
        emit StrategyManagerSet(_strategyManager);
    }

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function totalAssets() public view override returns (uint256) {
        if (address(strategyManager) == address(0)) return 0;
        return strategyManager.totalAssets();
    }

    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256)
    {
        return super.withdraw(assets, receiver, owner_);
    }

    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256)
    {
        return super.redeem(shares, receiver, owner_);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
    {
        super._deposit(caller, receiver, assets, shares);
        IERC20(asset()).safeTransfer(address(strategyManager), assets);
        strategyManager.deposit(assets);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner_,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (caller != owner_) {
            _spendAllowance(owner_, caller, shares);
        }
        _burn(owner_, shares);
        strategyManager.withdraw(assets, receiver);
        emit Withdraw(caller, receiver, owner_, assets, shares);
    }
}
