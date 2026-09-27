// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TokenFaucet} from "../src/TokenFaucet.sol";
import {MockToken} from "./mocks/Tokens.sol";

/// @dev Models successful and premature actions across two pools and four independent callers.
contract FaucetHandler is Test {
    uint256 public constant INITIAL_BALANCE = 1e24;
    TokenFaucet public immutable faucet;
    MockToken[2] public tokens;
    address[4] public actors = [address(1001), address(1002), address(1003), address(1004)];
    uint256[2] public totalDonated;
    uint256[2] public totalDirect;
    uint256[2] public totalClaimed;
    uint256[4][2] public donated;
    uint256[4][2] public direct;
    uint256[4][2] public paid;
    uint256[4][2] public nextAllowed;

    constructor(TokenFaucet faucet_, MockToken six, MockToken eighteen) {
        faucet = faucet_;
        tokens[0] = six;
        tokens[1] = eighteen;
        for (uint256 t; t < 2; ++t) {
            for (uint256 a; a < 4; ++a) {
                tokens[t].mint(actors[a], INITIAL_BALANCE);
                vm.prank(actors[a]);
                tokens[t].approve(address(faucet), type(uint256).max);
            }
        }
    }

    function donate(uint8 tokenSeed, uint8 actorSeed, uint256 amount) external {
        uint256 t = tokenSeed % 2;
        uint256 a = actorSeed % 4;
        uint256 balance = tokens[t].balanceOf(actors[a]);
        if (balance == 0) return;
        amount = bound(amount, 1, balance);
        vm.prank(actors[a]);
        uint256 received = faucet.donate(address(tokens[t]), amount);
        assertEq(received, amount);
        donated[t][a] += amount;
        totalDonated[t] += amount;
    }

    function directTransfer(uint8 tokenSeed, uint8 actorSeed, uint256 amount) external {
        uint256 t = tokenSeed % 2;
        uint256 a = actorSeed % 4;
        uint256 balance = tokens[t].balanceOf(actors[a]);
        if (balance == 0) return;
        amount = bound(amount, 1, balance);
        vm.prank(actors[a]);
        tokens[t].transfer(address(faucet), amount);
        direct[t][a] += amount;
        totalDirect[t] += amount;
    }

    function claim(uint8 tokenSeed, uint8 actorSeed) external {
        uint256 t = tokenSeed % 2;
        uint256 a = actorSeed % 4;
        uint256 balance = tokens[t].balanceOf(address(faucet));
        if (vm.getBlockTimestamp() < nextAllowed[t][a]) {
            vm.expectRevert(abi.encodeWithSelector(TokenFaucet.CooldownActive.selector, nextAllowed[t][a]));
            vm.prank(actors[a]);
            faucet.claim(address(tokens[t]));
            return;
        }
        if (balance == 0) {
            vm.expectRevert(abi.encodeWithSelector(TokenFaucet.EmptyFaucet.selector, address(tokens[t])));
            vm.prank(actors[a]);
            faucet.claim(address(tokens[t]));
            return;
        }
        uint256 expected = t == 0 ? 100e6 : 100 ether;
        if (balance < expected) expected = balance;
        vm.prank(actors[a]);
        assertEq(faucet.claim(address(tokens[t])), expected);
        totalClaimed[t] += expected;
        paid[t][a] += expected;
        nextAllowed[t][a] = vm.getBlockTimestamp() + 1 days;
    }

    function advanceTime(uint32 elapsed) external {
        vm.warp(vm.getBlockTimestamp() + bound(elapsed, 0, 2 days));
    }
}

contract TokenFaucetInvariantTest is Test {
    TokenFaucet private faucet;
    FaucetHandler private handler;
    MockToken[2] private tokens;

    function setUp() public {
        tokens[0] = new MockToken(6);
        tokens[1] = new MockToken(18);
        faucet = new TokenFaucet(address(tokens[1]));
        handler = new FaucetHandler(faucet, tokens[0], tokens[1]);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = FaucetHandler.donate.selector;
        selectors[1] = FaucetHandler.directTransfer.selector;
        selectors[2] = FaucetHandler.claim.selector;
        selectors[3] = FaucetHandler.advanceTime.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_poolBalancesConserveAllReceiptsAndClaims() public view {
        for (uint256 t; t < 2; ++t) {
            assertEq(
                tokens[t].balanceOf(address(faucet)),
                handler.totalDonated(t) + handler.totalDirect(t) - handler.totalClaimed(t)
            );
            uint256 total = tokens[t].balanceOf(address(faucet));
            for (uint256 a; a < 4; ++a) {
                uint256 balance = tokens[t].balanceOf(handler.actors(a));
                assertEq(
                    balance,
                    handler.INITIAL_BALANCE() + handler.paid(t, a) - handler.donated(t, a) - handler.direct(t, a)
                );
                total += balance;
            }
            assertEq(total, tokens[t].totalSupply());
        }
    }

    function invariant_donorsAndCooldownsMatchIndependentModel() public view {
        for (uint256 t; t < 2; ++t) {
            uint256 expectedCount;
            for (uint256 a; a < 4; ++a) {
                address actor = handler.actors(a);
                uint256 amount = handler.donated(t, a);
                if (amount != 0) ++expectedCount;
                assertEq(faucet.donatedBy(address(tokens[t]), actor), amount);
                assertEq(faucet.nextClaimAt(address(tokens[t]), actor), handler.nextAllowed(t, a));
            }
            address[] memory page = faucet.donors(address(tokens[t]), 0, 100);
            assertEq(page.length, expectedCount);
            assertEq(faucet.donorCount(address(tokens[t])), expectedCount);
            for (uint256 i; i < page.length; ++i) {
                assertGt(faucet.donatedBy(address(tokens[t]), page[i]), 0);
                for (uint256 j = i + 1; j < page.length; ++j) {
                    assertNotEq(page[i], page[j]);
                }
            }
        }
    }
}
