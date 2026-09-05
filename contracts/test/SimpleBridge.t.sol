// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SimpleBridge} from "../src/SimpleBridge.sol";
import {BridgedToken} from "../src/BridgedToken.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice GD6 Milestone 6.1: SimpleBridge la prototype hoc tap - test nay mo phong 2 chain
/// (home: khoa MockUSDC that, remote: mint/burn BridgedToken dai dien) trong cung 1 EVM test,
/// dong vai relayer off-chain bang cach tu tay goi mint()/unlock() sau khi doc event tu ben kia.
/// Trong tam kiem chung: nonce + replay protection (yeu cau DoD §9/§7).
contract SimpleBridgeTest is Test {
    uint256 constant HOME_CHAIN_ID = 31337;
    uint256 constant REMOTE_CHAIN_ID = 84532; // Base Sepolia (gia lap)

    MockUSDC usdc;
    SimpleBridge homeBridge;

    BridgedToken wrapped;
    SimpleBridge remoteBridge;

    address admin = address(0xAD417);
    address relayer = address(0xE1A7);
    address user = address(0xB0B);

    function setUp() public {
        usdc = new MockUSDC();
        homeBridge = new SimpleBridge(admin, IERC20(address(usdc)), BridgedToken(address(0)), HOME_CHAIN_ID);

        wrapped = new BridgedToken("Bridged USDC", "bUSDC", admin);
        remoteBridge = new SimpleBridge(admin, IERC20(address(0)), wrapped, REMOTE_CHAIN_ID);

        vm.startPrank(admin);
        homeBridge.grantRole(homeBridge.RELAYER_ROLE(), relayer);
        remoteBridge.grantRole(remoteBridge.RELAYER_ROLE(), relayer);
        wrapped.grantRole(wrapped.MINTER_ROLE(), address(remoteBridge));
        vm.stopPrank();

        usdc.mint(user, 1_000 * 10 ** 6);
    }

    function test_lockThenRelayerMintsOnRemoteSide() public {
        uint256 amount = 100 * 10 ** 6;

        vm.startPrank(user);
        usdc.approve(address(homeBridge), amount);
        homeBridge.lock(amount, user, REMOTE_CHAIN_ID);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(homeBridge)), amount, "locked USDC should sit in home bridge");

        // Relayer da thay Locked(nonce=0, ...) tren home chain -> mint tren remote chain.
        vm.prank(relayer);
        remoteBridge.mint(HOME_CHAIN_ID, 0, user, amount);

        assertEq(wrapped.balanceOf(user), amount, "user should receive wrapped token on remote side");
    }

    function test_replayedMintIsRejected() public {
        uint256 amount = 50 * 10 ** 6;

        vm.startPrank(user);
        usdc.approve(address(homeBridge), amount);
        homeBridge.lock(amount, user, REMOTE_CHAIN_ID);
        vm.stopPrank();

        vm.prank(relayer);
        remoteBridge.mint(HOME_CHAIN_ID, 0, user, amount);
        assertEq(wrapped.balanceOf(user), amount);

        // Ke tan cong (hoac relayer bi loi) co tinh goi lai chinh xac message do lan 2.
        vm.prank(relayer);
        vm.expectRevert("SimpleBridge: message already processed");
        remoteBridge.mint(HOME_CHAIN_ID, 0, user, amount);

        assertEq(wrapped.balanceOf(user), amount, "balance must not double from a replayed message");
    }

    function test_burnForUnlockRoundTrip() public {
        uint256 amount = 100 * 10 ** 6;

        vm.startPrank(user);
        usdc.approve(address(homeBridge), amount);
        homeBridge.lock(amount, user, REMOTE_CHAIN_ID);
        vm.stopPrank();

        vm.prank(relayer);
        remoteBridge.mint(HOME_CHAIN_ID, 0, user, amount);

        // Nguoi dung dot wrapped token tren remote chain de rut lai USDC that o home chain.
        vm.prank(user);
        remoteBridge.burnForUnlock(amount, user, HOME_CHAIN_ID);
        assertEq(wrapped.balanceOf(user), 0, "wrapped token should be burned");

        uint256 usdcBefore = usdc.balanceOf(user);
        vm.prank(relayer);
        homeBridge.unlock(REMOTE_CHAIN_ID, 0, user, amount);

        assertEq(usdc.balanceOf(user), usdcBefore + amount, "user should get real USDC back");
        assertEq(usdc.balanceOf(address(homeBridge)), 0, "home bridge should have released all locked funds");
    }

    function test_replayedUnlockIsRejected() public {
        uint256 amount = 100 * 10 ** 6;

        vm.startPrank(user);
        usdc.approve(address(homeBridge), amount);
        homeBridge.lock(amount, user, REMOTE_CHAIN_ID);
        vm.stopPrank();

        vm.prank(relayer);
        remoteBridge.mint(HOME_CHAIN_ID, 0, user, amount);

        vm.prank(user);
        remoteBridge.burnForUnlock(amount, user, HOME_CHAIN_ID);

        vm.prank(relayer);
        homeBridge.unlock(REMOTE_CHAIN_ID, 0, user, amount);

        vm.prank(relayer);
        vm.expectRevert("SimpleBridge: message already processed");
        homeBridge.unlock(REMOTE_CHAIN_ID, 0, user, amount);
    }

    function test_onlyRelayerCanMint() public {
        vm.startPrank(user);
        usdc.approve(address(homeBridge), 10 * 10 ** 6);
        homeBridge.lock(10 * 10 ** 6, user, REMOTE_CHAIN_ID);
        vm.stopPrank();

        vm.prank(user);
        vm.expectRevert();
        remoteBridge.mint(HOME_CHAIN_ID, 0, user, 10 * 10 ** 6);
    }

    function test_lockRevertsOnHomeSideIfWrongDeploymentMode() public {
        // remoteBridge khong co lockedToken (wrapped-only deployment) -> lock() phai revert.
        vm.prank(user);
        vm.expectRevert("SimpleBridge: lock not supported on this deployment");
        remoteBridge.lock(1, user, HOME_CHAIN_ID);
    }

    function test_pausedBridgeRejectsLock() public {
        vm.prank(admin);
        homeBridge.pause();

        vm.startPrank(user);
        usdc.approve(address(homeBridge), 10 * 10 ** 6);
        vm.expectRevert();
        homeBridge.lock(10 * 10 ** 6, user, REMOTE_CHAIN_ID);
        vm.stopPrank();
    }

    function test_differentNoncesFromSameSourceChainAreIndependent() public {
        vm.startPrank(user);
        usdc.approve(address(homeBridge), 200 * 10 ** 6);
        homeBridge.lock(100 * 10 ** 6, user, REMOTE_CHAIN_ID); // nonce 0
        homeBridge.lock(100 * 10 ** 6, user, REMOTE_CHAIN_ID); // nonce 1
        vm.stopPrank();

        vm.startPrank(relayer);
        remoteBridge.mint(HOME_CHAIN_ID, 0, user, 100 * 10 ** 6);
        remoteBridge.mint(HOME_CHAIN_ID, 1, user, 100 * 10 ** 6);
        vm.stopPrank();

        assertEq(wrapped.balanceOf(user), 200 * 10 ** 6, "both distinct nonces should be honored");
    }

    function test_constructorRejectsBothOrNeitherTokenSet() public {
        vm.expectRevert("SimpleBridge: set exactly one of lockedToken/wrappedToken");
        new SimpleBridge(admin, IERC20(address(0)), BridgedToken(address(0)), HOME_CHAIN_ID);

        vm.expectRevert("SimpleBridge: set exactly one of lockedToken/wrappedToken");
        new SimpleBridge(admin, IERC20(address(usdc)), wrapped, HOME_CHAIN_ID);
    }
}
