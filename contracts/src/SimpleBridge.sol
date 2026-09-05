// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BridgedToken} from "./BridgedToken.sol";

/// @notice GD6 Milestone 6.1 - bridge lock/mint tu xay, CHI DE HOC, khong dung cho von
/// that (xem PLAN.md GD6 muc 4). Mo hinh: 1 hop dieu huong duy nhat moi luot deploy -
/// hoac la "home side" (khoa token that, mo khoa khi nhan lenh relayer), hoac la
/// "remote side" (mint/burn token dai dien BridgedToken). Muon bridge 2 chieu giua 2
/// chain thi deploy 1 instance moi vai tro tren moi chain.
///
/// Gia dinh tin cay (trust assumption) CO CHU DICH don gian hoa so voi CCIP/LayerZero:
/// relayer la 1 dia chi duoc admin cap quyen thu cong (RELAYER_ROLE), khong co bang
/// chung mat ma hoc (khong co light client, khong co multi-relayer voting). Day chinh
/// la diem yeu can hoc: neu relayer bi chiem quyen hoac gia mao, toan bo tien bi khoa
/// co the bi rut sai cach. Milestone 6.2 se thay relayer nay bang Chainlink CCIP that.
contract SimpleBridge is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    /// @notice Token that duoc khoa tai day (chi set o "home side"). Zero address o "remote side".
    IERC20 public immutable lockedToken;

    /// @notice Token dai dien duoc mint/burn tai day (chi set o "remote side"). Zero o "home side".
    BridgedToken public immutable wrappedToken;

    /// @notice Chain id cua chinh contract nay - dua vao event de relayer/nguoi xac minh biet nguon.
    uint256 public immutable localChainId;

    /// @notice Bo dem nonce cho cac lenh xuat phat TU chain nay (lock hoac burnForUnlock).
    uint256 public outboundNonce;

    /// @notice Chong replay: keccak256(sourceChainId, sourceNonce) da duoc xu ly hay chua.
    /// Day la co che replay protection cot loi - khong co no, 1 message hop le co the
    /// bi relay lai nhieu lan de rut/mint trung lap.
    mapping(bytes32 => bool) public inboundProcessed;

    event Locked(uint256 indexed nonce, address indexed sender, address recipient, uint256 amount, uint256 destinationChainId);
    event Minted(uint256 indexed sourceChainId, uint256 indexed sourceNonce, address indexed recipient, uint256 amount);
    event Burned(uint256 indexed nonce, address indexed sender, address recipient, uint256 amount, uint256 destinationChainId);
    event Unlocked(uint256 indexed sourceChainId, uint256 indexed sourceNonce, address indexed recipient, uint256 amount);

    constructor(
        address admin,
        IERC20 _lockedToken,
        BridgedToken _wrappedToken,
        uint256 _localChainId
    ) {
        bool hasLockedToken = address(_lockedToken) != address(0);
        bool hasWrappedToken = address(_wrappedToken) != address(0);
        require(hasLockedToken != hasWrappedToken, "SimpleBridge: set exactly one of lockedToken/wrappedToken");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        lockedToken = _lockedToken;
        wrappedToken = _wrappedToken;
        localChainId = _localChainId;
    }

    // ---------------------------------------------------------------------
    // Outbound: nguoi dung tu goi tren chain nguon.
    // ---------------------------------------------------------------------

    /// @notice Khoa token that tai day de "gui" sang chain dich (home side).
    function lock(uint256 amount, address recipient, uint256 destinationChainId) external whenNotPaused nonReentrant {
        require(address(lockedToken) != address(0), "SimpleBridge: lock not supported on this deployment");
        require(amount > 0, "SimpleBridge: zero amount");
        require(recipient != address(0), "SimpleBridge: zero recipient");

        lockedToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Locked(outboundNonce++, msg.sender, recipient, amount, destinationChainId);
    }

    /// @notice Dot token dai dien tai day de "gui tra" ve chain home (remote side).
    function burnForUnlock(uint256 amount, address recipient, uint256 destinationChainId) external whenNotPaused nonReentrant {
        require(address(wrappedToken) != address(0), "SimpleBridge: burn not supported on this deployment");
        require(amount > 0, "SimpleBridge: zero amount");
        require(recipient != address(0), "SimpleBridge: zero recipient");

        wrappedToken.burn(msg.sender, amount);
        emit Burned(outboundNonce++, msg.sender, recipient, amount, destinationChainId);
    }

    // ---------------------------------------------------------------------
    // Inbound: chi relayer duoc goi, sau khi da xac nhan finality o chain nguon.
    // ---------------------------------------------------------------------

    /// @notice Relayer xac nhan da thay 1 su kien Locked o chain nguon -> mint token dai dien.
    function mint(uint256 sourceChainId, uint256 sourceNonce, address recipient, uint256 amount)
        external
        onlyRole(RELAYER_ROLE)
        whenNotPaused
        nonReentrant
    {
        require(address(wrappedToken) != address(0), "SimpleBridge: mint not supported on this deployment");
        bytes32 key = _messageKey(sourceChainId, sourceNonce);
        require(!inboundProcessed[key], "SimpleBridge: message already processed");

        inboundProcessed[key] = true;
        wrappedToken.mint(recipient, amount);
        emit Minted(sourceChainId, sourceNonce, recipient, amount);
    }

    /// @notice Relayer xac nhan da thay 1 su kien Burned o chain dich -> mo khoa token that.
    function unlock(uint256 sourceChainId, uint256 sourceNonce, address recipient, uint256 amount)
        external
        onlyRole(RELAYER_ROLE)
        whenNotPaused
        nonReentrant
    {
        require(address(lockedToken) != address(0), "SimpleBridge: unlock not supported on this deployment");
        bytes32 key = _messageKey(sourceChainId, sourceNonce);
        require(!inboundProcessed[key], "SimpleBridge: message already processed");

        inboundProcessed[key] = true;
        lockedToken.safeTransfer(recipient, amount);
        emit Unlocked(sourceChainId, sourceNonce, recipient, amount);
    }

    function _messageKey(uint256 sourceChainId, uint256 sourceNonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(sourceChainId, sourceNonce));
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
