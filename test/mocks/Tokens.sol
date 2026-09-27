// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    uint8 private _precision;
    bool public revertDecimals;

    constructor(uint8 precision) ERC20("Mock", "MOCK") {
        _precision = precision;
    }

    function decimals() public view override returns (uint8) {
        require(!revertDecimals, "decimals unavailable");
        return _precision;
    }

    function setDecimals(uint8 precision) external {
        _precision = precision;
    }

    function setRevertDecimals(bool value) external {
        revertDecimals = value;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract FeeToken is MockToken {
    uint256 public feeBps;

    constructor(uint256 feeBps_) MockToken(18) {
        feeBps = feeBps_;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, amount);
        } else {
            uint256 fee = amount * feeBps / 10_000;
            super._update(from, address(0), fee);
            super._update(from, to, amount - fee);
        }
    }
}

contract FailingToken is MockToken {
    bool public returnFalse;
    bool public revertTransfer;

    constructor() MockToken(18) {}

    function configure(bool falseResult, bool revertCall) external {
        returnFalse = falseResult;
        revertTransfer = revertCall;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(!revertTransfer, "transfer failed");
        super.transfer(to, amount);
        return !returnFalse;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        require(!revertTransfer, "transfer failed");
        super.transferFrom(from, to, amount);
        return !returnFalse;
    }
}

/// @dev Calls back from either transfer method, optionally into a different token's pool.
contract ReentrantToken is MockToken {
    address public target;
    bytes public payload;
    bool public callbackSuccess;
    bytes public callbackResult;
    bool private _inside;

    constructor() MockToken(18) {}

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _callback();
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _callback();
        return super.transferFrom(from, to, amount);
    }

    function _callback() private {
        if (target == address(0) || _inside) return;
        _inside = true;
        (callbackSuccess, callbackResult) = target.call(payload);
        _inside = false;
    }
}

/// @dev Legacy token that does not return a boolean on transfers or approval.
contract NoReturnToken {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
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
