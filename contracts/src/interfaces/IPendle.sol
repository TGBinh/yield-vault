// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Interface + struct tối giản của Pendle V2 Router - copy chính xác từ repo
/// công khai `pendle-finance/pendle-core-v2-public` (IPAllActionTypeV3.sol,
/// IPActionSwapPTV3.sol, IPActionMiscV3.sol, swap-aggregator/IPSwapAggregator.sol),
/// không import trọn gói `@pendle/core-v2` để tránh xung đột phiên bản solc/OZ.

enum SwapType {
    NONE,
    KYBERSWAP,
    ODOS,
    ETH_WETH,
    OKX,
    ONE_INCH,
    PARASWAP,
    RESERVE_2,
    RESERVE_3,
    RESERVE_4,
    RESERVE_5
}

struct SwapData {
    SwapType swapType;
    address extRouter;
    bytes extCalldata;
    bool needScale;
}

struct TokenInput {
    address tokenIn;
    uint256 netTokenIn;
    address tokenMintSy;
    address pendleSwap;
    SwapData swapData;
}

struct TokenOutput {
    address tokenOut;
    uint256 minTokenOut;
    address tokenRedeemSy;
    address pendleSwap;
    SwapData swapData;
}

struct FillOrderParams {
    // Nội dung chi tiết không cần thiết cho luồng "không dùng limit order" (mảng rỗng).
    bytes placeholder;
}

struct LimitOrderData {
    address limitRouter;
    uint256 epsSkipMarket;
    FillOrderParams[] normalFills;
    FillOrderParams[] flashFills;
    bytes optData;
}

struct ApproxParams {
    uint256 guessMin;
    uint256 guessMax;
    uint256 guessOffchain;
    uint256 maxIteration;
    uint256 eps;
}

interface IPendleRouter {
    function swapExactTokenForPt(
        address receiver,
        address market,
        uint256 minPtOut,
        ApproxParams calldata guessPtOut,
        TokenInput calldata input,
        LimitOrderData calldata limit
    ) external payable returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm);

    function redeemPyToToken(address receiver, address YT, uint256 netPyIn, TokenOutput calldata output)
        external
        returns (uint256 netTokenOut, uint256 netSyInterm);
}

/// @notice Interface tối giản của Pendle Principal Token (PT).
interface IPPrincipalToken {
    function expiry() external view returns (uint256);
    function isExpired() external view returns (bool);
}
