// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPendleRouter, IPPrincipalToken, TokenInput, TokenOutput, ApproxParams, LimitOrderData} from "../interfaces/IPendle.sol";

/// @notice Mock PT token cho unit test PendleStrategy - KHÔNG dùng ngoài test. Không có
/// fork test thật cho Pendle (xem giải thích trong PendleStrategy.sol), nên mock này
/// verify PendleStrategy gọi router đúng tham số/đúng thứ tự approve, không verify được
/// hành vi thật của Pendle protocol.
contract MockPT is ERC20, IPPrincipalToken {
    bool public forceExpired;

    constructor() ERC20("Mock PT", "mPT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function setExpired(bool value) external {
        forceExpired = value;
    }

    function expiry() external pure returns (uint256) {
        return 0;
    }

    function isExpired() external view returns (bool) {
        return forceExpired;
    }
}

/// @notice Mock Pendle Router cho unit test - mint PT 1:1 khi swap, trả lại asset 1:1
/// khi redeem (tỷ lệ 1:1 chỉ để test luồng gọi đúng, không mô phỏng cơ chế chiết khấu/
/// AMM thật của Pendle).
contract MockPendleRouter is IPendleRouter {
    using SafeERC20 for IERC20;

    MockPT public immutable pt;

    constructor(address _pt) {
        pt = MockPT(_pt);
    }

    function swapExactTokenForPt(
        address receiver,
        address,
        uint256,
        ApproxParams calldata,
        TokenInput calldata input,
        LimitOrderData calldata
    ) external payable returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm) {
        IERC20(input.tokenIn).safeTransferFrom(msg.sender, address(this), input.netTokenIn);
        pt.mint(receiver, input.netTokenIn);
        return (input.netTokenIn, 0, 0);
    }

    function redeemPyToToken(address receiver, address, uint256 netPyIn, TokenOutput calldata output)
        external
        returns (uint256 netTokenOut, uint256 netSyInterm)
    {
        IERC20(address(pt)).safeTransferFrom(msg.sender, address(this), netPyIn);
        IERC20(output.tokenOut).safeTransfer(receiver, netPyIn);
        return (netPyIn, 0);
    }
}
