// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {TokenFaucet} from "../src/TokenFaucet.sol";
import {MockToken, FeeToken, FailingToken, ReentrantToken, NoReturnToken} from "./mocks/Tokens.sol";

contract TokenFaucetTest is Test {
    LaunchToken private drip;
    TokenFaucet private faucet;
    MockToken private six;
    MockToken private eighteen;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    event Donated(address indexed token, address indexed donor, uint256 amount);
    event Claimed(address indexed token, address indexed claimer, uint256 amount);

    function setUp() public {
        drip = new LaunchToken();
        faucet = new TokenFaucet(address(drip));
        six = new MockToken(6);
        eighteen = new MockToken(18);
        vm.warp(10 days);
    }

    function _donate(MockToken token, address donor, uint256 amount) private {
        token.mint(donor, amount);
        vm.startPrank(donor);
        token.approve(address(faucet), amount);
        faucet.donate(address(token), amount);
        vm.stopPrank();
    }

    function test_constructorNeedsNoFundingOrApproval() public view {
        assertEq(faucet.featuredToken(), address(drip));
        assertEq(drip.balanceOf(address(faucet)), 0);
        assertEq(drip.balanceOf(address(this)), 1e27);
        assertEq(faucet.nextClaimAt(address(drip), ALICE), 0);
    }

    function test_constructorRejectsMissingFeaturedToken() public {
        vm.expectRevert(TokenFaucet.InvalidFeaturedToken.selector);
        new TokenFaucet(address(0));
        vm.expectRevert(TokenFaucet.InvalidFeaturedToken.selector);
        new TokenFaucet(ALICE);
    }

    function test_dripDonationAndClaim() public {
        drip.approve(address(faucet), 150 ether);
        vm.expectEmit(true, true, false, true, address(faucet));
        emit Donated(address(drip), address(this), 150 ether);
        assertEq(faucet.donate(address(drip), 150 ether), 150 ether);
        vm.expectEmit(true, true, false, true, address(faucet));
        emit Claimed(address(drip), ALICE, 100 ether);
        vm.prank(ALICE);
        assertEq(faucet.claim(address(drip)), 100 ether);
        assertEq(drip.balanceOf(ALICE), 100 ether);
        assertEq(drip.balanceOf(address(faucet)), 50 ether);
    }

    function test_sixAndEighteenDecimalClaims() public {
        _donate(six, BOB, 200e6);
        _donate(eighteen, BOB, 200 ether);
        assertEq(faucet.claimAmount(address(six)), 100e6);
        assertEq(faucet.claimAmount(address(eighteen)), 100 ether);
        vm.startPrank(ALICE);
        faucet.claim(address(six));
        faucet.claim(address(eighteen));
        vm.stopPrank();
        assertEq(six.balanceOf(ALICE), 100e6);
        assertEq(eighteen.balanceOf(ALICE), 100 ether);
    }

    function test_cooldownExactBoundaryAndNoDuplicateClaim() public {
        _donate(six, BOB, 400e6);
        uint256 initialTime = vm.getBlockTimestamp();
        vm.prank(ALICE);
        faucet.claim(address(six));
        uint256 next = initialTime + 1 days;
        assertEq(faucet.nextClaimAt(address(six), ALICE), next);
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.CooldownActive.selector, next));
        vm.prank(ALICE);
        faucet.claim(address(six));
        vm.warp(next - 1);
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.CooldownActive.selector, next));
        vm.prank(ALICE);
        faucet.claim(address(six));
        vm.warp(next);
        vm.prank(ALICE);
        faucet.claim(address(six));
        assertEq(six.balanceOf(ALICE), 200e6);
        assertEq(faucet.nextClaimAt(address(six), ALICE), next + 1 days);
    }

    function test_firstClaimAllowedAtTimestampZeroAndThenLocked() public {
        _donate(six, BOB, 300e6);
        vm.warp(0);
        vm.prank(ALICE);
        faucet.claim(address(six));
        assertEq(faucet.nextClaimAt(address(six), ALICE), 1 days);
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.CooldownActive.selector, 1 days));
        vm.prank(ALICE);
        faucet.claim(address(six));
    }

    function test_claimingAnotherTokenDoesNotResetFirstCooldown() public {
        _donate(six, BOB, 300e6);
        _donate(eighteen, BOB, 300 ether);
        vm.prank(ALICE);
        faucet.claim(address(six));
        uint256 next = faucet.nextClaimAt(address(six), ALICE);
        vm.warp(vm.getBlockTimestamp() + 10);
        vm.prank(ALICE);
        faucet.claim(address(eighteen));
        assertEq(faucet.nextClaimAt(address(six), ALICE), next);
        assertEq(faucet.nextClaimAt(address(eighteen), ALICE), next + 10);
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.CooldownActive.selector, next));
        vm.prank(ALICE);
        faucet.claim(address(six));
    }

    function test_eachAddressHasIndependentCooldown() public {
        _donate(six, BOB, 200e6);
        vm.prank(ALICE);
        faucet.claim(address(six));
        vm.prank(BOB);
        faucet.claim(address(six));
        assertEq(six.balanceOf(ALICE), 100e6);
        assertEq(six.balanceOf(BOB), 100e6);
    }

    function test_partialLastClaimConsumesCooldown() public {
        _donate(six, BOB, 123e6);
        vm.prank(ALICE);
        faucet.claim(address(six));
        vm.prank(BOB);
        assertEq(faucet.claim(address(six)), 23e6);
        assertEq(six.balanceOf(address(faucet)), 0);
        assertEq(six.balanceOf(BOB), 23e6);
        _donate(six, ALICE, 100e6);
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.CooldownActive.selector, vm.getBlockTimestamp() + 1 days));
        vm.prank(BOB);
        faucet.claim(address(six));
    }

    function test_emptyFaucetRevertsWithoutConsumingCooldown() public {
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.EmptyFaucet.selector, address(six)));
        vm.prank(ALICE);
        faucet.claim(address(six));
        assertEq(faucet.nextClaimAt(address(six), ALICE), 0);
        _donate(six, BOB, 1);
        vm.prank(ALICE);
        assertEq(faucet.claim(address(six)), 1);
    }

    function test_directTransfersAreClaimableButNotCountedAsDonations() public {
        six.mint(BOB, 50e6);
        vm.prank(BOB);
        six.transfer(address(faucet), 50e6);
        assertEq(faucet.donorCount(address(six)), 0);
        assertEq(faucet.donatedBy(address(six), BOB), 0);
        vm.prank(ALICE);
        assertEq(faucet.claim(address(six)), 50e6);
        assertEq(six.balanceOf(address(faucet)), 0);
    }

    function test_feeDonationRecordedNetAndClaimReportsGrossTransfer() public {
        FeeToken taxed = new FeeToken(1_000);
        taxed.mint(BOB, 100 ether);
        vm.startPrank(BOB);
        taxed.approve(address(faucet), 100 ether);
        vm.expectEmit(true, true, false, true, address(faucet));
        emit Donated(address(taxed), BOB, 90 ether);
        assertEq(faucet.donate(address(taxed), 100 ether), 90 ether);
        vm.stopPrank();
        assertEq(faucet.donatedBy(address(taxed), BOB), 90 ether);
        vm.prank(ALICE);
        assertEq(faucet.claim(address(taxed)), 90 ether);
        assertEq(taxed.balanceOf(ALICE), 81 ether);
        assertEq(taxed.balanceOf(address(faucet)), 0);
    }

    function test_zeroReceivedRollsBackMembershipAndTransfer() public {
        FeeToken taxed = new FeeToken(10_000);
        taxed.mint(BOB, 100);
        vm.startPrank(BOB);
        taxed.approve(address(faucet), 100);
        vm.expectRevert(TokenFaucet.ZeroReceived.selector);
        faucet.donate(address(taxed), 100);
        vm.stopPrank();
        assertEq(taxed.balanceOf(BOB), 100);
        assertEq(taxed.totalSupply(), 100);
        assertEq(faucet.donatedBy(address(taxed), BOB), 0);
        assertEq(faucet.donorCount(address(taxed)), 0);
    }

    function test_zeroDonationReverts() public {
        vm.expectRevert(TokenFaucet.ZeroDonation.selector);
        faucet.donate(address(six), 0);
        assertEq(faucet.donorCount(address(six)), 0);
    }

    function test_missingApprovalRevertsAndLeavesNoDonor() public {
        six.mint(BOB, 1);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(faucet), 0, 1));
        vm.prank(BOB);
        faucet.donate(address(six), 1);
        assertEq(faucet.donorCount(address(six)), 0);
        assertEq(faucet.donatedBy(address(six), BOB), 0);
    }

    function test_donorDeduplicationAndPerTokenTotals() public {
        _donate(six, BOB, 1);
        _donate(six, ALICE, 2);
        _donate(six, BOB, 3);
        _donate(eighteen, BOB, 4);
        assertEq(faucet.donorCount(address(six)), 2);
        assertEq(faucet.donorCount(address(eighteen)), 1);
        assertEq(faucet.donatedBy(address(six), BOB), 4);
        assertEq(faucet.donatedBy(address(six), ALICE), 2);
        assertEq(faucet.donatedBy(address(eighteen), BOB), 4);
        address[] memory page = faucet.donors(address(six), 0, 100);
        assertEq(page[0], BOB);
        assertEq(page[1], ALICE);
        vm.prank(BOB);
        faucet.claim(address(six));
        assertEq(faucet.donatedBy(address(six), BOB), 4);
        assertEq(faucet.donorCount(address(six)), 2);
    }

    function test_paginationIsCappedAndHandlesExtremeInputs() public {
        for (uint256 i; i < 205; ++i) {
            _donate(six, address(uint160(1000 + i)), 1);
        }
        assertEq(faucet.donorCount(address(six)), 205);
        address[] memory page = faucet.donors(address(six), 0, type(uint256).max);
        assertEq(page.length, 100);
        for (uint256 i; i < 100; ++i) {
            assertEq(page[i], address(uint160(1000 + i)));
        }
        page = faucet.donors(address(six), 100, 100);
        assertEq(page.length, 100);
        assertEq(page[0], address(1100));
        page = faucet.donors(address(six), 200, 100);
        assertEq(page.length, 5);
        assertEq(page[4], address(1204));
        assertEq(faucet.donors(address(six), 205, 1).length, 0);
        assertEq(faucet.donors(address(six), type(uint256).max, type(uint256).max).length, 0);
        assertEq(faucet.donors(address(six), 0, 0).length, 0);
        assertEq(faucet.donors(address(eighteen), 0, 100).length, 0);
    }

    function test_revertingDecimalsUnsupportedEvenWhenFunded() public {
        _donate(six, BOB, 100e6);
        six.setRevertDecimals(true);
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.UnsupportedDecimals.selector, address(six)));
        faucet.claimAmount(address(six));
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.UnsupportedDecimals.selector, address(six)));
        vm.prank(ALICE);
        faucet.claim(address(six));
        assertEq(faucet.nextClaimAt(address(six), ALICE), 0);
        assertEq(six.balanceOf(address(faucet)), 100e6);
    }

    function testFuzz_decimalsAboveThirtyAreUnsupported(uint8 precision) public {
        precision = uint8(bound(precision, 31, 255));
        six.setDecimals(precision);
        six.mint(address(faucet), 100e6);
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.UnsupportedDecimals.selector, address(six)));
        faucet.claimAmount(address(six));
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.UnsupportedDecimals.selector, address(six)));
        faucet.claim(address(six));
        assertEq(faucet.nextClaimAt(address(six), address(this)), 0);
    }

    function testFuzz_supportedDecimalsAndPartialClaim(uint8 precision, uint256 balance) public {
        precision = uint8(bound(precision, 0, 30));
        balance = bound(balance, 1, 1e34);
        six.setDecimals(precision);
        six.mint(address(faucet), balance);
        uint256 nominal = 100 * 10 ** uint256(precision);
        uint256 expected = balance < nominal ? balance : nominal;
        assertEq(faucet.claimAmount(address(six)), nominal);
        vm.prank(ALICE);
        assertEq(faucet.claim(address(six)), expected);
        assertEq(six.balanceOf(ALICE), expected);
        assertEq(six.balanceOf(address(faucet)) + six.balanceOf(ALICE), balance);
    }

    function test_mutableDecimalsCanEmptyOnlyItsOwnPool() public {
        _donate(six, BOB, 1000e6);
        _donate(eighteen, BOB, 200 ether);
        six.setDecimals(30);
        assertEq(faucet.claimAmount(address(six)), 1e32);
        vm.prank(ALICE);
        faucet.claim(address(six));
        assertEq(six.balanceOf(ALICE), 1000e6);
        assertEq(six.balanceOf(address(faucet)), 0);
        assertEq(eighteen.balanceOf(address(faucet)), 200 ether);
        assertEq(faucet.nextClaimAt(address(eighteen), ALICE), 0);
        six.setDecimals(6);
        _donate(six, BOB, 100e6);
        vm.expectRevert(abi.encodeWithSelector(TokenFaucet.CooldownActive.selector, vm.getBlockTimestamp() + 1 days));
        vm.prank(ALICE);
        faucet.claim(address(six));
    }

    function testFuzz_failedTransfersRollBackDonationAndClaim(bool falseReturn) public {
        FailingToken broken = new FailingToken();
        broken.mint(BOB, 200 ether);
        vm.prank(BOB);
        broken.approve(address(faucet), 200 ether);
        broken.configure(falseReturn, !falseReturn);
        bytes memory expectedError = falseReturn
            ? abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(broken))
            : abi.encodeWithSignature("Error(string)", "transfer failed");
        vm.expectRevert(expectedError);
        vm.prank(BOB);
        faucet.donate(address(broken), 200 ether);
        assertEq(faucet.donorCount(address(broken)), 0);
        assertEq(faucet.donatedBy(address(broken), BOB), 0);
        assertEq(broken.balanceOf(BOB), 200 ether);
        assertEq(broken.allowance(BOB, address(faucet)), 200 ether);
        broken.configure(false, false);
        vm.prank(BOB);
        faucet.donate(address(broken), 200 ether);
        broken.configure(falseReturn, !falseReturn);
        vm.expectRevert(expectedError);
        vm.prank(ALICE);
        faucet.claim(address(broken));
        assertEq(faucet.nextClaimAt(address(broken), ALICE), 0);
        assertEq(broken.balanceOf(address(faucet)), 200 ether);
        assertEq(broken.balanceOf(ALICE), 0);
        broken.configure(false, false);
        vm.prank(ALICE);
        faucet.claim(address(broken));
        assertEq(broken.balanceOf(ALICE), 100 ether);
    }

    function test_legacyNoReturnTokenSupported() public {
        NoReturnToken legacy = new NoReturnToken();
        legacy.mint(BOB, 120e6);
        vm.startPrank(BOB);
        legacy.approve(address(faucet), 120e6);
        assertEq(faucet.donate(address(legacy), 120e6), 120e6);
        vm.stopPrank();
        vm.prank(ALICE);
        assertEq(faucet.claim(address(legacy)), 100e6);
        assertEq(legacy.balanceOf(ALICE), 100e6);
        assertEq(faucet.donatedBy(address(legacy), BOB), 120e6);
    }

    function testFuzz_reentrancyBlockedAcrossFunctionsAndPools(bool outerClaim, bool innerClaim, bool otherToken)
        public
    {
        ReentrantToken malicious = new ReentrantToken();
        _donate(six, BOB, 200e6);
        _donate(malicious, BOB, 200 ether);
        address innerToken = otherToken ? address(six) : address(malicious);
        bytes memory payload =
            innerClaim ? abi.encodeCall(faucet.claim, (innerToken)) : abi.encodeCall(faucet.donate, (innerToken, 1));
        malicious.arm(address(faucet), payload);
        if (outerClaim) {
            vm.prank(ALICE);
            faucet.claim(address(malicious));
            assertEq(malicious.balanceOf(ALICE), 100 ether);
            assertEq(malicious.balanceOf(address(faucet)), 100 ether);
        } else {
            _donate(malicious, ALICE, 50 ether);
            assertEq(faucet.donatedBy(address(malicious), ALICE), 50 ether);
            assertEq(malicious.balanceOf(address(faucet)), 250 ether);
        }
        assertFalse(malicious.callbackSuccess());
        assertEq(
            malicious.callbackResult(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector)
        );
        assertEq(six.balanceOf(address(faucet)), 200e6);
        assertEq(six.balanceOf(address(malicious)), 0);
        assertEq(faucet.nextClaimAt(innerToken, address(malicious)), 0);
        assertEq(faucet.donatedBy(innerToken, address(malicious)), 0);
    }

    function test_invalidTokenAddressesRevert() public {
        vm.expectRevert();
        faucet.donate(ALICE, 1);
        vm.expectRevert();
        faucet.claim(ALICE);
        vm.expectRevert();
        faucet.claim(address(0));
        assertEq(faucet.donorCount(ALICE), 0);
    }

    function test_noNativePaymentsOrWithdrawAdminPaths() public {
        vm.deal(address(this), 3 ether);
        (bool success,) = address(faucet).call{value: 1 ether}("");
        assertFalse(success);
        (success,) = address(faucet).call{value: 1 ether}(abi.encodeCall(faucet.claim, (address(six))));
        assertFalse(success);
        (success,) = address(faucet).call{value: 1 ether}(abi.encodeCall(faucet.donate, (address(six), 1)));
        assertFalse(success);
        _donate(six, BOB, 1000e6);
        string[5] memory signatures =
            ["withdraw(address,uint256)", "withdrawAll(address)", "setOwner(address)", "pause()", "upgradeTo(address)"];
        for (uint256 i; i < signatures.length; ++i) {
            vm.prank(BOB);
            (success,) = address(faucet).call(abi.encodeWithSignature(signatures[i], address(six), 1000e6));
            assertFalse(success);
        }
        assertEq(six.balanceOf(address(faucet)), 1000e6);
    }
}

contract DonorPaginationGasTest is Test {
    TokenFaucet private faucet;
    MockToken private token;

    function setUp() public {
        token = new MockToken(6);
        faucet = new TokenFaucet(address(token));
        for (uint256 i; i < 1005; ++i) {
            address donor = address(uint160(1000 + i));
            token.mint(donor, 1);
            vm.startPrank(donor);
            token.approve(address(faucet), 1);
            faucet.donate(address(token), 1);
            vm.stopPrank();
        }
    }

    function test_largeDonorListStillFitsBoundedViewGas() public view {
        // The list was populated in setUp; the tested call has a fixed gas budget.
        (bool ok, bytes memory result) = address(faucet).staticcall{gas: 500_000}(
            abi.encodeCall(faucet.donors, (address(token), 900, type(uint256).max))
        );
        assertTrue(ok);
        address[] memory page = abi.decode(result, (address[]));
        assertEq(page.length, 100);
        assertEq(page[99], address(1999));
    }
}
