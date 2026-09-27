# Independent review handoff

This is the implementer's test and assumption record, not an independent review or release approval. The designated reviewer must inspect the accepted source plus the separately generated `launch.json` and report concrete findings. No deployment, published artifact, attestation or admission is claimed by this contribution.

## Attack cases exercised locally

| Attack/input | Expected behavior and evidence |
| --- | --- |
| Token callbacks during `transferFrom` or `transfer`, reentering either `donate` or `claim`, on the same or another pool | All eight combinations reject the inner call with the shared guard error while a successful outer transfer remains accounted. `testFuzz_reentrancyBlockedAcrossFunctionsAndPools` checks balances and absence of nested records/cooldowns. |
| Mutable decimals raised from 6 to 30 | Claim can exhaust that token's pool. `test_mutableDecimalsCanEmptyOnlyItsOwnPool` verifies the other pool and cooldown are unaffected, and changing decimals back cannot bypass the first pool's cooldown. This is an explicit token-trust assumption of the specified dynamic metadata design. |
| Reverting decimals or decimals 31–255 | Claim and nominal amount views revert; no funds move or cooldown changes. Unsupported-decimal fuzz inputs are bounded to 31–255. |
| Claim token A, claim B, then claim A before 24 hours | Token A remains locked; token B's timestamp is independent. Tests cover the exact 24-hour boundary, timestamp zero, a different account, and partial payout cooldowns. |
| Thousands of dust donors, oversized page limits and extreme offsets | No duplicate entries; page length capped at 100; empty past the end. A funded 1,005-donor list returns 100 later entries within a 500,000 gas call budget. |
| Fee-on-transfer deposit or 100% fee | Donor total/event use the net balance delta. A zero receipt reverts, including token-side effects, allowances, and donor membership. |
| Token returns false after mutating balances, or reverts | SafeERC20 rejects it; donation, balance changes and cooldown changes roll back. Restoring token transfers allows a successful retry. |
| Unrecorded direct transfer, small remainder, or empty pool | Direct transfers remain claimable; a partial last claim pays the balance; empty claims revert without consuming eligibility. |
| Random interleavings across four wallets and two tokens | Stateful invariants compare pool balances, user balances, donor lists/totals and cooldowns to an independent receipt/payout model over donations, direct transfers, claims, and time advances. |
| Factory caller and empty faucet at construction | CREATE2 harness confirms all supply remains at the deployer, featured address is configured, neither contract has escape opcodes, runtime fits EIP-170, and the application constructor rejects ETH. This is not a complete protocol factory simulation. |

## Items for the independent reviewer

Confirm the manifest identifies `LaunchToken` and exactly one application `TokenFaucet` with `constructorArgs: ["$token"]`, dependency order, no owner/beneficiary substitution, and no payable constructor value or initialization requirement. Token metadata and supply must match `Drip`, `DRIP`, 18 and `10^27` minor units. Concrete source/constructor/authorization conflicts remain findings; canonical policy and signed artifact linkage are the services' responsibility.

Inspect arbitrary token behavior beyond the supplied mocks, especially return-data abuse, dishonest balances, changing decimals, reentrant callbacks and token-wide gas griefing. A broken token may make operations on its own pool revert or consume gas; it must not obtain another pool's assets or bypass global reentrancy protection. Views may observe tentative donor membership during the guarded donation interaction; no payout depends on those views.

Confirm the frontend communicates final donations, outgoing transfer fees, unrestricted multi-address claims and token trust. There is no rescue for unsupported or frozen tokens, no ETH recovery, no pause, and no operator able to refill a pool except through ordinary transfers/donations. Do not treat the local tests or this handoff as a substitute for independent adversarial review.

## Local validation record

Checked with Forge 1.8.3 and the pinned Solidity 0.8.26 compiler:

- `forge build`: passed. The timestamp-comparison lint warning is expected for the specified chain-time cooldown; timestamp trust is documented in the README.
- `forge test`: passed. The final run also passed offline with an empty process environment, four threads and fuzz seed `0x44524950`: 38 tests, zero failures or skips. Forge groups the two invariant properties into one campaign; that campaign ran 128 sequences of 64 calls (8,192 total) with zero unexpected reverts.
- `forge fmt --check`: passed.
- `python3 scripts/export_abis.py --check`: passed; both exports match the compiled contracts.
- Compiled runtime sizes: LaunchToken 1,722 bytes; TokenFaucet 2,992 bytes. Local constructor/opcode tests passed. The externally supplied protected harness was read as a deployment baseline; its environment-driven service invocation is not claimed as a local test run.
