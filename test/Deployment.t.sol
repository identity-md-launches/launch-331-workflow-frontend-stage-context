// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {TokenFaucet} from "../src/TokenFaucet.sol";

/// @dev Models constructor callers and dependency order, not the protocol's policy or admission logic.
contract DeploymentHarness {
    function deploy() external returns (LaunchToken token, TokenFaucet faucet) {
        token = new LaunchToken{salt: bytes32(uint256(1))}();
        faucet = new TokenFaucet{salt: bytes32(uint256(2))}(address(token));
    }
}

contract DeploymentTest is Test {
    function test_factoryDeploymentPreservesEntireSupplyAndConfiguresFaucet() public {
        DeploymentHarness factory = new DeploymentHarness();
        (LaunchToken token, TokenFaucet faucet) = factory.deploy();
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(factory)), 1e27);
        assertEq(token.balanceOf(address(faucet)), 0);
        assertEq(faucet.featuredToken(), address(token));
        _assertRuntime(address(token));
        _assertRuntime(address(faucet));
    }

    function test_applicationConstructorIsNonpayable() public {
        LaunchToken token = new LaunchToken();
        bytes memory initCode = abi.encodePacked(type(TokenFaucet).creationCode, abi.encode(address(token)));
        vm.deal(address(this), 1 ether);
        address deployed;
        assembly ("memory-safe") {
            deployed := create(1, add(initCode, 32), mload(initCode))
        }
        assertEq(deployed, address(0));
        assertEq(address(this).balance, 1 ether);
    }

    function _assertRuntime(address deployed) private view {
        bytes memory runtime = deployed.code;
        assertGt(runtime.length, 0);
        assertLe(runtime.length, 24_576);
        for (uint256 i; i < runtime.length; ++i) {
            uint8 op = uint8(runtime[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
                continue;
            }
            assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff, "forbidden opcode");
        }
    }
}
