// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategy} from "./interfaces/IStrategy.sol";
import {
    IPendleRouter,
    IPPrincipalToken,
    TokenInput,
    TokenOutput,
    ApproxParams,
    LimitOrderData,
    SwapData,
    SwapType
} from "./interfaces/IPendle.sol";

/// @notice Giai đoạn 3 — Strategy thật thứ 3: mua Principal Token (PT) của 1 market
/// Pendle cụ thể (fixed-yield, giữ tới đáo hạn) thay vì lending pool biến động lãi suất
/// như Aave/Morpho.
///
/// KHÁC BIỆT KIẾN TRÚC QUAN TRỌNG so với Aave/Morpho (đọc kỹ trước khi dùng):
/// PT chỉ đáo hạn 1:1 về SY tại đúng ngày `expiry` - trước đó PT giao dịch dưới giá trị
/// gốc trên AMM (chiết khấu phản ánh lãi suất cố định), rút trước hạn đòi hỏi bán PT qua
/// AMM với trượt giá không đảm bảo, không khớp được với chữ ký `withdraw(amount, to)`
/// đơn giản của `IStrategy` (vốn giả định rút đúng `amount` yêu cầu). Vì vậy scope GĐ3
/// này CHỈ hỗ trợ giữ PT tới đáo hạn: `withdraw()` trước hạn sẽ revert
/// `NotMaturedYet` thay vì cố bán non trên AMM. Rút sớm qua AMM (có slippage protection)
/// để dành làm cải tiến sau nếu cần.
/// @dev CHƯA CÓ FORK TEST - xem PLAN.md GĐ3: không tìm được market Pendle thật nào công
/// khai trên testnet dùng cùng asset (USDC) với vault này để fork-test xác thực, khác
/// với AaveStrategy/MorphoStrategy đã fork-test được. Code viết đúng theo interface thật
/// công khai của Pendle nhưng CHƯA được chạy thử với market thật.
contract PendleStrategy is IStrategy {
    using SafeERC20 for IERC20;

    error OnlyCaller();
    error ZeroAddress();
    error NotMaturedYet();

    IERC20 public immutable assetToken;
    IPendleRouter public immutable router;
    address public immutable market;
    address public immutable yt;
    IPPrincipalToken public immutable pt;
    address public immutable caller;

    constructor(address _asset, address _router, address _market, address _yt, address _pt, address _caller) {
        if (
            _asset == address(0) || _router == address(0) || _market == address(0) || _yt == address(0)
                || _pt == address(0) || _caller == address(0)
        ) revert ZeroAddress();
        assetToken = IERC20(_asset);
        router = IPendleRouter(_router);
        market = _market;
        yt = _yt;
        pt = IPPrincipalToken(_pt);
        caller = _caller;
    }

    modifier onlyCaller() {
        if (msg.sender != caller) revert OnlyCaller();
        _;
    }

    /// @notice StrategyManager đã transfer `amount` asset vào strategy trước khi gọi.
    /// Mua PT bằng toàn bộ `amount`, giữ tới đáo hạn.
    function deposit(uint256 amount) external onlyCaller {
        assetToken.forceApprove(address(router), amount);

        TokenInput memory input = TokenInput({
            tokenIn: address(assetToken),
            netTokenIn: amount,
            tokenMintSy: address(assetToken),
            pendleSwap: address(0),
            swapData: SwapData({swapType: SwapType.NONE, extRouter: address(0), extCalldata: "", needScale: false})
        });

        // Approximation on-chain (không dùng Pendle Hosted SDK off-chain) - chấp nhận
        // biên độ mặc định theo khuyến nghị chính thức của Pendle cho việc tính on-chain.
        ApproxParams memory approx =
            ApproxParams({guessMin: 0, guessMax: type(uint256).max, guessOffchain: 0, maxIteration: 256, eps: 1e14});

        // Không set field nào - đúng bằng `createEmptyLimitOrderData()` chính thức của
        // Pendle (không dùng limit order), Slither báo "uninitialized local variable"
        // nhưng đây là giá trị mặc định CÓ CHỦ ĐÍCH, không phải quên khởi tạo.
        LimitOrderData memory limit;

        // minPtOut = 0: KHÔNG có bảo vệ trượt giá ở bản v1 này (chấp nhận rủi ro để giữ
        // đơn giản theo đúng tinh thần PLAN.md "bắt đầu đơn giản, nâng cấp khi cần") -
        // cân nhắc thêm slippage tolerance qua tham số khi Risk Engine (GĐ3 tiếp theo)
        // cần kiểm soát việc này chặt hơn.
        // netPtOut trả về KHÔNG được assert bằng `amount` như Aave/Morpho - PT là 1 token
        // khác, giao dịch chiết khấu so với asset gốc, không bao giờ 1:1.
        router.swapExactTokenForPt(address(this), market, 0, approx, input, limit);
    }

    /// @notice Chỉ rút được SAU khi PT đáo hạn - xem giải thích ở đầu file. `amount` là
    /// số lượng PT muốn redeem (~1:1 với SY tại đáo hạn), không phải số asset tuyệt đối.
    function withdraw(uint256 amount, address to) external onlyCaller {
        if (!pt.isExpired()) revert NotMaturedYet();

        // Router pulls PT via transferFrom during redeemPyToToken, same as it pulls the
        // underlying asset during deposit()'s swapExactTokenForPt - needs approval first.
        IERC20(address(pt)).forceApprove(address(router), amount);

        TokenOutput memory output = TokenOutput({
            tokenOut: address(assetToken),
            minTokenOut: 0,
            tokenRedeemSy: address(assetToken),
            pendleSwap: address(0),
            swapData: SwapData({swapType: SwapType.NONE, extRouter: address(0), extCalldata: "", needScale: false})
        });

        // netTokenOut cũng không assert bằng `amount` - dù PT redeem ~1:1 về SY tại đáo
        // hạn, bước SY→asset cuối có thể lệch vài đơn vị do cách quy đổi của SY cụ thể.
        router.redeemPyToToken(to, yt, amount, output);
    }

    function asset() external view returns (address) {
        return address(assetToken);
    }

    /// @notice Trước đáo hạn: xấp xỉ bằng số dư PT (PT thực tế đang chiết khấu dưới giá
    /// trị này trên AMM - đây là ước lượng LẠC QUAN, không phải giá thị trường thật, vì
    /// đọc giá AMM chính xác cần thêm tích hợp ngoài phạm vi GĐ3 này).
    /// Sau đáo hạn: số dư PT chính là giá trị redeem được (~1:1 với SY/asset).
    function totalAssets() external view returns (uint256) {
        return IERC20(address(pt)).balanceOf(address(this));
    }
}
