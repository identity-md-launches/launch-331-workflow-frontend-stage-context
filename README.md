# Drip — lab-token-faucet

Contracts for a Sepolia (chain ID **11155111**) test faucet, with **Drip (DRIP)** as the default token. Anyone can claim from many addresses: this is a test faucet, **not a fair or valuable distribution**.

This contribution delivers contracts, vendored dependencies, tests, ABI exports and deployment/integration documentation. The separate manifest assignment produces `launch.json`; the independent reviewer examines both the accepted source and manifest. Publication, attestation, admission, factory deployment and the live website belong to subsequent services/stages.

## Build and test

Requires Foundry and its installed Solidity **0.8.26** compiler. All Solidity dependencies are ordinary files under `lib/`; no dependency download, environment variables, RPC, wallet, FFI or filesystem cheatcode access is needed to build or run these tests.

```sh
forge build
forge test
forge fmt --check
python3 scripts/export_abis.py --check
```

`foundry.toml` pins the compiler, Cancun EVM, optimizer (200 runs), and `bytecode_hash = "none"`. It enables neither FFI nor filesystem access. Regenerate ABI exports with `python3 scripts/export_abis.py` after modifying a contract. Python is only needed for ABI export/checking, not the Solidity build or tests.

## Contracts and deployment parameters

| Contract | Constructor | Deployment behavior |
| --- | --- | --- |
| `src/LaunchToken.sol:LaunchToken` | No arguments; nonpayable | ERC-20 name `Drip`, symbol `DRIP`, 18 decimals. Mints exactly 1,000,000,000 tokens (`10^27` minor units) to `msg.sender`, the factory. |
| `src/TokenFaucet.sol:TokenFaucet` | One `address featuredToken_`; nonpayable | Use manifest constructor arguments `["$token"]`. The featured token must already have code. Stores the address immutably; requires no funding or approval. |

Deploy the token first, then the single application contract identified as `TokenFaucet`. Use launch kind `evm_project`. There are no initializer calls, privileged beneficiaries, owner arguments, upgrade paths or admin functions. The token has no callable mint or burn, fee, pause or blocklist. Constructors preserve the entire token supply at the factory; the faucet starts with zero DRIP. No constructor relies on the factory exercising an owner role.

The deployment service must resolve `$token`, target Sepolia, validate the separately produced manifest, and supply the canonical policy and signed artifact linkage. Those service outcomes are not inputs required by these contracts or local tests. No live deployment address is asserted here. The contracts themselves do not inspect `chainid`; the service and frontend enforce the Sepolia-only target.

The factory distributes launch supply to liquidity and protocol rewards. Users obtain DRIP by swapping Sepolia ETH in the launch pool and may then donate it. No application balance is taken from the launch supply during construction. This repository contains no broadcasting script or wallet configuration.

## Faucet behavior

- `donate(token, amount)` requires a positive amount and the caller's approval to the faucet. It uses `SafeERC20.safeTransferFrom`, measures the balance increase and records that **net receipt** in `donatedBy(token, donor)`. A zero or decreasing net balance reverts atomically. Donations are final: historical totals give no withdrawal rights.
- A donor is listed once per token in first-successful-donation order. Repeated donations increase the total without extending the list. Direct ERC-20 transfers to the faucet are claimable but do not add donor records or `Donated` events.
- `claim(token)` sends tokens directly to the caller. The nominal amount is `100 * 10^decimals()`, capped to the faucet's current token balance. A partial claim consumes the same cooldown as a full claim. An empty pool reverts.
- The first claim is always eligible, including at timestamp zero. Further successful claims for the same token and address require `block.timestamp >= previous claim timestamp + 24 hours`, including the exact boundary. Other tokens and addresses have independent cooldowns. Failed claims do not consume or change a cooldown.
- `claimAmount(token)` is the **nominal** amount, independent of funding and cooldown. It reads `IERC20Metadata.decimals()` on every call. Reverting/missing metadata or decimals above 30 make claims unsupported. Zero through 30 decimals are supported.
- `nextClaimAt(token, account)` is zero before the first successful claim and otherwise the earliest permitted timestamp. An expired timestamp stays stored until the next successful claim.
- `donors(token, offset, limit)` returns at most 100 addresses. Larger limits are capped, a zero limit is empty, and an offset at/past the end is empty. Work and allocation depend on the requested page, not total donor count; maximal integer inputs cannot overflow the bounds calculation.
- `Donated(token, donor, amount)` reports net incoming tokens. `Claimed(token, claimer, amount)` reports the amount requested from the outgoing transfer. Both index the token and account. An outgoing token fee may make the recipient receive less than the event amount.

