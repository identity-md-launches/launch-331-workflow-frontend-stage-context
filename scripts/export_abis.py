#!/usr/bin/env python3
"""Export the two deployable contracts' ABIs, or check that committed exports match."""

import argparse
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    mismatches = []
    for name in ("LaunchToken", "TokenFaucet"):
        result = subprocess.run(
            ["forge", "inspect", f"src/{name}.sol:{name}", "abi", "--json"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
        content = json.dumps(json.loads(result.stdout), indent=2) + "\n"
        path = root / "docs" / "abi" / f"{name}.json"
        if args.check:
            if not path.exists() or path.read_text() != content:
                mismatches.append(str(path.relative_to(root)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
            print(f"Exported {path.relative_to(root)}")
    if mismatches:
        raise SystemExit("ABI exports differ: " + ", ".join(mismatches))
    if args.check:
        print("ABI exports match the compiled contracts.")


if __name__ == "__main__":
    main()
