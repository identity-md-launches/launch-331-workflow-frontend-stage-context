import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  decodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  toHex,
  zeroAddress,
} from "viem";
const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = path.join(root, "dist");
const evidence = path.join(root, "docs/frontend");
await mkdir(evidence, { recursive: true });
const d = JSON.parse(
  await readFile(path.join(dist, "imd-deployment.json"), "utf8"),
);
const token = d.contracts.find((c) => c.name === "LaunchToken");
const faucet = d.contracts.find((c) => c.name === "TokenFaucet");
const tokenAbi = JSON.parse(
  await readFile(path.join(dist, token.abiPath), "utf8"),
);
const faucetAbi = JSON.parse(
  await readFile(path.join(dist, faucet.abiPath), "utf8"),
);
const permitAbi = parseAbi([
  "function allowance(address,address,address) view returns(uint160,uint48,uint48)",
  "function approve(address,address,uint160,uint48)",
]);
const quoterAbi = parseAbi([
  "struct PoolKey {address currency0;address currency1;uint24 fee;int24 tickSpacing;address hooks;}",
  "struct Quote {PoolKey poolKey;bool zeroForOne;uint128 exactAmount;bytes hookData;}",
  "function quoteExactInputSingle(Quote) returns(uint256,uint256)",
]);
const routerAbi = parseAbi(["function execute(bytes,bytes[],uint256) payable"]);
const unit = 10n ** 18n;
const account = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const six = "0x6666666666666666666666666666666666666666";
const unsupported = "0x7777777777777777777777777777777777777777";
const hash = "0x" + "a".repeat(64);
const blockHash = "0x" + "b".repeat(64);
const report = {
  export: "dist/ served at /preview/",
  startedAt: new Date().toISOString(),
  mocked: true,
  sourceCommit: d.sourceCommit,
  manifestSha256: createHash("sha256")
    .update(await readFile(path.join(dist, "imd-deployment.json")))
    .digest("hex"),
  realTransactions: 0,
  checks: [],
  screenshots: [],
  consoleErrors: [],
  browserConsoleErrors: [],
  viewports: [1440, 850, 660, 390, 320],
  textEnlargement: "200% CSS root font size; not native browser zoom",
  resourceFailures: [],
};
const server = createServer(async (req, res) => {
  try {
    const raw = new URL(req.url, "http://localhost").pathname;
    const relative = raw.startsWith("/preview/") ? raw.slice(9) : "";
    if (!raw.startsWith("/preview/") || relative.includes("..")) {
      res.writeHead(404).end();
      return;
    }
    const file = path.join(dist, relative || "index.html");
    const data = await readFile(file);
    const ext = path.extname(file);
    res.setHeader(
      "content-type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
      }[ext] || "application/octet-stream",
    );
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "0.0.0.0", r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
await mkdir(path.join(root, "test/scratch/browser"), { recursive: true });
await writeFile(
  path.join(root, "test/scratch/browser/preview.json"),
  JSON.stringify({ url }) + "\n",
);
console.log("PREVIEW " + url);
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (existsSync(
      "/opt/imd-tools/ms-playwright/chromium_headless_shell-1246/chrome-headless-shell-linux64/chrome-headless-shell",
    )
      ? "/opt/imd-tools/ms-playwright/chromium_headless_shell-1246/chrome-headless-shell-linux64/chrome-headless-shell"
      : undefined),
  headless: true,
  args: ["--no-sandbox"],
});
function fixture(options = {}) {
  const f = {
    pool: 500n * unit,
    balance: 1000n * unit,
    allowance: 0n,
    tokenPermit: 0n,
    permit: 0n,
    expiration: 0,
    next: 0n,
    count: 7n,
    donated: 0n,
    now: BigInt(Math.floor(Date.now() / 1000)),
    sends: [],
    calls: [],
    missingCode: false,
    wrongRpc: false,
    revertExecute: false,
    rejectSend: false,
    rpcError: false,
    ...options,
  };
  const donors = Array.from(
    { length: Number(f.count) },
    (_, i) => "0x" + (1000 + i).toString(16).padStart(40, "0"),
  );
  const abiFor = (to) =>
    to.toLowerCase() === faucet.address
      ? faucetAbi
      : to.toLowerCase() === d.network.uniswapV4.permit2
        ? permitAbi
        : to.toLowerCase() === d.network.uniswapV4.quoter
          ? quoterAbi
          : to.toLowerCase() === d.network.uniswapV4.universalRouter
            ? routerAbi
            : tokenAbi;
  f.rpc = async ({ method, params = [] }) => {
    f.calls.push({ method, params });
    if (f.rpcError) throw { code: -32000, message: "Mock RPC unavailable" };
    if (method === "eth_chainId") return toHex(f.wrongRpc ? 1 : d.chainId);
    if (method === "eth_getCode") return f.missingCode ? "0x" : "0x60006000";
    if (method === "eth_blockNumber") return "0xb71b00";
    if (method === "eth_getBalance") return toHex(10n * unit);
    if (method === "eth_getBlockByNumber")
      return {
        number: "0xb71b00",
        hash: blockHash,
        parentHash: blockHash,
        timestamp: toHex(f.now),
        gasLimit: "0x1c9c380",
        gasUsed: "0x0",
        baseFeePerGas: "0x1",
        difficulty: "0x0",
        totalDifficulty: "0x0",
        extraData: "0x",
        size: "0x1",
        transactions: [],
        uncles: [],
        miner: zeroAddress,
        nonce: "0x0000000000000000",
        logsBloom: "0x" + "0".repeat(512),
        receiptsRoot: blockHash,
        stateRoot: blockHash,
        transactionsRoot: blockHash,
        mixHash: blockHash,
      };
    if (method === "eth_getTransactionReceipt" && f.receiptPending) return null;
    if (method === "eth_getTransactionReceipt")
      return {
        transactionHash: params[0],
        transactionIndex: "0x0",
        blockHash,
        blockNumber: "0xb71b00",
        from: account,
        to: f.sends.at(-1)?.to || faucet.address,
        cumulativeGasUsed: "0x5208",
        gasUsed: "0x5208",
        effectiveGasPrice: "0x1",
        contractAddress: null,
        logs: [],
        logsBloom: "0x" + "0".repeat(512),
        status: "0x1",
        type: "0x2",
      };
    if (method === "eth_call" || method === "eth_sendTransaction") {
      const request = params[0];
      const abi = abiFor(request.to);
      const decoded = decodeFunctionData({ abi, data: request.data });
      const { functionName: fn, args = [] } = decoded;
      const custom = request.to.toLowerCase() === six;
      const decimals = custom ? 6 : 18;
      const u = 10n ** BigInt(decimals);
      if (method === "eth_sendTransaction") {
        if (f.rejectSend) {
          f.rejectSend = false;
          throw { code: 4001, message: "User rejected request" };
        }
        f.sends.push({
          to: request.to.toLowerCase(),
          fn,
          args,
          value: request.value,
        });
        if (fn === "claim") {
          const paid = f.pool < 100n * unit ? f.pool : 100n * unit;
          f.pool -= paid;
          f.balance += paid;
          f.next = f.now + 86400n;
        }
        if (fn === "donate") {
          f.pool += args[1];
          f.balance -= args[1];
          f.donated += args[1];
          f.allowance -= args[1];
        }
        if (fn === "approve") {
          if (request.to.toLowerCase() === d.network.uniswapV4.permit2) {
            f.permit = args[2];
            f.expiration = args[3];
          } else if (args[0].toLowerCase() === faucet.address)
            f.allowance = args[1];
          else f.tokenPermit = args[1];
        }
        return "0x" + f.sends.length.toString(16).padStart(64, "0");
      }
      let result;
      if (request.to.toLowerCase() === unsupported && fn === "decimals")
        throw { code: 3, message: "execution reverted: unsupported decimals" };
      if (fn === "featuredToken") result = token.address;
      else if (fn === "symbol") result = f.symbol || (custom ? "SIX" : "DRIP");
      else if (fn === "decimals") result = decimals;
      else if (fn === "balanceOf")
        result =
          args[0].toLowerCase() === faucet.address
            ? custom
              ? 150n * u
              : f.pool
            : custom
              ? 200n * u
              : f.balance;
      else if (fn === "claimAmount") result = 100n * u;
      else if (fn === "nextClaimAt") result = custom ? 0n : f.next;
      else if (fn === "donorCount") result = f.count;
      else if (fn === "donors")
        result = donors.slice(Number(args[1]), Number(args[1] + args[2]));
      else if (fn === "donatedBy")
        result = args[1].toLowerCase() === account ? f.donated : 125n * u;
      else if (fn === "allowance")
        result =
          request.to.toLowerCase() === d.network.uniswapV4.permit2
            ? [f.permit, f.expiration, 0]
            : args[1].toLowerCase() === faucet.address
              ? f.allowance
              : f.tokenPermit;
      else if (fn === "approve")
        result =
          request.to.toLowerCase() === d.network.uniswapV4.permit2
            ? undefined
            : true;
      else if (fn === "claim") {
        if (f.pool === 0n)
          throw { code: 3, message: "execution reverted: EmptyFaucet" };
        if (f.next > f.now)
          throw { code: 3, message: "execution reverted: CooldownActive" };
        result = f.pool < 100n * unit ? f.pool : 100n * unit;
      } else if (fn === "donate") result = args[1];
      else if (fn === "quoteExactInputSingle") result = [200n * unit, 120000n];
      else if (fn === "execute") {
        if (f.revertExecute)
          throw { code: 3, message: "execution reverted: V4TooLittleReceived" };
        return "0x";
      } else throw Error(`Unhandled ${fn}`);
      return encodeFunctionResult({ abi, functionName: fn, result });
    }
    throw Error(`Unhandled RPC ${method}`);
  };
  return f;
}
async function setup(options = {}) {
  const f = fixture(options);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => report.consoleErrors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      report.browserConsoleErrors.push(message.text());
  });
  page.on("requestfailed", (r) => {
    if (r.url().startsWith(url))
      report.resourceFailures.push(r.url() + ": " + r.failure()?.errorText);
  });
  await page.route(/https:\/\//, async (route) => {
    try {
      const body = route.request().postDataJSON();
      const call = async (r) => {
        try {
          return { id: r.id, jsonrpc: "2.0", result: await f.rpc(r) };
        } catch (e) {
          return {
            id: r.id,
            jsonrpc: "2.0",
            error: { code: e.code || -32000, message: e.message || String(e) },
          };
        }
      };
      const response = Array.isArray(body)
        ? await Promise.all(body.map(call))
        : await call(body);
      await route.fulfill({ json: response });
    } catch {
      await route.abort();
    }
  });
  if (!options.noWallet) {
    await page.exposeFunction("__walletRpc", async (args) => f.rpc(args));
    await page.addInitScript(
      ({ account, chain, unknown }) => {
        const listeners = {};
        let connected = false;
        let chainId = chain;
        let missing = unknown;
        const requests = [];
        const emit = (e, v) => (listeners[e] || []).forEach((cb) => cb(v));
        window.__mock = {
          requests,
          setAccount: (a) => {
            account = a;
            emit("accountsChanged", a ? [a] : []);
          },
          setChain: (c) => {
            chainId = c;
            emit("chainChanged", c);
          },
        };
        window.ethereum = {
          isMetaMask: true,
          on: (e, cb) => {
            (listeners[e] ??= []).push(cb);
          },
          removeListener: (e, cb) => {
            listeners[e] = (listeners[e] || []).filter((x) => x !== cb);
          },
          request: async (p) => {
            requests.push(p);
            if (p.method === "eth_accounts") return connected ? [account] : [];
            if (p.method === "eth_requestAccounts") {
              connected = true;
              return [account];
            }
            if (p.method === "eth_chainId") return chainId;
            if (p.method === "wallet_switchEthereumChain") {
              if (missing) throw { code: 4902, message: "Unknown chain" };
              chainId = p.params[0].chainId;
              emit("chainChanged", chainId);
              return null;
            }
            if (p.method === "wallet_addEthereumChain") {
              missing = false;
              return null;
            }
            if (p.method === "wallet_requestPermissions")
              return [{ parentCapability: "eth_accounts" }];
            if (p.method === "wallet_revokePermissions") return null;
            return window.__walletRpc(p);
          },
        };
      },
      {
        account,
        chain: options.wrongWallet ? "0x1" : toHex(d.chainId),
        unknown: !!options.wrongWallet,
      },
    );
  }
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Your next drop" }),
  ).toBeVisible();
  async function loaded() {
    await expect(page.getByText(/Updated at block/)).toBeVisible({
      timeout: 15000,
    });
  }
  async function connect() {
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Disconnect", exact: true }),
    ).toBeVisible();
    if (
      !options.wrongWallet &&
      !options.wrongRpc &&
      !options.missingCode &&
      !options.rpcError
    )
      await loaded();
  }
  return { f, page, context, loaded, connect };
}
async function check(name, fn) {
  if (process.env.CHECK_FILTER && !name.includes(process.env.CHECK_FILTER))
    return;
  try {
    await fn();
    report.checks.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    report.checks.push({ name, passed: false, error: e.stack });
    console.error("FAIL " + name + " " + e.message);
    throw e;
  }
}
let failure;
try {
  await check(
    "disconnected and missing wallet: no transaction; clear recovery",
    async () => {
      const t = await setup({ noWallet: true });
      await t.loaded();
      await expect(
        t.page.getByRole("button", { name: "1. Approve amount", exact: true }),
      ).toBeDisabled();
      await t.page.getByRole("button", { name: "Connect to claim" }).click();
      await expect(t.page.getByRole("alert")).toContainText(
        "No browser wallet found",
      );
      if (t.f.sends.length) throw Error("unexpected send");
      await t.context.close();
    },
  );
  await check(
    "unknown wallet chain: add exact network, switch, then enable claim",
    async () => {
      const t = await setup({ wrongWallet: true });
      await t.connect();
      await expect(
        t.page.getByRole("button", { name: "Claim DRIP", exact: true }),
      ).toBeDisabled();
      await t.page.getByRole("button", { name: "Switch to Sepolia" }).click();
      await expect(
        t.page.getByRole("button", { name: "Claim DRIP", exact: true }),
      ).toBeEnabled();
      const calls = await t.page.evaluate(() => window.__mock.requests);
      expect(
        calls.find((c) => c.method === "wallet_addEthereumChain").params,
      ).toEqual([d.walletAddChain]);
      await t.context.close();
    },
  );
  await check(
    "funded claim, cooldown, donation approvals, finality and donor pagination",
    async () => {
      const t = await setup();
      await t.connect();
      await expect(
        t.page.getByRole("button", { name: "Claim DRIP", exact: true }),
      ).toBeEnabled();
      await expect(t.page.locator(".primary")).toHaveCSS(
        "background-color",
        "rgb(23, 75, 58)",
      );
      report.contrast = await t.page.evaluate(() => {
        const rgb = (s) =>
          s
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number);
        const lum = (c) =>
          c
            .map((x) => {
              x /= 255;
              return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            })
            .reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
        return [
          "h1",
          ".intro",
          ".claim-card .card-copy",
          ".primary",
          ".donate-card .footnote",
        ].map((selector) => {
          const el = document.querySelector(selector);
          const style = getComputedStyle(el);
          let bg = style.backgroundColor;
          let parent = el;
          while (bg === "rgba(0, 0, 0, 0)" && parent.parentElement) {
            parent = parent.parentElement;
            bg = getComputedStyle(parent).backgroundColor;
          }
          const l1 = lum(rgb(style.color)),
            l2 = lum(rgb(bg));
          return {
            selector,
            foreground: style.color,
            background: bg,
            ratio: Number(
              ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(
                2,
              ),
            ),
          };
        });
      });
      for (const pair of report.contrast)
        expect(pair.ratio).toBeGreaterThanOrEqual(4.5);
      await t.page
        .getByRole("button", { name: "Claim DRIP", exact: true })
        .click();
      await expect(t.page.getByRole("status")).toContainText("Claim confirmed");
      await expect(
        t.page.getByRole("button", { name: "Claim DRIP", exact: true }),
      ).toBeDisabled();
      expect(t.f.sends[0].fn).toBe("claim");
      await t.page.getByLabel("Amount to donate").fill("10");
      await expect(
        t.page.getByRole("button", { name: "2. Donate DRIP", exact: true }),
      ).toBeDisabled();
      await t.page
        .getByRole("button", { name: "1. Approve amount", exact: true })
        .click();
      await expect(
        t.page.getByRole("button", { name: "1. Approved", exact: true }),
      ).toBeVisible();
      expect(t.f.sends[1].args[0].toLowerCase()).toBe(faucet.address);
      expect(t.f.sends[1].args[1]).toBe(10n * unit);
      await expect(
        t.page.getByRole("button", { name: "2. Donate DRIP", exact: true }),
      ).toBeDisabled();
      await t.page.getByLabel("I understand donations are final").check();
      await t.page
        .getByRole("button", { name: "2. Donate DRIP", exact: true })
        .click();
      await expect(t.page.getByRole("status")).toContainText(
        "Donation confirmed",
      );
      expect(t.f.sends[2].fn).toBe("donate");
      await t.page.getByRole("button", { name: "Next donors" }).click();
      await expect(t.page.getByText("Page 2 of 2")).toBeVisible();
      await expect(
        t.page.getByRole("button", { name: "Next donors" }),
      ).toBeDisabled();
      await t.page.getByRole("button", { name: "Previous donors" }).click();
      await expect(t.page.getByText("Page 1 of 2")).toBeVisible();
      await t.page.screenshot({
        path: path.join(evidence, "desktop.png"),
        fullPage: true,
      });
      report.screenshots.push("docs/frontend/desktop.png");
      const axe = await new AxeBuilder({ page: t.page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      report.accessibility = {
        violations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target),
        })),
      };
      expect(axe.violations).toEqual([]);
      for (const width of [850, 660, 390, 320]) {
        await t.page.setViewportSize({ width, height: 900 });
        expect(
          await t.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (width === 390) {
          await t.page.screenshot({
            path: path.join(evidence, "mobile.png"),
            fullPage: true,
          });
          report.screenshots.push("docs/frontend/mobile.png");
        }
      }
      await t.page.emulateMedia({ reducedMotion: "reduce" });
      await t.page.keyboard.press("Control+Home");
      await t.page.keyboard.press("Tab");
      const focus = await t.page.evaluate(() => ({
        tag: document.activeElement.tagName,
        outline: getComputedStyle(document.activeElement).outlineStyle,
      }));
      expect(focus.outline).toBe("solid");
      await t.page.setViewportSize({ width: 1440, height: 1100 });
      await t.page.evaluate(
        () => (document.documentElement.style.fontSize = "200%"),
      );
      expect(
        await t.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await t.page.evaluate(
        () => (document.documentElement.style.fontSize = ""),
      );
      await t.context.close();
    },
  );
  await check("keyboard-only connection and donation flow", async () => {
    const t = await setup();
    await t.loaded();
    await t.page.keyboard.press("Tab");
    await expect(
      t.page.getByRole("link", { name: "Skip to faucet" }),
    ).toBeFocused();
    await t.page.screenshot({
      path: path.join(evidence, "keyboard-focus.png"),
    });
    report.screenshots.push("docs/frontend/keyboard-focus.png");
    await t.page.keyboard.press("Tab");
    await t.page.keyboard.press("Tab");
    await expect(
      t.page.getByRole("button", { name: "Connect wallet", exact: true }),
    ).toBeFocused();
    await t.page.keyboard.press("Enter");
    await expect(
      t.page.getByRole("button", { name: "Disconnect", exact: true }),
    ).toBeVisible();
    await t.loaded();
    let found = false;
    for (let i = 0; i < 25; i++) {
      await t.page.keyboard.press("Tab");
      if (
        await t.page
          .getByLabel("Amount to donate")
          .evaluate((e) => e === document.activeElement)
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    await t.page.keyboard.type("5");
    await t.page.keyboard.press("Tab");
    await expect(
      t.page.getByLabel("I understand donations are final"),
    ).toBeFocused();
    await t.page.keyboard.press("Space");
    await t.page.keyboard.press("Tab");
    await expect(
      t.page.getByRole("button", { name: "1. Approve amount", exact: true }),
    ).toBeFocused();
    await t.page.keyboard.press("Enter");
    await expect(
      t.page.getByRole("button", { name: "1. Approved", exact: true }),
    ).toBeVisible();
    await t.page.keyboard.press("Tab");
    await expect(
      t.page.getByRole("button", { name: "2. Donate DRIP", exact: true }),
    ).toBeFocused();
    await t.page.keyboard.press("Enter");
    await expect(t.page.getByRole("status")).toContainText(
      "Donation confirmed",
    );
    expect(t.f.sends.map((s) => s.fn)).toEqual(["approve", "donate"]);
    await t.context.close();
  });
  await check("empty, partial payout and cooldown exact boundary", async () => {
    for (const options of [
      { pool: 0n, count: 0n },
      { pool: 37n * unit },
      { next: BigInt(Math.floor(Date.now() / 1000)) },
    ]) {
      const t = await setup(options);
      await t.connect();
      const claim = t.page.getByRole("button", {
        name: "Claim DRIP",
        exact: true,
      });
      if (options.pool === 0n) {
        await expect(claim).toBeDisabled();
        await expect(
          t.page.getByText("The faucet is empty.", { exact: false }),
        ).toBeVisible();
      } else {
        await expect(claim).toBeEnabled();
        if (options.pool)
          await expect(t.page.locator(".claim-number")).toContainText("37");
      }
      await t.context.close();
    }
  });
  await check(
    "custom six-decimal token, invalid address and unsupported decimals",
    async () => {
      const t = await setup();
      await t.connect();
      await t.page.getByText("Change token", { exact: true }).click();
      await t.page.getByLabel("ERC-20 contract address").fill("wrong");
      await t.page
        .getByRole("button", { name: "Use token", exact: true })
        .click();
      await expect(t.page.locator("#token-error")).toContainText("valid");
      await t.page.getByLabel("ERC-20 contract address").fill(six);
      await t.page
        .getByRole("button", { name: "Use token", exact: true })
        .click();
      await expect(
        t.page.getByRole("button", { name: "Claim SIX", exact: true }),
      ).toBeEnabled();
      await t.page.getByText("Change token", { exact: true }).click();
      await t.page.getByLabel("Amount to donate").fill("1.0000001");
      await t.page
        .getByRole("button", { name: "1. Approve amount", exact: true })
        .click();
      await expect(t.page.locator("#donation-error")).toContainText(
        "6 decimal places",
      );
      await t.page.getByText("Change token", { exact: true }).click();
      await t.page.getByLabel("ERC-20 contract address").fill(unsupported);
      await t.page
        .getByRole("button", { name: "Use token", exact: true })
        .click();
      await expect(t.page.getByRole("alert")).toContainText(
        "unsupported decimals",
      );
      await expect(
        t.page.getByRole("button", { name: /^Claim / }),
      ).toBeDisabled();
      await t.context.close();
    },
  );
  await check(
    "wallet rejection preserves state and does not submit",
    async () => {
      const t = await setup({ rejectSend: true });
      await t.connect();
      await t.page
        .getByRole("button", { name: "Claim DRIP", exact: true })
        .click();
      await expect(t.page.getByRole("alert")).toContainText("Request declined");
      expect(t.f.sends.length).toBe(0);
      await expect(
        t.page.getByRole("button", { name: "Claim DRIP", exact: true }),
      ).toBeEnabled();
      await t.context.close();
    },
  );
  await check(
    "buy quote uses quoter simulation; swap uses router, native value and no approval",
    async () => {
      const t = await setup();
      await t.connect();
      await t.page.getByText("Swap ETH and DRIP", { exact: true }).click();
      await t.page.getByLabel("You pay (ETH)", { exact: true }).fill("0.01");
      await t.page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(t.page.getByText("Estimated receive")).toBeVisible();
      expect(t.f.sends.length).toBe(0);
      await t.page
        .getByRole("button", { name: "Swap ETH for DRIP", exact: true })
        .click();
      await expect(t.page.getByRole("status")).toContainText("Swap confirmed");
      expect(t.f.sends.length).toBe(1);
      expect(t.f.sends[0].to).toBe(d.network.uniswapV4.universalRouter);
      expect(BigInt(t.f.sends[0].value)).toBe(unit / 100n);
      expect(
        t.f.calls.some(
          (c) =>
            c.method === "eth_call" &&
            c.params[0].to.toLowerCase() === d.network.uniswapV4.quoter,
        ),
      ).toBe(true);
      await t.context.close();
    },
  );
  await check(
    "sell requires token-to-Permit2 and Permit2-to-router permissions",
    async () => {
      const t = await setup();
      await t.connect();
      await t.page.getByText("Swap ETH and DRIP", { exact: true }).click();
      await t.page.getByLabel("Swap direction").selectOption("sell");
      await t.page.getByLabel("You pay (DRIP)", { exact: true }).fill("1");
      await t.page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(
        t.page.getByRole("button", { name: "Swap DRIP for ETH", exact: true }),
      ).toBeDisabled();
      await t.page
        .getByRole("button", { name: "1. Approve Permit2", exact: true })
        .click();
      await expect(
        t.page.getByRole("button", { name: "1. Token approved", exact: true }),
      ).toBeVisible();
      expect(t.f.sends[0].args[0].toLowerCase()).toBe(
        d.network.uniswapV4.permit2,
      );
      await t.page
        .getByRole("button", { name: "2. Permit router", exact: true })
        .click();
      await expect(
        t.page.getByRole("button", {
          name: "2. Router permitted",
          exact: true,
        }),
      ).toBeVisible();
      expect(t.f.sends[1].to).toBe(d.network.uniswapV4.permit2);
      expect(t.f.sends[1].args[1].toLowerCase()).toBe(
        d.network.uniswapV4.universalRouter,
      );
      expect(t.f.sends[1].args[2]).toBe(unit);
      await t.page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(
        t.page.getByRole("button", { name: "Swap DRIP for ETH", exact: true }),
      ).toBeEnabled();
      await t.page
        .getByRole("button", { name: "Swap DRIP for ETH", exact: true })
        .click();
      await expect(t.page.getByRole("status")).toContainText("Swap confirmed");
      expect(BigInt(t.f.sends[2].value || "0x0")).toBe(0n);
      await t.context.close();
    },
  );
  await check(
    "reverting swap simulation blocks signing and quote input changes invalidate",
    async () => {
      const t = await setup({ revertExecute: true });
      await t.connect();
      await t.page.getByText("Swap ETH and DRIP", { exact: true }).click();
      await t.page.getByLabel("You pay (ETH)", { exact: true }).fill("0.01");
      await t.page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(
        t.page.getByRole("button", { name: "Swap ETH for DRIP", exact: true }),
      ).toBeEnabled();
      await t.page
        .getByRole("button", { name: "Swap ETH for DRIP", exact: true })
        .click();
      await expect(t.page.getByRole("alert")).toContainText(
        "V4TooLittleReceived",
      );
      expect(t.f.sends.length).toBe(0);
      await t.page.getByLabel("Slippage (%)").fill("1");
      await expect(
        t.page.getByRole("button", { name: "Swap ETH for DRIP", exact: true }),
      ).toBeDisabled();
      await t.context.close();
    },
  );
  await check(
    "quote expires after 60 seconds and cannot be signed",
    async () => {
      const t = await setup();
      await t.connect();
      await t.page.clock.install();
      await t.page.getByText("Swap ETH and DRIP", { exact: true }).click();
      await t.page.getByLabel("You pay (ETH)", { exact: true }).fill("0.01");
      await t.page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(
        t.page.getByRole("button", { name: "Swap ETH for DRIP", exact: true }),
      ).toBeEnabled();
      await t.page.clock.fastForward(61000);
      await expect(
        t.page.getByRole("button", { name: "Swap ETH for DRIP", exact: true }),
      ).toBeDisabled();
      await expect(
        t.page.getByText("Quote expired. Get a new quote before swapping."),
      ).toBeVisible();
      expect(t.f.sends.length).toBe(0);
      await t.context.close();
    },
  );
  await check(
    "long token symbols reflow at 320px; token suffix stays intact",
    async () => {
      const t = await setup({
        symbol: "VERYLONGTOKENNAMEWITHOUTSPACES123456789012",
      });
      await t.connect();
      await t.page.setViewportSize({ width: 320, height: 900 });
      const overflow = await t.page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
          .map((e) => ({
            tag: e.tagName,
            cls: e.className,
            text: e.textContent.slice(0, 80),
          })),
      );
      if (overflow.length) console.log("OVERFLOW", JSON.stringify(overflow));
      expect(
        await t.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await t.context.close();
      const u = await setup();
      await u.loaded();
      const box = await u.page.locator(".amount-input>span").boundingBox();
      const line = await u.page
        .locator(".amount-input>span")
        .evaluate((e) => parseFloat(getComputedStyle(e).lineHeight));
      expect(box.height).toBeLessThanOrEqual(line + 1);
      await u.context.close();
    },
  );
  await check(
    "submitted transaction timeout blocks resubmission until receipt is checked",
    async () => {
      const t = await setup({ receiptPending: true });
      await t.connect();
      await t.page.clock.install();
      await t.page
        .getByRole("button", { name: "Claim DRIP", exact: true })
        .click();
      await expect(t.page.getByRole("status")).toContainText(
        "Waiting for confirmation",
      );
      await t.page.clock.fastForward(181000);
      await expect(
        t.page.getByRole("button", { name: "Check transaction", exact: true }),
      ).toBeVisible();
      await expect(
        t.page.getByRole("button", { name: "1. Approve amount", exact: true }),
      ).toBeDisabled();
      expect(t.f.sends.length).toBe(1);
      t.f.receiptPending = false;
      await t.page
        .getByRole("button", { name: "Check transaction", exact: true })
        .click();
      await expect(t.page.getByRole("status")).toContainText(
        "Transaction confirmed",
      );
      await expect(
        t.page.getByRole("button", { name: "1. Approve amount", exact: true }),
      ).toBeEnabled();
      await t.context.close();
    },
  );
  await check(
    "account changes and disconnect invalidate eligibility and quote",
    async () => {
      const t = await setup();
      await t.connect();
      await t.page.evaluate((other) => window.__mock.setAccount(other), other);
      await expect(t.page.getByRole("link", { name: /0x2222/ })).toBeVisible();
      await t.page
        .getByRole("button", { name: "Disconnect", exact: true })
        .click();
      await expect(
        t.page.getByRole("button", { name: "Connect wallet", exact: true }),
      ).toBeVisible();
      await expect(
        t.page.getByRole("button", { name: "1. Approve amount", exact: true }),
      ).toBeDisabled();
      await t.context.close();
    },
  );
  await check(
    "RPC chain mismatch, missing code and unavailable RPC fail closed",
    async () => {
      for (const options of [
        { wrongRpc: true },
        { missingCode: true },
        { rpcError: true },
      ]) {
        const t = await setup(options);
        await t.connect();
        await expect(t.page.getByRole("alert")).toBeVisible({ timeout: 15000 });
        await expect(
          t.page.getByRole("button", { name: "Claim DRIP", exact: true }),
        ).toBeDisabled();
        await t.context.close();
      }
    },
  );
  await check(
    "tampered implementation ABI fails before mounting transaction controls",
    async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.route("**/abi/TokenFaucet.json", (r) =>
        r.fulfill({ json: [] }),
      );
      await page.goto(url);
      await expect(page.getByRole("alert")).toContainText(
        "ABI integrity check failed",
      );
      await expect(page.getByRole("button", { name: /Claim/ })).toHaveCount(0);
      await context.close();
    },
  );
} catch (e) {
  failure = e;
} finally {
  report.finishedAt = new Date().toISOString();
  if (
    report.consoleErrors.length ||
    report.browserConsoleErrors.length ||
    report.resourceFailures.length
  )
    failure ||= Error("Unexpected browser console or resource failure.");
  await writeFile(
    path.join(evidence, "interaction-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  if (process.env.INSPECT === "1") {
    console.log("Browser inspection preview available for 5 minutes: " + url);
    await new Promise((r) => setTimeout(r, 300000));
  }
  await browser.close();
  await new Promise((r) => server.close(r));
}
if (failure) throw failure;
