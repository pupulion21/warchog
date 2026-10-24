// SPDX-License-Identifier: MIT
pragma solidity ^0.8.38;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Local EVM acceptance token only; never deployed or used by the public game.
contract MockUSDC is ERC20 {
    bool public failTransfers;
    bool public feeOnTransfer;
    mapping(address => bool) public frozen;

    constructor() ERC20("Local mock USD Coin", "mUSDC") {}

    function decimals() public pure virtual override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configure(bool fail, bool fee) external {
        failTransfers = fail;
        feeOnTransfer = fee;
    }

    function setFrozen(address account, bool value) external {
        frozen[account] = value;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (failTransfers) revert("token paused");
        if (frozen[msg.sender] || frozen[to]) revert("blacklisted");
        if (feeOnTransfer) {
            super.transfer(to, amount - 1);
            return true;
        }
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (failTransfers) revert("token paused");
        if (frozen[from] || frozen[to]) revert("blacklisted");
        if (feeOnTransfer) {
            super.transferFrom(from, to, amount - 1);
            return true;
        }
        return super.transferFrom(from, to, amount);
    }
}

