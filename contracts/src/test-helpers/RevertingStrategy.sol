// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategy} from "../interfaces/IStrategy.sol";

/// @notice Strategy chỉ dùng cho test - hoạt động bình thường như MockStrategy (giữ tiền
/// thật, deposit/withdraw thật) cho tới khi `setBroken(true)` được gọi, sau đó
/// withdraw()/totalAssets() luôn revert để mô phỏng 1 strategy "chết" sau khi đã nhận
/// vốn (protocol bị pause, hết thanh khoản...). Phục vụ test strategy isolation của
/// StrategyManager (§4 PLAN.md GĐ3: 1 strategy lỗi không được kéo sập cả vault).
/// KHÔNG dùng ngoài test - không có access control vì chỉ chạy trong môi trường test.
contract RevertingStrategy is IStrategy {
    using SafeERC20 for IERC20;

    error AlwaysReverts();

    IERC20 public immutable assetToken;
    uint256 public principal;
    bool public broken;

    constructor(address _asset) {
        assetToken = IERC20(_asset);
    }

    function setBroken(bool value) external {
        broken = value;
    }

    function deposit(uint256 amount) external {
        if (broken) revert AlwaysReverts();
        principal += amount;
    }

    function withdraw(uint256 amount, address to) external {
        if (broken) revert AlwaysReverts();
        principal -= amount;
        assetToken.safeTransfer(to, amount);
    }

    function totalAssets() external view returns (uint256) {
        if (broken) revert AlwaysReverts();
        return principal;
    }

    function asset() external view returns (address) {
        return address(assetToken);
    }
}
