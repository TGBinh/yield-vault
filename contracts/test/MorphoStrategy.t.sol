// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MorphoStrategy} from "../src/MorphoStrategy.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IMorpho, MarketParams} from "../src/interfaces/IMorpho.sol";

/// @notice Fork test against real Morpho Blue on Ethereum Sepolia - Morpho Blue is NOT
/// deployed on Arbitrum Sepolia (unlike Aave v3), so this strategy is fork-tested
/// against a different testnet than AaveStrategy. See PLAN.md GĐ3 notes: deploying a
/// vault that actually runs both strategies simultaneously on one live testnet would
/// require Ethereum Sepolia (the only public testnet with both Aave v3 and Morpho Blue).
///
/// Morpho Blue markets are created permissionlessly for any (loanToken, collateralToken,
/// oracle, irm, lltv) combo whose irm/lltv are governance-enabled. On Sepolia, lltv=0 is
/// enabled - a 0% LLTV market allows supply/withdraw but never allows borrowing against
/// collateral, which is exactly the "pure lending" shape this strategy needs (mirrors
/// AaveStrategy: only ever supplies, never borrows). We create our own throwaway market
/// with a self-deployed test token as both loan and collateral asset, since Morpho's
/// public API doesn't even index Sepolia (confirmed via GraphQL: "unsupported chainId"),
/// meaning there's no real established market with real liquidity to test against like
/// Aave's testnet faucet-backed pool.
/// Run with: forge test --match-contract MorphoStrategyForkTest -vvv
contract MorphoStrategyForkTest is Test {
    address constant MORPHO = 0xd011EE229E7459ba1ddd22631eF7bF528d424A14;
    address constant ADAPTIVE_CURVE_IRM = 0x8C5dDCD3F601c91D1BF51c8ec26066010ACAbA7c;

    MorphoStrategy strategy;
    MockUSDC loanToken;
    MockUSDC collateralToken;
    address caller = address(0xCA11EA);

    function setUp() public {
        string memory rpcUrl = vm.envOr(
            "ETH_SEPOLIA_RPC_URL",
            string("https://ethereum-sepolia-rpc.publicnode.com")
        );
        vm.createSelectFork(rpcUrl);

        loanToken = new MockUSDC();
        collateralToken = new MockUSDC();

        strategy = new MorphoStrategy(
            address(loanToken),
            MORPHO,
            caller,
            address(collateralToken),
            address(0), // no oracle needed - lltv=0 means borrowing is never allowed
            ADAPTIVE_CURVE_IRM,
            0
        );

        MarketParams memory params = MarketParams({
            loanToken: address(loanToken),
            collateralToken: address(collateralToken),
            oracle: address(0),
            irm: ADAPTIVE_CURVE_IRM,
            lltv: 0
        });
        IMorpho(MORPHO).createMarket(params);

        loanToken.mint(address(strategy), 1_000 * 10 ** 6);
    }

    function test_depositSuppliesToRealMorphoMarket() public {
        uint256 amount = loanToken.balanceOf(address(strategy));

        vm.prank(caller);
        strategy.deposit(amount);

        assertEq(loanToken.balanceOf(address(strategy)), 0, "loan token should move into Morpho");
        assertApproxEqAbs(strategy.totalAssets(), amount, 2, "totalAssets should mirror the supplied amount");
    }

    function test_withdrawReturnsRealAssetsFromMorpho() public {
        uint256 amount = loanToken.balanceOf(address(strategy));
        vm.prank(caller);
        strategy.deposit(amount);

        address receiver = address(0xB0B);
        vm.prank(caller);
        strategy.withdraw(amount, receiver);

        assertApproxEqAbs(loanToken.balanceOf(receiver), amount, 2, "receiver should get real loan token back");
        assertEq(strategy.totalAssets(), 0, "strategy position should be empty after full withdraw");
    }

    function test_onlyCallerCanDepositOrWithdraw() public {
        uint256 amount = loanToken.balanceOf(address(strategy));

        vm.expectRevert(MorphoStrategy.OnlyCaller.selector);
        strategy.deposit(amount);

        vm.expectRevert(MorphoStrategy.OnlyCaller.selector);
        strategy.withdraw(amount, address(this));
    }
}
