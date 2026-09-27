import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { abiHash } from "../src/config.ts";
const root = fileURLToPath(new URL("../../", import.meta.url));
const handoff = JSON.parse(
  await readFile(new URL("../config/handoff.json", import.meta.url), "utf8"),
);
const network = JSON.parse(
  await readFile(new URL("../config/network.json", import.meta.url), "utf8"),
);
if (
  handoff.chainId !== network.network.chainId ||
  network.walletAddChain.chainId !== `0x${handoff.chainId.toString(16)}`
)
  throw Error("Network mismatch");
const dist = path.join(root, "dist");
await mkdir(path.join(dist, "abi"), { recursive: true });
const contracts = [];
for (const c of handoff.contracts) {
  const relative = `docs/abi/${c.name}.json`;
  const bytes = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:${relative}`],
    { cwd: root },
  );
  if (!bytes.equals(await readFile(path.join(root, relative))))
    throw Error(`Local ABI changed: ${c.name}`);
  const abi = JSON.parse(bytes);
  if (!Array.isArray(abi) || abiHash(abi) !== c.abiHash)
    throw Error(`Pinned ABI hash mismatch: ${c.name}`);
  await writeFile(path.join(dist, `abi/${c.name}.json`), bytes);
  contracts.push({
    name: c.name,
    address: c.address,
    abiHash: c.abiHash,
    abiPath: `abi/${c.name}.json`,
  });
  console.log(`Verified pinned ABI ${c.name}: ${c.abiHash}`);
}
const assets = [];
async function inventory(dir, prefix = "") {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const rel = prefix + entry.name;
    if (entry.isSymbolicLink()) throw Error("Symlinks are not export assets");
    if (entry.isDirectory())
      await inventory(path.join(dir, entry.name), rel + "/");
    else if (rel !== "imd-deployment.json") {
      if ((await stat(path.join(dir, entry.name))).size > 8388608)
        throw Error("Oversize asset");
      assets.push({
        path: rel,
        sha256: createHash("sha256")
          .update(await readFile(path.join(dir, entry.name)))
          .digest("hex"),
      });
    }
  }
}
await inventory(dist);
if (assets.length > 128) throw Error("Too many assets");
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets,
  network: network.network,
  walletAddChain: network.walletAddChain,
  pool: handoff.manifest.pool,
};
await writeFile(
  path.join(dist, "imd-deployment.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`Manifest written last: ${assets.length} hashed assets.`);
