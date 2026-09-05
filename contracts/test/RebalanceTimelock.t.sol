// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {RebalanceTimelock} from "../src/RebalanceTimelock.sol";
import {StrategyManager} from "../src/StrategyManager.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockStrategy} from "../src/MockStrategy.sol";
import {Vault} from "../src/Vault.sol";

/// @notice Vault Readiness Report - Phase 0: verify khong con cach nao rebalance co hieu
/// luc tuc thi ma khong qua khoang tre cong khai (MIN_DELAY).
contract RebalanceTimelockTest is Test {
    MockUSDC usdc;
    Vault vault;
    StrategyManager manager;
    RebalanceTimelock timelock;
    MockStrategy strategyA;
    MockStrategy strategyB;

    address admin = address(0xAD417);
    address multisig = address(0x54F3);

    function setUp() public {
        usdc = new MockUSDC();
        vault = new Vault(usdc, admin);
        manager = new StrategyManager(address(usdc), address(vault), admin);

        vm.prank(admin);
        vault.setStrategyManager(address(manager));

        strategyA = new MockStrategy(address(usdc), address(manager));
        strategyB = new MockStrategy(address(usdc), address(manager));

        vm.startPrank(admin);
        manager.registerStrategy(address(strategyA));
        manager.registerStrategy(address(strategyB));
        vm.stopPrank();

        timelock = new RebalanceTimelock(admin, multisig, manager);

        // Buoc trien khai production bat buoc: chuyen giao EXECUTOR_ROLE cho Timelock va
        // thu hoi khoi admin - neu bo qua buoc thu hoi, Timelock vo nghia.
        vm.startPrank(admin);
        manager.grantRole(manager.EXECUTOR_ROLE(), address(timelock));
        manager.revokeRole(manager.EXECUTOR_ROLE(), admin);
        vm.stopPrank();
    }

    function _strategies() internal view returns (address[] memory s, uint16[] memory w) {
        s = new address[](2);
        s[0] = address(strategyA);
        s[1] = address(strategyB);
        w = new uint16[](2);
        w[0] = 6_000;
        w[1] = 4_000;
    }

    function test_adminCanNoLongerRebalanceDirectlyAfterRoleTransfer() public {
        (address[] memory s, uint16[] memory w) = _strategies();

        vm.prank(admin);
        vm.expectRevert();
        manager.setAllocations(s, w);
    }

    function test_executeBeforeDelayReverts() public {
        (address[] memory s, uint16[] memory w) = _strategies();

        vm.prank(multisig);
        timelock.queueRebalance(s, w);

        vm.expectRevert("RebalanceTimelock: too early");
        timelock.executeRebalance(s, w);
    }

    function test_executeAfterDelaySucceeds() public {
        (address[] memory s, uint16[] memory w) = _strategies();

        vm.prank(multisig);
        timelock.queueRebalance(s, w);

        vm.warp(block.timestamp + timelock.MIN_DELAY());
        timelock.executeRebalance(s, w); // permissionless: anyone can call after eta

        assertEq(manager.weightBps(address(strategyA)), 6_000);
        assertEq(manager.weightBps(address(strategyB)), 4_000);
    }

    function test_cannotExecuteSameRebalanceTwice() public {
        (address[] memory s, uint16[] memory w) = _strategies();

        vm.prank(multisig);
        timelock.queueRebalance(s, w);
        vm.warp(block.timestamp + timelock.MIN_DELAY());
        timelock.executeRebalance(s, w);

        vm.expectRevert("RebalanceTimelock: already executed");
        timelock.executeRebalance(s, w);
    }

    function test_onlyProposerCanQueue() public {
        (address[] memory s, uint16[] memory w) = _strategies();

        vm.prank(address(0xBAD));
        vm.expectRevert();
        timelock.queueRebalance(s, w);
    }

    function test_canceledRebalanceCannotBeExecuted() public {
        (address[] memory s, uint16[] memory w) = _strategies();

        vm.prank(multisig);
        timelock.queueRebalance(s, w);

        vm.prank(multisig);
        timelock.cancelRebalance(s, w);

        vm.warp(block.timestamp + timelock.MIN_DELAY());
        vm.expectRevert("RebalanceTimelock: canceled");
        timelock.executeRebalance(s, w);
    }

    function test_cannotQueueSameRebalanceTwiceWhilePending() public {
        (address[] memory s, uint16[] memory w) = _strategies();

        vm.prank(multisig);
        timelock.queueRebalance(s, w);

        vm.prank(multisig);
        vm.expectRevert("RebalanceTimelock: already queued");
        timelock.queueRebalance(s, w);
    }

    function test_onlyProposerCanCancel() public {
        (address[] memory s, uint16[] memory w) = _strategies();

        vm.prank(multisig);
        timelock.queueRebalance(s, w);

        vm.prank(address(0xBAD));
        vm.expectRevert();
        timelock.cancelRebalance(s, w);
    }
}
