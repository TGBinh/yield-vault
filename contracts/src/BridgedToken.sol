// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice GD6 Milestone 6.1 (hoc tap): token dai dien (wrapped) cho tai san that dang
/// bi khoa o chain nguon bang SimpleBridge. Chi dia chi giu MINTER_ROLE (chinh la
/// SimpleBridge o chain dich) moi duoc mint/burn - nguoi dung khong the tu mint token nay,
/// chi co the nhan duoc qua bridge.
contract BridgedToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor(string memory name_, string memory symbol_, address admin) ERC20(name_, symbol_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(from, amount);
    }
}
