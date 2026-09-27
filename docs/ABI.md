# ABI exports

Generated JSON ABI arrays, suitable for an ethers/viem-style contract client:

- [LaunchToken.json](abi/LaunchToken.json)
- [TokenFaucet.json](abi/TokenFaucet.json)

Regenerate with `python3 scripts/export_abis.py`; verify with `python3 scripts/export_abis.py --check`. These files describe the compiled source; they are not deployment attestations or address records.

## LaunchToken

No constructor arguments. ERC-20 functions: `name()`, `symbol()`, `decimals()`, `totalSupply()`, `balanceOf(address)`, `allowance(address,address)`, `approve(address,uint256)`, `transfer(address,uint256)` and `transferFrom(address,address,uint256)`. Transfer and approval amounts are minor units. Events are standard `Transfer` and `Approval`; errors follow ERC-6093. The full supply is minted to the deployer once.

## TokenFaucet

Constructor: `constructor(address featuredToken_)`, nonpayable, supplied as `["$token"]` by the manifest. No address parameter grants authorization. Every external function is nonpayable or view.

| Function | Return | Meaning |
| --- | --- | --- |
| `featuredToken()` | `address` | Immutable default DRIP address |
| `COOLDOWN()` | `uint256` | 86,400 seconds |
| `MAX_DONORS_PER_PAGE()` | `uint256` | 100 |
| `donate(address token, uint256 amount)` | `uint256 received` | Approved pull; records net receipt |
| `claim(address token)` | `uint256 amount` | Gross amount transferred, capped by balance |
| `claimAmount(address token)` | `uint256` | Nominal 100 whole tokens, without balance/cooldown checks |
| `nextClaimAt(address token, address account)` | `uint256` | Zero initially; otherwise earliest allowed timestamp |
| `donorCount(address token)` | `uint256` | Unique successful donors for this token |
| `donors(address token, uint256 offset, uint256 limit)` | `address[]` | Ordered page, at most 100 |
| `donatedBy(address token, address donor)` | `uint256` | Lifetime net donations, unaffected by claims |

Events:

```solidity
event Donated(address indexed token, address indexed donor, uint256 amount);
event Claimed(address indexed token, address indexed claimer, uint256 amount);
```

Both amounts use token minor units. Donations report the balance delta; claims report the outgoing transfer amount before any token fee. Transaction return values are available in simulation; use receipts/events and refreshed views for submitted transactions.

Application errors are `InvalidFeaturedToken()`, `ZeroDonation()`, `ZeroReceived()`, `UnsupportedDecimals(address token)`, `EmptyFaucet(address token)` and `CooldownActive(uint256 nextClaimAt)`. The inherited guard uses `ReentrancyGuardReentrantCall()`. SafeERC20 can emit `SafeERC20FailedOperation(address token)` as a revert error, and arbitrary token revert data can propagate. ABI entries do not enumerate errors defined solely by third-party tokens.

For a UI preview, combine the nominal `claimAmount`, the actual ERC-20 `balanceOf(faucet)` and the wallet's `nextClaimAt`. Preview results can change before inclusion. Approval is a call to the selected ERC-20, with `spender = faucet`; the faucet never approves another account.
