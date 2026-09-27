import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeAbiParameters, parseAbiParameters, zeroAddress } from "viem";
import type { EIP1193Provider } from "viem";
import { abiHash, canonical, safePath, switchNetwork } from "../src/config.ts";
import type { Config } from "../src/config.ts";
import { amount, buildSwap, poolKey, display } from "../src/chain.ts";
const deployment = JSON.parse(
  readFileSync(
    new URL("../../dist/imd-deployment.json", import.meta.url),
    "utf8",
  ),
);
const handoff = JSON.parse(
  readFileSync(new URL("../config/handoff.json", import.meta.url), "utf8"),
);
const network = JSON.parse(
  readFileSync(new URL("../config/network.json", import.meta.url), "utf8"),
);
const config = {
  deployment,
  contracts: Object.fromEntries(
    deployment.contracts.map((c: any) => [c.name, c]),
  ),
} as Config;
test("manifest binds the entire handoff, canonical ABIs and every exported byte", () => {
  for (const k of ["launchId", "chainId", "sourceCommit", "attestationHash"])
    assert.deepEqual(deployment[k], handoff[k]);
  assert.deepEqual(deployment.network, network.network);
  assert.deepEqual(deployment.walletAddChain, network.walletAddChain);
  assert.deepEqual(
    deployment.contracts.map(({ name, address, abiHash }: any) => ({
      name,
      address,
      abiHash,
    })),
    handoff.contracts.map(({ name, address, abiHash }: any) => ({
      name,
      address,
      abiHash,
    })),
  );
  for (const c of deployment.contracts)
    assert.equal(
      abiHash(
        JSON.parse(
          readFileSync(
            new URL(`../../dist/${c.abiPath}`, import.meta.url),
            "utf8",
          ),
        ),
      ),
      c.abiHash,
    );
  const root = new URL("../../dist/", import.meta.url);
  const files: string[] = [];
  function walk(url: URL, prefix = "") {
    for (const name of readdirSync(url)) {
      const child = new URL(name, url);
      if (statSync(child).isDirectory())
        walk(new URL(name + "/", url), prefix + name + "/");
      else if (prefix + name !== "imd-deployment.json")
        files.push(prefix + name);
    }
  }
  walk(root);
  assert.deepEqual(
    deployment.assets.map((x: any) => x.path).sort(),
    files.sort(),
  );
  assert.ok(files.length <= 128);
  for (const a of deployment.assets) {
    assert.ok(safePath(a.path));
    const data = readFileSync(new URL(a.path, root));
    assert.ok(data.length <= 8388608);
    assert.equal(createHash("sha256").update(data).digest("hex"), a.sha256);
  }
});
test("canonical hashing sorts keys recursively, preserving ABI order", () => {
  assert.equal(
    canonical({ b: [{ z: 1, a: 2 }], a: 3 }),
    '{"a":3,"b":[{"a":2,"z":1}]}',
  );
  assert.equal(abiHash([{ b: 2, a: 1 }]), abiHash([{ a: 1, b: 2 }]));
});
test("amount parsing rejects rounding, exponents, negatives, zero and uint128 overflow", () => {
  assert.equal(amount("1.000001", 6), 1000001n);
  assert.equal(amount("100", 18), 100n * 10n ** 18n);
  for (const v of [
    "0",
    "0.0000001",
    "1e2",
    "-1",
    "+1",
    "NaN",
    "1.",
    " 2",
    "01",
    "Infinity",
  ])
    assert.throws(() => amount(v, 6));
  assert.throws(() => amount((1n << 128n).toString(), 0, (1n << 128n) - 1n));
});
test("paths reject traversal, absolute paths and URLs", () => {
  for (const p of ["../x", "/x", "a/../b", "https://bad/a", "a//b", "a\\b"])
    assert.equal(safePath(p), false);
  assert.equal(safePath("abi/Token.json"), true);
});
test("buy and sell encode v4 actions, currencies, minima and value exactly", () => {
  for (const buy of [true, false]) {
    const encoded = buildSwap(config, buy, 123n, 99n, 123456n);
    assert.equal(encoded.args[0], "0x10");
    assert.equal(encoded.args[2], 123456n);
    assert.equal(encoded.value, buy ? 123n : 0n);
    const [actions, params] = decodeAbiParameters(
      parseAbiParameters("bytes,bytes[]"),
      encoded.args[1][0],
    );
    assert.equal(actions, "0x060c0f");
    assert.equal(params.length, 3);
    const [swap] = decodeAbiParameters(
      parseAbiParameters(
        "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)",
      ),
      params[0],
    );
    assert.equal(swap.zeroForOne, buy);
    assert.equal(swap.amountIn, 123n);
    assert.equal(swap.amountOutMinimum, 99n);
    assert.equal(swap.poolKey.hooks, zeroAddress);
    assert.equal(swap.poolKey.fee, deployment.pool.fee);
    assert.equal(swap.poolKey.tickSpacing, deployment.pool.tickSpacing);
    const [input, n] = decodeAbiParameters(
      parseAbiParameters("address,uint256"),
      params[1],
    );
    const [output, min] = decodeAbiParameters(
      parseAbiParameters("address,uint256"),
      params[2],
    );
    assert.equal(
      input.toLowerCase(),
      (buy ? zeroAddress : config.contracts.LaunchToken.address).toLowerCase(),
    );
    assert.equal(
      output.toLowerCase(),
      (buy ? config.contracts.LaunchToken.address : zeroAddress).toLowerCase(),
    );
    assert.equal(n, 123n);
    assert.equal(min, 99n);
  }
  assert.equal(poolKey(config).currency0, zeroAddress);
});
test("unknown chain is added with exact handoff parameters then switched again", async () => {
  const calls: any[] = [];
  const provider = {
    request: async (p: any) => {
      calls.push(p);
      if (calls.length === 1) throw { code: 4902 };
      return null;
    },
  } as unknown as EIP1193Provider;
  await switchNetwork(provider, deployment);
  assert.deepEqual(
    calls.map((x) => x.method),
    [
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ],
  );
  assert.deepEqual(calls[1].params, [network.walletAddChain]);
});
test("wallet rejection does not add a chain or retry automatically", async () => {
  let count = 0;
  const provider = {
    request: async () => {
      count++;
      throw { code: 4001 };
    },
  } as unknown as EIP1193Provider;
  await assert.rejects(switchNetwork(provider, deployment));
  assert.equal(count, 1);
});

test("small nonzero balances are not displayed as zero", () => {
  assert.equal(display(1n, 18), "<0.000001");
  assert.equal(display(1000000000000n, 18), "0.000001");
  assert.equal(display(1000001n, 6), "1.000001");
  assert.equal(display(0n, 18), "0");
});
