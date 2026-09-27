# Frontend validation and Better Interface review

Worker validation dated 2026-09-27. These checks are the contributor's evidence, not independent certification, publication approval or a Solidity security review.

## Scope and assumptions

The approved workflow, deployment/network handoffs, both protected Solidity harnesses, implementation contracts, pinned ABI exports, and the pinned Better Interface workflow plus the core principles of all six domains were read. Deployed Solidity, manifest, Foundry configuration, libraries and root configuration were preserved. The work adds one React/Vite/TypeScript/wagmi page, its source and lockfile under `web/`, its static export under `dist/`, and documentation/evidence under `docs/`.

DRIP is the default faucet token; arbitrary ERC-20 selection is supported for faucet actions. The deployment's pool is native ETH/DRIP, hookless, fee 3000, tick spacing 60. Swaps use only that pool, even when the visitor selects another faucet token. No wallet project ID was supplied, so browser injection is used. No privileged wallet, owner action, backend, indexer, liquidity management, publication or redeployment was added.

**Documentation path conflict:** the requested root `DESIGN.md` is outside the overriding write allowlist. The full implemented design record is delivered at [docs/DESIGN.md](DESIGN.md). The literal root-path criterion is not met; the protected root is untouched. No other requested deliverable was omitted to reduce size.

## Commands and results

Commands below ran from the repository root unless noted.

| Check | Result |
| --- | --- |
| `npm ci --prefix web --cache test/scratch/npm-cache --offline` | Passed using the cache populated by the initial permitted install; zero audit vulnerabilities reported. No clean-machine offline dependency availability is claimed. |
| `npm run typecheck --prefix web` | Passed. Also rerun by each production build. |
| `npm run build --prefix web` | Passed; relative Vite base, implementation ABI hash checks, static export and final manifest generation. Vite reports the main JS chunk is over its default 500 kB advisory threshold; it is about 595 kB before compression and about 180 kB gzip. This is below the assignment budget and is not hidden by changing the warning threshold. |
| `npm test --prefix web` | 8 tests passed, zero failures: exact handoff/configuration binding, every exported asset hash, ABI canonicalization, safe paths, precise amounts/overflow, small balances, buy/sell nested v4 encodings and wallet chain-add/rejection behavior. |
| `npm run test:browser --prefix web` | 16 scenario groups passed against the built export served at `/preview/`; see [interaction-results.json](frontend/interaction-results.json). RPC and wallet responses are mocked. |
| `node web/tests/dev.mjs` | Development server checked for byte-identical manifest/ABIs and source-module delivery. |
| `node web/scripts/check-live.mjs` | Read-only public RPC checks and a real simulated Uniswap quote passed; see [live-read.json](frontend/live-read.json). No transaction was sent. |

The runtime deployment file retains the exact handoff identifiers, both contract bindings and ABI hashes. It copies the supplied `network` object unchanged and includes `walletAddChain` and the original pool object. The app fetches this file and the referenced ABI JSON at runtime. The exporter obtains ABI bytes with `git show <deployed-source-commit>:docs/abi/<Contract>.json`, compares the working exports, and verifies canonical Keccak. It inventories every other export file with lowercase SHA-256, excludes the manifest itself, rejects symlinks/oversize files and limits asset count to 128. The tests independently compare the inventory to the actual export tree.

## Browser and interaction evidence

Real Chromium headless shell rendered the production export. The supplied browser MCP initially opened a blank page but subsequently returned `Transport closed`; the installed Playwright/Chromium browser provided the successful rendered and interaction checks instead. The validation script owns and closes its HTTP server and browser within one bounded foreground run. Screenshots were opened and visually inspected on the worker.

- [Desktop, 1440px](frontend/desktop.png): mocked connected wallet after a successful claim and donation, with cooldown, balances, donor rows and transaction link.
- [Mobile, 390px](frontend/mobile.png): the same mocked state with stacked claim/donation cards and wrapping footer.
- [Keyboard focus](frontend/keyboard-focus.png): visible skip-link focus over the actual page. Keyboard-only tests connect, reach the amount field, toggle donation finality, approve and donate with Tab/Enter/Space.
- Reflow checks at 1440, 850, 660, 390 and 320 CSS pixels; additional 40-character unbroken token-symbol regression at 320px. No horizontal overflow in checked states.
- 200% CSS root-font enlargement checked at 1440px, and reduced-motion media emulation checked. This is not browser-native 200% zoom or a physical-device check.
- No uncaught page errors, browser error-console messages or failed local asset requests in the final interaction report.
- Axe's WCAG 2 A/AA and 2.1 AA automated checks reported zero violations in the connected donor/claim/donation state. This does not establish full accessibility compliance.

The browser suite exercises disconnected and missing-wallet recovery; wrong/unknown-chain addition with exact handoff parameters; funded claim and cooldown; zero/partial pools and the exact cooldown boundary; explicit donation approvals/finality; pagination; six-decimal and unsupported tokens; invalid addresses and excess precision; signature rejection; buy quotes and native router value; both sell permissions; failing router simulation before signing; expired/edited quotes; account changes/disconnection; RPC errors, wrong chain and missing code; corrupt ABI rejection; long symbols; and submitted-transaction timeout recovery. Mock sends are intercepted within the test process. No test accesses wallet secrets or broadcasts.

## Six-domain review

