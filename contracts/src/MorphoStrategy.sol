// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategy} from "./interfaces/IStrategy.sol";
import {IMorpho, MarketParams, Market} from "./interfaces/IMorpho.sol";

/// @notice Giai đoạn 3 — Strategy thật thứ 2: supply/withdraw asset vào 1 market cụ thể
/// trên Morpho Blue (identified bởi `MarketParams` cố định, set 1 lần ở constructor).
/// Chỉ dùng phía "supply" (cho vay) - không bao giờ động tới collateral/borrow.
///
/// Morpho Blue dùng cơ chế share tương tự ERC-4626 nhưng có "virtual shares/assets"
/// offset để chống tấn công lạm phát share ở market mới tạo (share inflation attack) -
/// công thức `toAssets` bên dưới lặp lại đúng logic thật của `SharesMathLib` trong
/// Morpho Blue (VIRTUAL_SHARES = 1e6, VIRTUAL_ASSETS = 1) để totalAssets() phản ánh
/// đúng giá trị strategy có thể rút được, không lệch với hợp đồng thật.
contract MorphoStrategy is IStrategy {
    using SafeERC20 for IERC20;

    error OnlyCaller();
    error ZeroAddress();

    uint256 private constant VIRTUAL_SHARES = 1e6;
    uint256 private constant VIRTUAL_ASSETS = 1;

    IERC20 public immutable assetToken;
    IMorpho public immutable morpho;
    address public immutable caller;

    address public immutable collateralToken;
    address public immutable oracle;
    address public immutable irm;
    uint256 public immutable lltv;
    bytes32 public immutable marketId;

    constructor(
        address _asset,
        address _morpho,
        address _caller,
        address _collateralToken,
        address _oracle,
        address _irm,
        uint256 _lltv
    ) {
        // `_oracle` is deliberately NOT zero-checked: address(0) is a valid, common
        // oracle for lltv=0 markets (borrowing is never allowed, so no price is ever
        // needed) - see the market-creation rationale in MorphoStrategy.t.sol.
        if (
            _asset == address(0) || _morpho == address(0) || _caller == address(0)
                || _collateralToken == address(0) || _irm == address(0)
        ) revert ZeroAddress();
        assetToken = IERC20(_asset);
        morpho = IMorpho(_morpho);
        caller = _caller;
        collateralToken = _collateralToken;
        oracle = _oracle;
        irm = _irm;
        lltv = _lltv;
        marketId = keccak256(abi.encode(_marketParams(_asset, _collateralToken, _oracle, _irm, _lltv)));
    }

    modifier onlyCaller() {
        if (msg.sender != caller) revert OnlyCaller();
        _;
    }

    function _marketParams(
        address _asset,
        address _collateralToken,
        address _oracle,
        address _irm,
        uint256 _lltv
    ) private pure returns (MarketParams memory) {
        return MarketParams({
            loanToken: _asset,
            collateralToken: _collateralToken,
            oracle: _oracle,
            irm: _irm,
            lltv: _lltv
        });
    }

    function _params() private view returns (MarketParams memory) {
        return _marketParams(address(assetToken), collateralToken, oracle, irm, lltv);
    }

    /// @notice StrategyManager đã transfer `amount` asset vào strategy trước khi gọi.
    function deposit(uint256 amount) external onlyCaller {
        assetToken.forceApprove(address(morpho), amount);
        (uint256 assetsSupplied,) = morpho.supply(_params(), amount, 0, address(this), "");
        assert(assetsSupplied == amount);
    }

    function withdraw(uint256 amount, address to) external onlyCaller {
        (uint256 assetsWithdrawn,) = morpho.withdraw(_params(), amount, 0, address(this), to);
        assert(assetsWithdrawn == amount);
    }

    function asset() external view returns (address) {
        return address(assetToken);
    }

    /// @notice Quy đổi supplyShares hiện có sang assets theo đúng công thức Morpho Blue
    /// thật (có virtual shares/assets offset), không dùng tỷ lệ đơn giản 1:1.
    function totalAssets() external view returns (uint256) {
        uint256 shares = morpho.position(marketId, address(this)).supplyShares;
        if (shares == 0) return 0;

        Market memory m = morpho.market(marketId);
        return (shares * (uint256(m.totalSupplyAssets) + VIRTUAL_ASSETS))
            / (uint256(m.totalSupplyShares) + VIRTUAL_SHARES);
    }
}
