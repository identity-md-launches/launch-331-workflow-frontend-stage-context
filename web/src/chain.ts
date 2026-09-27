import {
  encodeAbiParameters,
  formatUnits,
  parseAbiParameters,
  parseUnits,
  zeroAddress,
} from "viem";
import type { Address, Hex } from "viem";
import { erc20, makePublic, permitAbi } from "./config.ts";
import type { Config } from "./config.ts";
export type Public = ReturnType<typeof makePublic>;
export const PAGE_SIZE = 5n;
export const short = (v: string) => `${v.slice(0, 6)}…${v.slice(-4)}`;
export function amount(
  value: string,
  decimals: number,
  max = (1n << 256n) - 1n,
) {
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ||
    (value.split(".")[1]?.length || 0) > decimals
  )
    throw Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const n = parseUnits(value, decimals);
  if (n <= 0n || n > max)
    throw Error("Enter a positive amount within the supported range.");
  return n;
}
export function display(n: bigint, decimals: number) {
  if (n > 0n && decimals > 6 && n < 10n ** BigInt(decimals - 6))
    return "<0.000001";
  const full = formatUnits(n, decimals);
  const [whole, fraction] = full.split(".");
  return (
    BigInt(whole).toLocaleString("en-US") +
    (fraction ? "." + fraction.slice(0, 6).replace(/0+$/, "") : "").replace(
      /\.$/,
      "",
    )
  );
}
export function errorText(error: unknown) {
  const e = error as {
    shortMessage?: string;
    message?: string;
    code?: number;
    cause?: { code?: number };
  };
  if (
    e.code === 4001 ||
    e.cause?.code === 4001 ||
    /rejected|denied/i.test(e.message || "")
  )
    return "Request declined in your wallet. Nothing was submitted; try again when ready.";
  const message = e.shortMessage || e.message || String(error);
  return message.length > 420 ? message.slice(0, 420) + "…" : message;
}
export async function verifyChain(client: Public, config: Config) {
  if ((await client.getChainId()) !== config.deployment.chainId)
    throw Error(
      "RPC returned the wrong network. Transactions are disabled. Try Refresh.",
    );
  const contracts = Object.values(config.contracts);
  const uniswap = config.deployment.network.uniswapV4;
  await Promise.all(
    [
      ...contracts.map((c) => c.address),
      uniswap.poolManager,
      uniswap.universalRouter,
      uniswap.quoter,
      uniswap.permit2,
    ].map(async (address) => {
      const code = await client.getCode({ address });
      if (!code || code === "0x")
        throw Error(
          `No deployed code at ${address}. Transactions are disabled.`,
        );
    }),
  );
  const featured = await client.readContract({
    address: config.contracts.TokenFaucet.address,
    abi: config.contracts.TokenFaucet.abi,
    functionName: "featuredToken",
  });
  if (
    String(featured).toLowerCase() !==
    config.contracts.LaunchToken.address.toLowerCase()
  )
    throw Error(
      "Featured token does not match the handoff. Transactions are disabled.",
    );
}
export async function readSnapshot(
  client: Public,
  config: Config,
  token: Address,
  account: Address | undefined,
  page: bigint,
) {
  const faucet = config.contracts.TokenFaucet;
  const block = await client.getBlock();
  const blockNumber = block.number;
  const abi =
    token.toLowerCase() === config.contracts.LaunchToken.address.toLowerCase()
      ? config.contracts.LaunchToken.abi
      : erc20;
  const tokenRead = (functionName: string, args: readonly unknown[] = []) =>
    client.readContract({
      address: token,
      abi,
      functionName,
      args,
      blockNumber,
    });
  const faucetRead = (functionName: string, args: readonly unknown[] = []) =>
    client.readContract({
      address: faucet.address,
      abi: faucet.abi,
      functionName,
      args,
      blockNumber,
    });
  const decimals = Number(await tokenRead("decimals"));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30)
    throw Error(
      "This token is unsupported: decimals must be between 0 and 30. Choose DRIP or another token.",
    );
  const [
    symbol,
    balance,
    nominal,
    count,
    donors,
    walletBalance,
    next,
    allowance,
    donated,
    nativeBalance,
    dripBalance,
    tokenPermit,
    routerPermit,
  ] = await Promise.all([
    tokenRead("symbol").catch(() => short(token)),
    tokenRead("balanceOf", [faucet.address]),
    faucetRead("claimAmount", [token]),
    faucetRead("donorCount", [token]),
    faucetRead("donors", [token, page * PAGE_SIZE, PAGE_SIZE]),
    account ? tokenRead("balanceOf", [account]) : 0n,
    account ? faucetRead("nextClaimAt", [token, account]) : 0n,
    account ? tokenRead("allowance", [account, faucet.address]) : 0n,
    account ? faucetRead("donatedBy", [token, account]) : 0n,
    account ? client.getBalance({ address: account, blockNumber }) : 0n,
    account
      ? client.readContract({
          address: config.contracts.LaunchToken.address,
          abi: config.contracts.LaunchToken.abi,
          functionName: "balanceOf",
          args: [account],
          blockNumber,
        })
      : 0n,
    account
      ? client.readContract({
          address: config.contracts.LaunchToken.address,
          abi: config.contracts.LaunchToken.abi,
          functionName: "allowance",
          args: [account, config.deployment.network.uniswapV4.permit2],
          blockNumber,
        })
      : 0n,
    account
      ? client.readContract({
          address: config.deployment.network.uniswapV4.permit2,
          abi: permitAbi,
          functionName: "allowance",
          args: [
            account,
            config.contracts.LaunchToken.address,
            config.deployment.network.uniswapV4.universalRouter,
          ],
          blockNumber,
        })
      : [0n, 0, 0],
  ]);
  const donorRows = await Promise.all(
    (donors as Address[]).map(async (address) => ({
      address,
      total: (await faucetRead("donatedBy", [token, address])) as bigint,
    })),
  );
  return {
    token,
    account,
    page,
    decimals,
    symbol: String(symbol).slice(0, 40),
    balance: balance as bigint,
    nominal: nominal as bigint,
    count: count as bigint,
    donorRows,
    walletBalance: walletBalance as bigint,
    next: next as bigint,
    allowance: allowance as bigint,
    donated: donated as bigint,
    nativeBalance,
    dripBalance: dripBalance as bigint,
    tokenPermit: tokenPermit as bigint,
    routerPermit: routerPermit as readonly [bigint, number, number],
    blockNumber,
    timestamp: block.timestamp,
    readAt: Date.now(),
  };
}
export type Snapshot = Awaited<ReturnType<typeof readSnapshot>>;
export function poolKey(config: Config) {
  const token = config.contracts.LaunchToken.address;
  const paired = config.deployment.pool.pairedCurrency;
  const [currency0, currency1] = [paired, token].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );
  return {
    currency0,
    currency1,
    fee: config.deployment.pool.fee,
    tickSpacing: config.deployment.pool.tickSpacing,
    hooks: zeroAddress,
  };
}
export function buildSwap(
  config: Config,
  buy: boolean,
  input: bigint,
  min: bigint,
  deadline: bigint,
) {
  const key = poolKey(config);
  const inputCurrency = buy
    ? config.deployment.pool.pairedCurrency
    : config.contracts.LaunchToken.address;
  const outputCurrency = buy
    ? config.contracts.LaunchToken.address
    : config.deployment.pool.pairedCurrency;
  const zeroForOne =
    inputCurrency.toLowerCase() === key.currency0.toLowerCase();
  const swap = encodeAbiParameters(
    parseAbiParameters(
      "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)",
    ),
    [
      {
        poolKey: key,
        zeroForOne,
        amountIn: input,
        amountOutMinimum: min,
        hookData: "0x",
      },
    ],
  );
  const settle = encodeAbiParameters(parseAbiParameters("address,uint256"), [
    inputCurrency,
    input,
  ]);
  const take = encodeAbiParameters(parseAbiParameters("address,uint256"), [
    outputCurrency,
    min,
  ]);
  const actions = encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [
    "0x060c0f",
    [swap, settle, take],
  ]);
  return {
    args: ["0x10" as Hex, [actions], deadline] as const,
    value: inputCurrency === zeroAddress ? input : 0n,
  };
}
