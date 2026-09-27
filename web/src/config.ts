import {
  createPublicClient,
  custom,
  defineChain,
  fallback,
  http,
  isAddress,
  keccak256,
  parseAbi,
  toBytes,
  zeroAddress,
} from "viem";
import type { Abi, Address, EIP1193Provider } from "viem";

export type Deployment = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<
      | "poolManager"
      | "universalRouter"
      | "quoter"
      | "stateView"
      | "positionManager"
      | "permit2",
      Address
    >;
  };
  walletAddChain: {
    chainId: string;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
  pool: {
    fee: number;
    tickSpacing: number;
    pairedCurrency: Address;
    initialPrice: string;
  };
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export function abiHash(abi: unknown) {
  return keccak256(toBytes(canonical(abi))).slice(2);
}
export const safePath = (p: string) =>
  /^[a-zA-Z0-9_./-]+$/.test(p) &&
  !p.startsWith("/") &&
  !p.split("/").some((s) => !s || s === ".." || s === ".");
export const erc20 = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
// Interfaces for the deployed v4 router version specified in the handoff workflow.
export const quoterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
export const routerAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
  "error ExecutionFailed(uint256 commandIndex, bytes message)",
  "error V4TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)",
]);
export const permitAbi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);

export async function loadDeployment() {
  const fetchJson = async (path: string) => {
    const r = await fetch(new URL(path, document.baseURI));
    if (!r.ok)
      throw new Error(
        `Cannot load ${path} (${r.status}). Reload or check the static export.`,
      );
    return r.json();
  };
  const d: Deployment = await fetchJson("imd-deployment.json");
  if (
    d.version !== 1 ||
    d.chainId !== d.network?.chainId ||
    !d.network.testnet ||
    d.walletAddChain.chainId !== `0x${d.chainId.toString(16)}` ||
    !/^[a-f0-9]{64}$/.test(d.attestationHash)
  )
    throw new Error(
      "Deployment configuration is inconsistent. Transactions are unavailable.",
    );
  if (
    d.contracts.length !== 2 ||
    new Set(d.contracts.map((c) => c.name)).size !== 2 ||
    !d.network.rpcUrls.length ||
    d.pool.pairedCurrency !== zeroAddress
  )
    throw new Error("Unsupported deployment configuration.");
  for (const url of [...d.network.rpcUrls, d.network.explorer])
    if (new URL(url).protocol !== "https:")
      throw new Error("Deployment endpoints must use HTTPS.");
  for (const a of Object.values(d.network.uniswapV4))
    if (!isAddress(a)) throw new Error("Invalid Uniswap configuration.");
  const entries = await Promise.all(
    d.contracts.map(async (c) => {
      if (!isAddress(c.address) || !safePath(c.abiPath))
        throw new Error("Invalid contract address or ABI path.");
      const abi = (await fetchJson(c.abiPath)) as Abi;
      if (!Array.isArray(abi) || abiHash(abi) !== c.abiHash)
        throw new Error(
          `ABI integrity check failed for ${c.name}. Transactions are unavailable.`,
        );
      return [c.name, { ...c, abi }] as const;
    }),
  );
  const contracts = Object.fromEntries(entries);
  if (!contracts.LaunchToken || !contracts.TokenFaucet)
    throw new Error("Required contracts are missing.");
  const chain = defineChain({
    id: d.chainId,
    name: d.network.name,
    nativeCurrency: d.network.nativeCurrency,
    rpcUrls: { default: { http: d.network.rpcUrls } },
    blockExplorers: { default: { name: "Explorer", url: d.network.explorer } },
    testnet: d.network.testnet,
  });
  return { deployment: d, contracts, chain };
}
export type Config = Awaited<ReturnType<typeof loadDeployment>>;
export function makePublic(config: Config, provider?: EIP1193Provider) {
  return createPublicClient({
    chain: config.chain,
    transport: fallback(
      [
        ...config.deployment.network.rpcUrls.map((url) =>
          http(url, { timeout: 8000, retryCount: 0 }),
        ),
        ...(provider ? [custom(provider, { retryCount: 0 })] : []),
      ],
      { rank: false, retryCount: 0 },
    ),
  });
}
export async function switchNetwork(provider: EIP1193Provider, d: Deployment) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: d.walletAddChain.chainId as `0x${string}` }],
    });
  } catch (error) {
    const e = error as {
      code?: number;
      message?: string;
      cause?: { code?: number };
    };
    if (
      e.code !== 4902 &&
      e.cause?.code !== 4902 &&
      !/unknown chain|unrecognized chain|chain.*not.*added/i.test(
        e.message || "",
      )
    )
      throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          ...d.walletAddChain,
          chainId: d.walletAddChain.chainId as `0x${string}`,
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: d.walletAddChain.chainId as `0x${string}` }],
    });
  }
}
