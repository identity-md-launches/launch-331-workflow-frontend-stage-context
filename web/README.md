# Drip faucet frontend

One static React + TypeScript page for the deployed Drip launch on Sepolia. The page lets visitors select DRIP or another ERC-20, inspect balances and cooldowns, claim, approve and donate, page through donors, and swap ETH ↔ DRIP through the launch's Uniswap v4 pool. Wagmi handles injected browser wallets; viem handles reads, simulations and encoding. There is no backend or indexer.

**Test tokens only.** Anyone can claim from many addresses. This is a test faucet, not a fair or valuable distribution. Donations are final and cannot be withdrawn. Each token's own balance, decimals and transfer implementation is trusted; a malicious token can hurt its own pool. Unsupported or frozen tokens have no rescue path. Fee tokens are credited by the faucet's actual receipt, and outgoing transfer fees can reduce a claim's receipt.

## Install, build and preview

Use Node 22.23 or newer with npm. From the repository root:

```sh
npm ci --prefix web --cache test/scratch/npm-cache
npm run typecheck --prefix web
npm run build --prefix web
npm run preview --prefix web
```

Open the printed preview URL. `npm run dev --prefix web` serves development source; its Vite middleware serves the same manifest and ABI bytes from the committed `dist/`. Run the build once if the export is absent, and rebuild after changing deployment inputs. No separate development address map or copied configuration is needed.

The build reads the pinned implementation ABI bytes from Git, validates them, runs Vite with `base: './'`, writes the ABIs into `dist/abi/`, then writes `dist/imd-deployment.json` **last**. Every other exported file, including `index.html`, is inventoried with lowercase SHA-256. Never edit `dist/` manually. Rebuild after any source or deployment input change and commit the entire resulting export. `dist/` runs under a gateway subpath without rewrites. Serve it over HTTP(S), not `file://`.

Offline reinstallation/build was checked on this worker using the populated install cache:

```sh
npm ci --prefix web --cache test/scratch/npm-cache --offline
npm run build --prefix web
```

A clean machine needs network access for its initial `npm ci`, or an existing compatible npm cache. Dependencies, caches and browser binaries are not submitted. The network's `none` verifier does not rebuild this frontend; the committed export is the deployable artifact.

## Deployment configuration

- `web/config/handoff.json` and `web/config/network.json` are preserved copies of the assignment's supplied inputs. They are **build inputs**, not additional runtime maps.
- `web/scripts/export.mjs` reads `docs/abi/<Contract>.json` at deployed source commit `ff7b97af63e4c0ad511d7e9bc79061c7d9ccb2c0` with `git show`. It also requires the working ABI exports to match those bytes. Keep that Git object available when building.
- ABI hashes are Keccak-256 of recursive lexicographic object-key canonical JSON, preserving array order, with the `0x` prefix removed. Both supplied hashes match the pinned exports.
- `dist/imd-deployment.json` is the **only runtime deployment configuration**. It contains the exact handoff identifiers and contract set, the supplied `network` object unchanged, plus the original `walletAddChain` and `pool` objects needed at runtime.
- `src/config.ts` fetches that file relative to the page, validates it, fetches the referenced raw ABI arrays, and checks their canonical hashes. Deployed calls use those fetched ABIs. Standard ERC-20 and infrastructure interfaces are centralized there; they have no separate address map.
- Public reads try the listed HTTPS RPCs in order, then the connected wallet provider when it is on the expected chain. Signing always stays in the visitor's wallet. No keys, private RPC credentials or WalletConnect project ID are used.
- The app verifies the RPC chain ID, nonempty code at the handoff's contracts and the used Uniswap contracts, and the faucet's featured token before enabling actions. This is a runtime consistency check, not cryptographic verification of the attestation or runtime bytecode equivalence. Publication binds the configuration to the attested handoff.

## Wallet and transaction behavior

Injected wallets and providers discovered by wagmi are supported; the first available connector is used. With several extensions, choose the desired default in the wallet environment. Mobile users need an injected-wallet browser. No WalletConnect connector is enabled because no public project ID was provided. Adding one later requires an explicit public configuration and a connector; never add a private credential.

Wrong-chain state has one Switch control. A 4902/unknown-chain response causes `wallet_addEthereumChain` with the supplied parameters, followed by another switch. Rejection is surfaced without automatic retries. Account and chain changes invalidate the current quote and token eligibility.

Read batches share a latest block number. Balances, donor pages, allowances and cooldowns refresh every 30 seconds, after confirmed writes, or with Refresh. Eligibility uses chain time rather than the visitor's clock. The last claim may pay less than 100 tokens; an empty pool disables claims. Decimals must work and be at most 30. When arbitrary token metadata fails, choose another token or retry. Symbols are bounded to 40 characters.

Donations use an exact-amount ERC-20 approval to the faucet, followed by a separate `donate` call and an explicit finality checkbox. An insufficient nonzero approval first offers a reset to zero, then the requested approval, supporting tokens that require this order. The application does not expose generic ERC-20 transfers or `transferFrom`; claim, donation and their approvals are the primary application actions.

Swaps always use the manifest's native ETH/DRIP pool and its vetted Uniswap addresses, regardless of the selected faucet token. Quotes call `quoteExactInputSingle` with `simulateContract`, never a transaction. Slippage is 0.1–5%, default 0.5%; quote lifetime is 60 seconds. Minimum output is rounded down. Inputs reject excess decimal precision and uint128 overflow. Quotes are invalidated by edits, account/network changes and confirmed writes. Their age is rechecked immediately before signing.

The universal router receives command `0x10`, actions `0x060c0f`, and the workflow's exact-input tuple, settlement and take parameters. Native input sends the input as `value`, with no approval. DRIP input first approves the network's Permit2 address on DRIP, then gives Permit2 permission for the network's universal router, using the exact amount and a one-hour expiration. Obtain a fresh quote after approvals. Swaps have a five-minute deadline and are simulated before wallet signing.

Every write rechecks account/network and deployment prerequisites, simulates, requests wallet confirmation, shows the transaction link, and waits for a receipt. If confirmation times out, further sends are disabled until Check transaction obtains a final receipt. Receipt polling is session-local: after a reload, consult your wallet/explorer for outstanding submissions before repeating an action.

## Validation

```sh
npm test --prefix web
npm run test:browser --prefix web
node web/tests/dev.mjs
node web/scripts/check-live.mjs
```

The unit suite checks manifest inventory/hash binding, the ABI canonicalization, exact amounts, path constraints, v4 encoding and network addition. Browser tests launch a bounded local HTTP server at `/preview/`, run the **production export** with mocked RPC and injected-wallet responses, save evidence under `docs/frontend/`, and close the browser and server. No test broadcasts transactions. They use the worker's installed Chromium headless shell if available; elsewhere install Chromium with `npx playwright install chromium` from `web/`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a compatible binary. `CHECK_FILTER` is for targeted repair checks; omit it for the full suite. `INSPECT=1` keeps the test-owned preview available for up to five additional minutes.

`check-live.mjs` uses public read-only JSON-RPC through curl and records actual deployed code, featured token and faucet balance. Its quote is pinned to the recorded block. It does not send a transaction. The current results and untested live behavior are in [VALIDATION.md](../docs/VALIDATION.md); design tokens and review attribution are in [DESIGN.md](../docs/DESIGN.md).

No site publication, IPFS pinning, source push, deployment or live-chain transaction was performed. Those are control-plane/operator actions after this source delivery.
