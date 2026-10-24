// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface Vm {
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function roll(uint256) external;
    function chainId(uint256) external;
    function expectRevert() external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool) external;
    function deal(address, uint256) external;
    function label(address, string calldata) external;
    function getNonce(address) external returns (uint64);
    function computeCreateAddress(address, uint256) external returns (address);
}

/// @dev Six-decimal ERC20 standing in for USDC in local engine tests. Never a production token.
///      `configure` and `setFrozen` reproduce the two issuer behaviours that matter to escrow
///      custody: a reverting transfer, and a per-account freeze.
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

/// @dev Same shape as USDC but not six decimals: must never be accepted by an escrow.
contract EighteenDecimalUSDC is MockUSDC {
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}

/// @dev Re-enters the escrow from inside the token transfer that pays a credit out.
contract CallbackUSDC is ERC20 {
    address public target;
    bytes public payload;
    bool public blocked;
    bool public armed;

    constructor() ERC20("Callback mock", "cUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configure(address escrow, bytes calldata data) external {
        target = escrow;
        payload = data;
        armed = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (armed) {
            armed = false;
            (bool ok,) = target.call(payload);
            blocked = !ok;
            armed = true;
        }
        return super.transfer(to, amount);
    }
}

/// @dev Token whose Transfer path never returns a value, exercising SafeERC20's tolerance.
contract NoReturnUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
