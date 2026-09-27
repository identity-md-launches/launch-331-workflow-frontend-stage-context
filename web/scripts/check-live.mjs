import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { encodeFunctionData, decodeFunctionResult } from "viem";
import { quoterAbi } from "../src/config.ts";
import { poolKey } from "../src/chain.ts";
const d = JSON.parse(
  await readFile(
    new URL("../../dist/imd-deployment.json", import.meta.url),
    "utf8",
  ),
);
const report = {
  checkedAt: new Date().toISOString(),
  broadcast: false,
  attempts: [],
};
for (const url of d.network.rpcUrls) {
  try {
    const faucet = d.contracts.find((c) => c.name === "TokenFaucet");
    const token = d.contracts.find((c) => c.name === "LaunchToken");
    const abi = JSON.parse(
      await readFile(
        new URL("../../dist/" + faucet.abiPath, import.meta.url),
        "utf8",
      ),
    );
    const erc = JSON.parse(
      await readFile(
        new URL("../../dist/" + token.abiPath, import.meta.url),
        "utf8",
      ),
    );
    const calls = [
      { method: "eth_chainId", params: [] },
      { method: "eth_blockNumber", params: [] },
      ...d.contracts.map((c) => ({
        method: "eth_getCode",
        params: [c.address, "latest"],
      })),
      {
        method: "eth_call",
        params: [
          {
            to: faucet.address,
            data: encodeFunctionData({ abi, functionName: "featuredToken" }),
          },
          "latest",
        ],
      },
      {
        method: "eth_call",
        params: [
          {
            to: token.address,
            data: encodeFunctionData({
              abi: erc,
              functionName: "balanceOf",
              args: [faucet.address],
            }),
          },
          "latest",
        ],
      },
    ];
    const body = JSON.stringify(
      calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, ...c })),
    );
    const res = JSON.parse(
      execFileSync(
        "curl",
        [
          "--silent",
          "--show-error",
          "--max-time",
          "18",
          "-H",
          "Content-Type: application/json",
          "--data-binary",
          body,
          url,
        ],
        { encoding: "utf8", maxBuffer: 500000 },
      ),
    );
    if (!Array.isArray(res)) throw Error(JSON.stringify(res));
    res.sort((a, b) => a.id - b.id);
    if (res.some((r) => r.error))
      throw Error(JSON.stringify(res.filter((r) => r.error)));
    const featured = decodeFunctionResult({
      abi,
      functionName: "featuredToken",
      data: res[4].result,
    });
    const attempt = {
      rpc: url,
      chainId: Number(BigInt(res[0].result)),
      blockNumber: Number(BigInt(res[1].result)),
      contracts: d.contracts.map((c, i) => ({
        name: c.name,
        address: c.address,
        codeBytes: (res[2 + i].result.length - 2) / 2,
      })),
      featuredToken: featured,
      faucetDripBalanceMinor: decodeFunctionResult({
        abi: erc,
        functionName: "balanceOf",
        data: res[5].result,
      }).toString(),
    };
    attempt.passed =
      attempt.chainId === d.chainId &&
      attempt.contracts.every((c) => c.codeBytes > 0) &&
      featured.toLowerCase() === token.address.toLowerCase();
    report.attempts.push(attempt);
    if (attempt.passed) {
      const params = {
        poolKey: poolKey({
          deployment: d,
          contracts: Object.fromEntries(d.contracts.map((c) => [c.name, c])),
        }),
        zeroForOne: true,
        exactAmount: 1000000000000000n,
        hookData: "0x",
      };
      const request = {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          {
            to: d.network.uniswapV4.quoter,
            data: encodeFunctionData({
              abi: quoterAbi,
              functionName: "quoteExactInputSingle",
              args: [params],
            }),
          },
          res[1].result,
        ],
      };
      try {
        const response = JSON.parse(
          execFileSync(
            "curl",
            [
              "--silent",
              "--show-error",
              "--max-time",
              "18",
              "-H",
              "Content-Type: application/json",
              "--data-binary",
              JSON.stringify(request),
              url,
            ],
            { encoding: "utf8", maxBuffer: 500000 },
          ),
        );
        if (response.error) throw Error(JSON.stringify(response.error));
        const [out, gas] = decodeFunctionResult({
          abi: quoterAbi,
          functionName: "quoteExactInputSingle",
          data: response.result,
        });
        report.quote = {
          passed: true,
          method: "eth_call",
          blockNumber: attempt.blockNumber,
          quoter: d.network.uniswapV4.quoter,
          inputEthMinor: params.exactAmount.toString(),
          outputDripMinor: out.toString(),
          gasEstimate: gas.toString(),
        };
      } catch (e) {
        report.quote = { passed: false, error: e.message.slice(0, 500) };
      }
      break;
    }
  } catch (e) {
    report.attempts.push({
      rpc: url,
      passed: false,
      error: e.message.slice(0, 500),
    });
  }
}
await writeFile(
  new URL("../../docs/frontend/live-read.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
