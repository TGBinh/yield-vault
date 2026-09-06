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
/// @notice Ve _decimalsOffset() (ERC-4626 inflation/donation attack): co y GIU MAC DINH
/// (offset = 0) cua OZ 5.x thay vi override tra ve mot gia tri duong.
/// Ly do: OZ 5.x da co san bao ve co ban bang virtual shares/assets (+1) ngay ca voi
/// offset = 0, va threat model thuc te cua vault nay lam giam dang ke rui ro tan cong
/// lam phat share - strategy duoc whitelist thu cong (khong permissionless), asset
/// token co dinh (khong cho phep donate token la, tu do dinh gia sai), va deployment
/// dau tien thuong di kem seed deposit tu chinh team truoc khi mo cho nguoi dung.
/// Da thu nghiem override _decimalsOffset() = 3 (khuyen nghi pho bien cua OZ) nhung
/// bi loai bo: no lam decimals() cua share token doi tu 6 (theo USDC) thanh 9, thay doi
/// interface cong khai ma frontend/indexer/backend dang gia dinh khop voi USDC decimals -
/// day la thay doi xuyen suot he thong, khong an toan de lam rieng le trong 1 patch nay.
/// Danh gia: giu mac dinh la lua chon co chu dich, khong phai bi bo sot.
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