Both mutating methods share a reentrancy guard. Claim eligibility is checked and the next claim timestamp stored before the transfer. Donation membership is updated before the transfer; the net total can only be finalized after measuring the receipt. The guard covers the entire measurement/accounting sequence, and any failed transfer or accounting check rolls all changes back. During a malicious token's donation callback, a read may see tentative membership; no other state-changing faucet operation can enter, and donor data is never used for payouts.

## Assumptions and operations

Each token's own `balanceOf` and transfer behavior is trusted, so a malicious token can only hurt its own pool. SafeERC20 handles no-return tokens and rejects false/reverting transfers; it cannot make a dishonest token honor balances. Rebasing, dishonest balance reports, sender-side surcharges, blacklists and other arbitrary token behavior have no promised accounting semantics. There is no allowlist, token certification or rescue authority.

Decimals are deliberately not cached. A token changing its decimals to 30 can make a single claim empty that token's pool, subject to its balance and cooldown. A value above 30 reverts rather than overflowing. This cannot select a different token for transfer or reset that other token's cooldown. Donors should use tokens they trust; a token with permanently unsupported metadata or permanently failing transfers may remain unusable. The application cannot repair or rescue such a token.

No native ETH payment is accepted by constructors, `donate`, `claim`, or an empty call. Gas is paid normally by callers. ETH forced into the address is not recoverable. There is no treasury, withdrawal, fee collection, emergency pause, keeper or oracle. Donors fund pools voluntarily; anyone may exhaust a pool using multiple addresses. Chain timestamps govern the cooldown.

Passing tests is not an independent security audit. See [the adversarial review handoff](docs/REVIEW_HANDOFF.md) for concrete attack cases and the remaining independent review responsibility before release.

## Website handoff

The later frontend stage should publish one small static page labeled `lab-token-faucet`, with `dist/index.html`, against the service's verified live deployment. Use the [ABI exports and integration notes](docs/ABI.md); no backend or indexer is required.

1. Check the connected chain is Sepolia. Default to `featuredToken()` and allow a pasted token address.
2. Read the selected token's metadata and `balanceOf(faucet)`, plus `claimAmount(token)` and `nextClaimAt(token, wallet)`. Display unsupported-token errors without guessing decimals. Display the earlier described nominal cap separately from the available balance.
3. Submit `claim(token)` from the connected wallet. For donations, parse the amount using that token's decimals, approve the **faucet** on the token, wait for approval, then call `donate(token, amount)`.
4. Page through `donorCount`, `donors` (page size at most 100) and `donatedBy`, using contract views and events only. Refresh balances and cooldowns after receipts. Token symbols and names are untrusted display text.
5. State on the page that anyone can claim from many addresses, that this is a test faucet rather than a fair or valuable distribution, that donations are final, and that each token's balances/transfers are trusted only for its own pool.

## Dependencies and license

OpenZeppelin Contracts v5.1.0 provides ERC-20, SafeERC20 and ReentrancyGuard. Forge Std v1.9.6 provides test utilities. Relevant source files and upstream licenses are vendored under `lib/`; see [dependency provenance](lib/README.md). Project code is MIT licensed.
