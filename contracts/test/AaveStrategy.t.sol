// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AaveStrategy} from "../src/AaveStrategy.sol";

/// @notice Fork test against real Aave v3 on Arbitrum Sepolia - verifies AaveStrategy
/// actually supplies/withdraws through the real Pool contract, not just a mock.
/// Run with: forge test --match-contract AaveStrategyForkTest -vvv
contract AaveStrategyForkTest is Test {
    // Real Aave v3 Arbitrum Sepolia addresses (bgd-labs/aave-address-book).
    address constant AAVE_POOL = 0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff;
    address constant USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    address constant A_USDC = 0x460b97BD498E1157530AEb3086301d5225b91216;

    AaveStrategy strategy;
    address caller = address(0xCA11EA);

    function setUp() public {
        string memory rpcUrl = vm.envOr(
            "ARBITRUM_SEPOLIA_RPC_URL",
            string("https://sepolia-rollup.arbitrum.io/rpc")
        );
        vm.createSelectFork(rpcUrl);

        strategy = new AaveStrategy(USDC, A_USDC, AAVE_POOL, caller);

        // `deal` writes the ERC20 balance storage slot directly - no need to find/impersonate
        // a real USDC whale on testnet, and it's the standard Foundry way to fund test accounts.
        deal(USDC, address(strategy), 1_000 * 10 ** 6);
    }

    function test_depositSuppliesToRealAavePool() public {
        uint256 amount = IERC20(USDC).balanceOf(address(strategy));
        assertGt(amount, 0, "strategy should hold USDC before deposit");

        vm.prank(caller);
        strategy.deposit(amount);

        assertEq(IERC20(USDC).balanceOf(address(strategy)), 0, "USDC should move into Aave");
        assertApproxEqAbs(
            IERC20(A_USDC).balanceOf(address(strategy)),
            amount,
            2, // aToken rounding dust
            "strategy should hold ~equivalent aUSDC after supply"
        );
    }

    function test_totalAssetsTracksATokenBalance() public {
        uint256 amount = IERC20(USDC).balanceOf(address(strategy));
        vm.prank(caller);
        strategy.deposit(amount);

        assertApproxEqAbs(strategy.totalAssets(), amount, 2, "totalAssets should mirror aToken balance");
    }

    function test_withdrawReturnsRealUSDCFromAave() public {
        uint256 amount = IERC20(USDC).balanceOf(address(strategy));
        vm.prank(caller);
        strategy.deposit(amount);

        address receiver = address(0xB0B);
        vm.prank(caller);
        strategy.withdraw(amount, receiver);

        assertApproxEqAbs(IERC20(USDC).balanceOf(receiver), amount, 2, "receiver should get real USDC back");
    }

    function test_onlyCallerCanDepositOrWithdraw() public {
        uint256 amount = IERC20(USDC).balanceOf(address(strategy));

        vm.expectRevert(AaveStrategy.OnlyCaller.selector);
        strategy.deposit(amount);

        vm.expectRevert(AaveStrategy.OnlyCaller.selector);
        strategy.withdraw(amount, address(this));
    }
}
