# Vendored dependencies

These are ordinary source files, not submodules. Builds and tests do not fetch packages.

| Dependency | Pinned release | Included files |
| --- | --- | --- |
| [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts/tree/v5.1.0) | v5.1.0 | Unmodified transitive import closure for ERC20, SafeERC20 and ReentrancyGuard, plus MIT license |
| [Forge Std](https://github.com/foundry-rs/forge-std/tree/v1.9.6) | v1.9.6 | Unmodified `src/` and upstream MIT/Apache-2.0 licenses |

[versions.json](versions.json) records upstream archive URLs, SHA-256 digests, versions and included file counts. The archives were read selectively; upstream repositories, tests, build outputs and package manager directories are not required. Remappings resolve exclusively to these local files.
