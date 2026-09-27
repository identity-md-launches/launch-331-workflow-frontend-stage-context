// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Sepolia test faucet. Anyone can claim from many addresses; this is not a fair distribution.
/// @dev Each token's balanceOf, decimals and transfer behavior is trusted for its own pool only.
contract TokenFaucet is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant COOLDOWN = 24 hours;
    uint256 public constant MAX_DONORS_PER_PAGE = 100;
    address public immutable featuredToken;

    mapping(address token => mapping(address donor => uint256 amount)) public donatedBy;
    mapping(address token => address[] accounts) private _donors;
    mapping(address token => mapping(address donor => bool listed)) private _listed;
    mapping(address token => mapping(address account => uint256 timestamp)) private _nextClaimAt;

    error InvalidFeaturedToken();
    error ZeroDonation();
    error ZeroReceived();
    error UnsupportedDecimals(address token);
    error EmptyFaucet(address token);
    error CooldownActive(uint256 nextClaimAt);

    event Donated(address indexed token, address indexed donor, uint256 amount);
    event Claimed(address indexed token, address indexed claimer, uint256 amount);

    /// @param featuredToken_ Deployed DRIP address ($token). No balance or approval is required.
    constructor(address featuredToken_) {
        if (featuredToken_ == address(0) || featuredToken_.code.length == 0) revert InvalidFeaturedToken();
        featuredToken = featuredToken_;
    }

    /// @notice Irrevocably donate tokens; the returned amount and event report the net receipt.
    function donate(address token, uint256 amount) external nonReentrant returns (uint256 received) {
        if (amount == 0) revert ZeroDonation();
        IERC20 asset = IERC20(token);
        uint256 balanceBefore = asset.balanceOf(address(this));

        // Apply membership effects before calling the token; any failure rolls them back.
        if (!_listed[token][msg.sender]) {
            _listed[token][msg.sender] = true;
            _donors[token].push(msg.sender);
        }

        asset.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = asset.balanceOf(address(this));
        if (balanceAfter <= balanceBefore) revert ZeroReceived();
        received = balanceAfter - balanceBefore;

        // Net receipt is only knowable after the interaction. The shared guard remains held.
        donatedBy[token][msg.sender] += received;
        emit Donated(token, msg.sender, received);
    }

    /// @notice Claim up to 100 whole tokens, once per token per caller per 24 hours.
    /// @dev A fee on the outgoing transfer can reduce what the caller actually receives.
    function claim(address token) external nonReentrant returns (uint256 amount) {
        uint256 next = _nextClaimAt[token][msg.sender];
        if (block.timestamp < next) revert CooldownActive(next);

        amount = claimAmount(token);
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert EmptyFaucet(token);
        if (balance < amount) amount = balance;

        // Store the next time directly so that a first claim at timestamp zero is also remembered.
        _nextClaimAt[token][msg.sender] = block.timestamp + COOLDOWN;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Claimed(token, msg.sender, amount);
    }

    /// @notice Nominal claim size, before capping to the current pool balance.
    /// @dev Metadata is read on every call; changing decimals affects only that token's pool.
    function claimAmount(address token) public view returns (uint256) {
        try IERC20Metadata(token).decimals() returns (uint8 precision) {
            if (precision > 30) revert UnsupportedDecimals(token);
            return 100 * 10 ** uint256(precision);
        } catch {
            revert UnsupportedDecimals(token);
        }
    }

    /// @notice Zero means this account has never successfully claimed this token.
    function nextClaimAt(address token, address account) external view returns (uint256) {
        return _nextClaimAt[token][account];
    }

    function donorCount(address token) external view returns (uint256) {
        return _donors[token].length;
    }

    /// @notice Donation order, without duplicates. Oversized limits are capped to 100.
    function donors(address token, uint256 offset, uint256 limit) external view returns (address[] memory page) {
        address[] storage accounts = _donors[token];
        if (offset >= accounts.length || limit == 0) return new address[](0);
        if (limit > MAX_DONORS_PER_PAGE) limit = MAX_DONORS_PER_PAGE;
        uint256 count = accounts.length - offset;
        if (count > limit) count = limit;
        page = new address[](count);
        for (uint256 i; i < count; ++i) {
            page[i] = accounts[offset + i];
        }
    }
}
