// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategy} from "./interfaces/IStrategy.sol";
import {IAavePool} from "./interfaces/IAavePool.sol";

/// @notice Giai đoạn 2 — Strategy thật đầu tiên: supply/withdraw asset vào Aave v3 Pool.
/// Chỉ StrategyManager (`caller`) được phép gọi deposit/withdraw.
/// aToken là rebasing token 1:1 với giá trị supply + lãi tích luỹ, nên totalAssets()
/// chỉ cần đọc số dư aToken của chính strategy này — không cần tự tính lãi.
contract AaveStrategy is IStrategy {
    using SafeERC20 for IERC20;

    error OnlyCaller();
    error ZeroAddress();
    /// @notice Aave Pool.withdraw() tra ve so luong khac amount yeu cau - day la
    /// hanh vi bat thuong cua protocol ngoai (vi du do nang cap/thay doi logic),
    /// khong phai bug noi bo cua contract nay nen dung custom error thay vi assert().
    error UnexpectedAaveWithdrawAmount();

    IERC20 public immutable assetToken;
    IERC20 public immutable aToken;
    IAavePool public immutable pool;
    address public immutable caller;

    constructor(address _asset, address _aToken, address _pool, address _caller) {
        if (_asset == address(0) || _aToken == address(0) || _pool == address(0) || _caller == address(0)) {
            revert ZeroAddress();
        }
        assetToken = IERC20(_asset);
        aToken = IERC20(_aToken);
        pool = IAavePool(_pool);
        caller = _caller;
    }

    modifier onlyCaller() {
        if (msg.sender != caller) revert OnlyCaller();
        _;
    }

    /// @notice StrategyManager đã transfer `amount` asset vào strategy trước khi gọi.
    function deposit(uint256 amount) external onlyCaller {
        assetToken.forceApprove(address(pool), amount);
        pool.supply(address(assetToken), amount, address(this), 0);
    }

    function withdraw(uint256 amount, address to) external onlyCaller {
        uint256 withdrawn = pool.withdraw(address(assetToken), amount, to);
        if (withdrawn != amount) revert UnexpectedAaveWithdrawAmount();
    }

    function asset() external view returns (address) {
        return address(assetToken);
    }

    /// @notice aToken rebase theo lãi Aave — số dư aToken chính là tổng giá trị nắm giữ.
    function totalAssets() external view returns (uint256) {
        return aToken.balanceOf(address(this));
    }
}