| Domain | Coverage and evidence | Limits |
| --- | --- | --- |
| Accessibility — Checked | Native buttons/inputs/details, persistent labels, linked validation, skip link, one main/h1, text statuses, 44px buttons/48px fields, focus styles, keyboard-only donation flow, automated axe scan, reduced-motion behavior. | No screen reader, switch control, physical touch target test or native browser zoom. Focus screenshot covers a representative state, not every possible background. |
| Layout — Checked | Source order/grouping, shared alignment, two-column to stacked layout, screenshots, five widths, long-symbol reflow and text enlargement. Overflow finding fixed below. | RTL, translated strings and physical devices not verified. The product ships English only. |
| Writing — Checked | Plain action labels, token units, final donations, explicit approvals, empty-pool recovery, test-only/multi-address warning, token trust and transfer-fee text. Network/errors state recovery actions. | Arbitrary token revert text can remain technical; details are capped for readability. |
| Typography — Checked | System font stack, descending headings, 16px inputs, tabular numbers, exact minimum receive, long content wrapping. Donation-unit wrap finding fixed. | Browser system-font rendering may vary; no custom font-loading claim. |
| Colors — Checked | Semantic source tokens, rendered foreground/background measurements and axe. The final report records 10.91:1 heading/page, 5.00:1 intro/page, 4.56:1 secondary copy/claim surface, 9.88:1 primary button and 5.43:1 donation footnote/surface. | These are sampled actual pairs, not an exhaustive certification of every hover/disabled/forced-color combination. No alternate theme exists. |
| UI — Checked | Loading, unavailable, empty, disabled, pending, confirmed and failed states; native disclosure; explicit transaction link and receipt recovery; hover-only styles and restrained 120ms motion. | No 10%-speed animation-panel replay. Modals, drag interactions, theme transitions and autoplay are not applicable. |

## Findings, fixes and rechecks

| Severity / source | Evidence and impact | Correction and recheck |
| --- | --- | --- |
| Medium — `web/src/style.css:496` | Initial rendered desktop/mobile evidence split the short DRIP suffix into “DRI” and “P” because the input consumed the flex row. | Input now grows into remaining space with zero base width; suffix retains its natural width. A browser assertion checks one-line suffix height. Final screenshots were inspected. |
| Medium — `web/src/style.css:125` | A 40-character token symbol caused horizontal overflow at 320px in the regression test. | Shared `overflow-wrap: anywhere` plus shrinkable token/grid children. The same long-symbol test and all five widths pass. |
| Medium — `web/src/chain.ts:31` | Source review found that six-place display truncation could show a tiny positive balance as zero. | Values below display precision show `<0.000001`; the exact minimum-receive field remains unrounded. Added explicit unit assertions. |
| High — `web/src/App.tsx:320` | Source review found that a confirmation timeout could return controls to a reusable state even though the transaction had been submitted. | A pending-review gate blocks further sends until Check transaction obtains a receipt. The browser advances mocked time beyond 180 seconds and verifies blocking and recovery without a second send. State is session-local; reload behavior is documented. |
| Medium — `web/src/App.tsx:493` | Source review found that a quote could age past its 60-second limit during verification/simulation. | Quote age is checked again immediately before signing, after simulation and wallet checks. The browser checks expiry disables swaps and input edits invalidate quotes. The precise delayed-simulation branch was reviewed, not separately timed in the browser. |

No unresolved observed functional or rendered defect remains within these checked states. The root-design-file path conflict remains as explicitly documented above.

## Live-chain scope and remaining limits

At Sepolia block 11791649, the worker recorded chain ID 11155111, nonempty LaunchToken/TokenFaucet runtimes of 1,722/2,992 bytes, the expected featured token and a zero DRIP faucet balance. A pinned `eth_call` to the supplied quoter for 0.001 ETH returned `49627085152468411915572` DRIP minor units, with gas estimate 87366. This is historical test evidence, not a current rate or financial representation. The code/balance batch used contemporaneous latest reads; the quote itself used the recorded block number.

Actual wallet-extension UX, real approval/claim/donation/swap inclusion, live slippage outcomes, fees and adversarial ERC-20 behavior were not exercised with funds. They are not established by the read-only RPC check or mocks. No public site, CID, named entrypoint, control-plane HTTP integrity check or configured-RPC publication gate has run as part of this worker assignment. Publication is subsequent work.

## Delivery

Frontend source/export/evidence are complete for the authorized paths, with the root `DESIGN.md` path exception and the testing limitations above. A local commit in the provided workspace is blocked: `git add` failed because `.git/index.lock` cannot be created on the read-only Git filesystem. The files remain in the working tree for the network to collect; no claim that this workspace was committed is made. The source, lockfile, implementation-derived runtime ABIs, final deployment manifest and all static assets are included. Only `web/`, `dist/` and `docs/` are submitted; the sole added ignore file is the explicitly allowed `web/.gitignore`. Dependency trees, npm caches, browser binaries and scratch files are excluded. The final export contains 8 files (7 inventoried assets plus the manifest), totaling 627,491 bytes. The full prospective Git submission bundle is below 1 MiB, comfortably under the 8 MiB limit. The final packaging check uses a disposable clone under `test/scratch/submission-repo`, copies the deliverable paths there, commits that isolated snapshot, and creates `test/scratch/frontend.bundle` with `git bundle create --all`. Its complete history-plus-deliverable size is checked against 8,388,608 bytes. This validates prospective submission size; it does not alter or commit the original read-only Git metadata. The scratch checkout and bundle are not submitted.
