// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PendleStrategy} from "../src/PendleStrategy.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockPT, MockPendleRouter} from "../src/test-helpers/MockPendle.sol";

/// @notice UNIT test (not a fork test) for PendleStrategy, using a hand-rolled mock
/// router/PT that mimics the real Pendle interface shape. See PLAN.md GĐ3: no genuine
/// public testnet Pendle market sharing this vault's asset (USDC) was found, so unlike
/// AaveStrategy/MorphoStrategy this cannot be verified against the real protocol yet.
/// This test verifies PendleStrategy encodes/calls the real Pendle interface correctly
/// (struct shapes, approval-before-transferFrom ordering, maturity gating) - it does
/// NOT verify real Pendle protocol behavior (AMM pricing, actual PT discount, etc).
contract PendleStrategyTest is Test {
    PendleStrategy strategy;
    MockUSDC asset;
    MockPT pt;
    MockPendleRouter router;
    address caller = address(0xCA11EA);
    address constant MARKET = address(0x111A2E);
    address constant YT = address(0x111A2F);

    function setUp() public {
        asset = new MockUSDC();
        pt = new MockPT();
        router = new MockPendleRouter(address(pt));

        strategy = new PendleStrategy(address(asset), address(router), MARKET, YT, address(pt), caller);

        asset.mint(address(strategy), 1_000 * 10 ** 6);
    }

    function test_depositBuysPtViaRouter() public {
        uint256 amount = asset.balanceOf(address(strategy));

        vm.prank(caller);
        strategy.deposit(amount);

        assertEq(asset.balanceOf(address(strategy)), 0, "asset should move into the router");
        assertEq(pt.balanceOf(address(strategy)), amount, "strategy should hold PT 1:1 (mock rate)");
        assertEq(strategy.totalAssets(), amount, "totalAssets should read the PT balance");
    }

    function test_withdrawRevertsBeforeMaturity() public {
        uint256 amount = asset.balanceOf(address(strategy));
        vm.prank(caller);
        strategy.deposit(amount);

        vm.prank(caller);
        vm.expectRevert(PendleStrategy.NotMaturedYet.selector);
        strategy.withdraw(amount, address(this));
    }

    function test_withdrawRedeemsPtAfterMaturity() public {
        uint256 amount = asset.balanceOf(address(strategy));
        vm.prank(caller);
        strategy.deposit(amount);

        pt.setExpired(true);

        address receiver = address(0xB0B);
        vm.prank(caller);
        strategy.withdraw(amount, receiver);

        assertEq(asset.balanceOf(receiver), amount, "receiver should get asset back after maturity redeem");
        assertEq(pt.balanceOf(address(strategy)), 0, "PT should be fully redeemed");
    }

    function test_onlyCallerCanDepositOrWithdraw() public {
        uint256 amount = asset.balanceOf(address(strategy));

        vm.expectRevert(PendleStrategy.OnlyCaller.selector);
        strategy.deposit(amount);

        vm.expectRevert(PendleStrategy.OnlyCaller.selector);
        strategy.withdraw(amount, address(this));
    }
}
