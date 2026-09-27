import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import {
  createWalletClient,
  custom,
  formatUnits,
  isAddress,
  zeroAddress,
} from "viem";
import type { Abi, Address, EIP1193Provider, Hex } from "viem";
import {
  erc20,
  makePublic,
  permitAbi,
  quoterAbi,
  routerAbi,
  switchNetwork,
} from "./config";
import type { Config } from "./config";
import {
  amount,
  buildSwap,
  display,
  errorText,
  PAGE_SIZE,
  poolKey,
  readSnapshot,
  short,
  verifyChain,
} from "./chain";
import type { Snapshot } from "./chain";

function Drop({ large = false }: { large?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 80 100"
      className={large ? "drop large" : "drop"}
    >
      <path
        d="M40 3C33 26 9 43 9 63a31 31 0 0062 0C71 43 47 26 40 3Z"
        fill="currentColor"
      />
      <path
        d="M25 61c0 12 6 19 17 19"
        fill="none"
        stroke="var(--surface)"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function External({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}
export default function App({ config }: { config: Config }) {
  const { deployment: d, contracts } = config;
  const featured = contracts.LaunchToken.address;
  const faucet = contracts.TokenFaucet;
  const { address, chainId, connector, isConnected } = useAccount();
  const { connectAsync, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const [provider, setProvider] = useState<EIP1193Provider>();
  const publicClient = useMemo(
    () => makePublic(config, chainId === d.chainId ? provider : undefined),
    [config, provider, chainId, d.chainId],
  );
  const [token, setToken] = useState<Address>(featured);
  const [draft, setDraft] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [page, setPage] = useState(0n);
  const [state, setState] = useState<Snapshot>();
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [tx, setTx] = useState<Hex>();
  const [pendingReview, setPendingReview] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const generation = useRef(0);
  const mutex = useRef(false);
  const identity = useRef("");
  identity.current = `${address}:${chainId}:${token}`;
  const [donation, setDonation] = useState("");
  const [finalDonation, setFinalDonation] = useState(false);
  const [donationError, setDonationError] = useState("");
  const [buy, setBuy] = useState(true);
  const [swapInput, setSwapInput] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [quote, setQuote] = useState<{
    input: bigint;
    output: bigint;
    min: bigint;
    created: number;
    buy: boolean;
    identity: string;
  }>();
  const [swapError, setSwapError] = useState("");
  useEffect(() => {
    let active = true;
    setProvider(undefined);
    if (connector)
      void connector
        .getProvider()
        .then((p) => {
          if (active) setProvider(p as EIP1193Provider);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [connector]);
  const refresh = useCallback(async () => {
    const seq = ++generation.current;
    setLoading(true);
    setVerified(false);
    setReadError("");
    try {
      await verifyChain(publicClient, config);
      const snapshot = await readSnapshot(
        publicClient,
        config,
        token,
        address,
        page,
      );
      if (seq === generation.current) {
        setState(snapshot);
        setVerified(true);
      }
    } catch (e) {
      if (seq === generation.current) {
        setState(undefined);
        setReadError(errorText(e) + " Choose another token or try Refresh.");
      }
    } finally {
      if (seq === generation.current) setLoading(false);
    }
  }, [publicClient, config, token, address, page]);
  useEffect(() => {
    setState(undefined);
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setQuote(undefined);
    setActionError("");
    setDonationError("");
    setSwapError("");
    setFinalDonation(false);
  }, [address, chainId, token]);
  const current =
    state &&
    state.token === token &&
    state.account === address &&
    state.page === page
      ? state
      : undefined;
  const rightChain = chainId === d.chainId;
  const ready = !!(
    isConnected &&
    address &&
    provider &&
    rightChain &&
    verified &&
    current &&
    !loading &&
    !pendingReview &&
    !busy
  );
  const native = d.network.nativeCurrency.symbol;
  const symbol = current?.symbol || (token === featured ? "DRIP" : "token");
  const chainNow = current?.timestamp || 0n;
  const claimValue = current
    ? current.balance < current.nominal
      ? current.balance
      : current.nominal
    : 0n;
  const canClaim =
    ready && current && claimValue > 0n && current.next <= chainNow;
  const quoteFresh =
    quote &&
    clock - quote.created < 60000 &&
    quote.identity === identity.current &&
    quote.buy === buy;
  let donateValue = 0n;
  try {
    if (current) donateValue = amount(donation, current.decimals);
  } catch {
    /* validated on submit */
  }
  let swapValue = 0n;
  try {
    swapValue = amount(swapInput, 18, (1n << 128n) - 1n);
  } catch {
    /* validated on quote */
  }
  const enoughDonation =
    !!current && donateValue > 0n && donateValue <= current.walletBalance;
  const donationApproved =
    !!current && donateValue > 0n && current.allowance >= donateValue;
  const resetDonation =
    !!current && current.allowance > 0n && !donationApproved;
  const tokenApproved =
    !!current && current.tokenPermit >= swapValue && swapValue > 0n;
  const permitApproved =
    !!current &&
    current.routerPermit[0] >= swapValue &&
    BigInt(current.routerPermit[1]) > chainNow + 120n &&
    swapValue > 0n;
  const swapStepsReady = buy || (tokenApproved && permitApproved);
  const fmt = (n: bigint) => (current ? display(n, current.decimals) : "—");
  const explorer = (a: Address) => `${d.network.explorer}/address/${a}`;
  const claimHint = !address
    ? "Connect your wallet to check your next claim."
    : !rightChain
      ? `Switch to ${d.network.name} to use the faucet.`
      : !current
        ? "Waiting for verified contract reads."
        : current.next > chainNow
          ? `Next claim: ${new Date(Number(current.next) * 1000).toLocaleString()}. Eligibility uses chain time.`
          : current.balance === 0n
            ? "The faucet is empty. A donation makes the next claim possible."
            : "Ready when you are. A smaller pool pays its remaining balance.";
  async function connectWallet() {
    setActionError("");
    try {
      let available;
      for (const candidate of connectors) {
        if (await candidate.getProvider()) {
          available = candidate;
          break;
        }
      }
      if (!available)
        throw Error(
          "No browser wallet found. Open this page in a wallet browser or install an Ethereum browser wallet, then reload.",
        );
      await connectAsync({ connector: available });
    } catch (e) {
      setActionError(errorText(e));
    }
  }
  async function switchWallet() {
    if (!provider) return;
    setActionError("");
    try {
      await switchNetwork(provider, d);
    } catch (e) {
      setActionError(errorText(e));
    }
  }
  async function guarded(task: () => Promise<void>) {
    if (mutex.current) return;
    mutex.current = true;
    setBusy(true);
    setActionError("");
    setTx(undefined);
    try {
      await task();
    } catch (e) {
      setActionError(errorText(e));
      setMessage("Action needs attention. Review the details below.");
    } finally {
      mutex.current = false;
      setBusy(false);
    }
  }
  async function walletContext() {
    if (!ready || !provider || !address)
      throw Error(
        "Connect on the correct network and refresh verified balances first.",
      );
    const startIdentity = identity.current;
    const wallet = createWalletClient({
      chain: config.chain,
      transport: custom(provider),
    });
    const check = async () => {
      const [cid, accounts] = await Promise.all([
        wallet.getChainId(),
        wallet.getAddresses(),
      ]);
      if (
        cid !== d.chainId ||
        accounts[0]?.toLowerCase() !== address.toLowerCase() ||
        identity.current !== startIdentity
      )
        throw Error(
          "Wallet or token changed. Refresh and start the action again.",
        );
    };
    await check();
    await verifyChain(publicClient, config);
    await check();
    return { wallet, check, account: address };
  }
  async function send(
    label: string,
    target: Address,
    abi: Abi,
    fn: string,
    args: readonly unknown[],
    value?: bigint,
    beforeSign?: () => void,
  ) {
    const { wallet, check, account } = await walletContext();
    setMessage(`Checking ${label.toLowerCase()}…`);
    const simulation = await publicClient.simulateContract({
      address: target,
      abi,
      functionName: fn,
      args,
      account,
      value,
    });
    await check();
    beforeSign?.();
    setMessage(`Confirm ${label.toLowerCase()} in your wallet.`);
    const hash = await wallet.writeContract(simulation.request);
    setTx(hash);
    setMessage(`${label} submitted. Waiting for confirmation…`);
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 180000,
      });
    } catch {
      setPendingReview(true);
      throw Error(
        "Transaction submitted, but confirmation is unavailable. Check its explorer link and select Check transaction before sending again.",
      );
    }
    if (receipt.status !== "success")
      throw Error(
        `${label} reverted on chain. Open the transaction for details, then refresh.`,
      );
    setMessage(`${label} confirmed. Balances refreshed.`);
    setQuote(undefined);
    await refresh();
  }
  async function checkTransaction() {
    if (!tx) return;
    setBusy(true);
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: tx });
      setPendingReview(false);
      setActionError("");
      setQuote(undefined);
      setMessage(
        receipt.status === "success"
          ? "Transaction confirmed. Balances refreshed."
          : "Transaction reverted on chain. Review the explorer for details.",
      );
      await refresh();
    } catch {
      setActionError(
        "Confirmation is still unavailable. Check the transaction in the explorer, then try Check transaction again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function selectToken(e: React.FormEvent) {
    e.preventDefault();
    if (!isAddress(draft) || draft === zeroAddress) {
      setTokenError("Enter a valid, nonzero ERC-20 contract address.");
      document.getElementById("token-address")?.focus();
      return;
    }
    setTokenError("");
    setToken(draft);
    setPage(0n);
    setDonation("");
  }
  function validateDonation() {
    try {
      if (!current) throw Error("Refresh token information first.");
      const n = amount(donation, current.decimals);
      if (n > current.walletBalance)
        throw Error(
          `You do not have enough ${symbol}. Reduce the amount or swap for DRIP.`,
        );
      setDonationError("");
      return n;
    } catch (e) {
      setDonationError(errorText(e));
      document.getElementById("donation")?.focus();
      return undefined;
    }
  }
  async function approveDonation() {
    const n = validateDonation();
    if (!n) return;
    await guarded(() =>
      send(
        resetDonation ? "Reset faucet approval" : "Faucet approval",
        token,
        token === featured ? contracts.LaunchToken.abi : erc20,
        "approve",
        [faucet.address, resetDonation ? 0n : n],
      ),
    );
  }
  async function donate() {
    const n = validateDonation();
    if (!n || !finalDonation || !donationApproved) return;
    await guarded(() =>
      send("Donation", faucet.address, faucet.abi, "donate", [token, n]),
    );
  }
  async function getQuote() {
    setSwapError("");
    setQuote(undefined);
    let n: bigint;
    let bps: number;
    try {
      n = amount(swapInput, 18, (1n << 128n) - 1n);
      if (!/^\d+(\.\d{1,2})?$/.test(slippage))
        throw Error(
          "Enter slippage from 0.1% to 5%, with at most two decimal places.",
        );
      bps = Math.round(Number(slippage) * 100);
      if (bps < 10 || bps > 500)
        throw Error("Choose slippage from 0.1% to 5%.");
      if (current && n > (buy ? current.nativeBalance : current.dripBalance))
        throw Error(
          `Insufficient ${buy ? native : "DRIP"} balance. Reduce the swap amount.`,
        );
    } catch (e) {
      setSwapError(errorText(e));
      document.getElementById("swap-amount")?.focus();
      return;
    }
    await guarded(async () => {
      const { account, check } = await walletContext();
      setMessage("Requesting a live quote…");
      const result = await publicClient.simulateContract({
        address: d.network.uniswapV4.quoter,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: poolKey(config),
            zeroForOne: buy,
            exactAmount: n,
            hookData: "0x",
          },
        ],
        account,
      });
      await check();
      const output = result.result[0];
      const min = (output * BigInt(10000 - bps)) / 10000n;
      if (min <= 0n || min >= 1n << 128n)
        throw Error(
          "No usable quote at this amount. Try a different amount; the pool may have insufficient liquidity.",
        );
      setQuote({
        input: n,
        output,
        min,
        created: Date.now(),
        buy,
        identity: identity.current,
      });
      setMessage("Quote ready. Review the minimum received before swapping.");
    });
  }
  async function swap() {
    if (!quoteFresh || !quote || !swapStepsReady) return;
    await guarded(async () => {
      const block = await publicClient.getBlock();
      if (Date.now() - quote.created >= 60000)
        throw Error("Quote expired. Request a new quote.");
      const params = buildSwap(
        config,
        buy,
        quote.input,
        quote.min,
        block.timestamp + 300n,
      );
      await send(
        "Swap",
        d.network.uniswapV4.universalRouter,
        routerAbi,
        "execute",
        params.args,
        params.value,
        () => {
          if (Date.now() - quote.created >= 60000)
            throw Error(
              "Quote expired during simulation. Get a new quote before signing.",
            );
        },
      );
    });
  }

  return (
    <>
      <a className="skip" href="#main">
        Skip to faucet
      </a>
      <header className="site-header wrap">
        <a className="brand" href="#main" aria-label="Drip faucet home">
          <Drop />
          <span>
            drip<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="header-right">
          <span className="network-pill">
            <span className="status-dot" /> {d.network.name} testnet
          </span>
          {isConnected ? (
            <div className="wallet">
              <External href={explorer(address!)}>{short(address!)}</External>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => disconnect()}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              className="connect"
              disabled={connecting}
              onClick={() => void connectWallet()}
            >
              {connecting ? "Connecting…" : "Connect wallet"}
              <span aria-hidden="true"> ↗</span>
            </button>
          )}
        </div>
      </header>
      <main id="main" className="wrap">
        <section className="hero" aria-labelledby="hero-title">
          <div>
            <p className="eyebrow">
              <span className="tiny-cross">✳</span> A community-funded test
              faucet
            </p>
            <h1 id="hero-title">
              A little goes
              <br />a long way<span className="brand-dot">.</span>
            </h1>
            <p className="intro">
              Pick a token. Take a little. Leave a little.
              <br />A shared place to start your next test on Sepolia.
            </p>
          </div>
          <div className="water-art" aria-hidden="true">
            <span className="orbit o1" />
            <span className="orbit o2" />
            <span className="orbit o3" />
            <Drop large />
            <span className="art-caption">
              Small drops. Shared by everyone.
            </span>
            <span className="spark s1">+</span>
            <span className="spark s2">+</span>
          </div>
        </section>
        <div className="notice">
          <span aria-hidden="true">ⓘ</span>
          <p>
            <strong>Just for testing.</strong> These tokens have no promised
            value. Anyone can claim from many addresses; this is a test faucet,
            not a fair or valuable distribution.
          </p>
        </div>
        {isConnected && !rightChain && (
          <div className="network-warning" role="alert">
            <p>
              Your wallet is on another network. Switch to {d.network.name} to
              continue.
            </p>
            <button
              disabled={!provider || busy}
              onClick={() => void switchWallet()}
            >
              Switch to {d.network.name}
            </button>
          </div>
        )}
        <section className="token-bar" aria-label="Selected token">
          <div className="token-identity">
            <span className="token-mark">
              <Drop />
            </span>
            <div>
              <span className="eyebrow">Faucet token</span>
              <h2>
                {symbol}
                {token === featured && (
                  <span className="small-badge">Featured</span>
                )}
              </h2>
            </div>
          </div>
          <div className="token-controls">
            <External href={explorer(token)}>{short(token)}</External>
            <details>
              <summary>Change token</summary>
              <form onSubmit={selectToken} className="token-picker">
                <label htmlFor="token-address">ERC-20 contract address</label>
                <input
                  id="token-address"
                  name="token-address"
                  value={draft}
                  placeholder="0x…"
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={busy}
                  aria-invalid={!!tokenError}
                  aria-describedby="token-error"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p id="token-error" className="field-error">
                  {tokenError}
                </p>
                <div className="button-row">
                  <button disabled={busy} type="submit">
                    Use token
                  </button>
                  <button
                    disabled={busy}
                    type="button"
                    onClick={() => {
                      setToken(featured);
                      setDraft("");
                      setTokenError("");
                      setPage(0n);
                      setDonation("");
                    }}
                  >
                    Use DRIP
                  </button>
                </div>
              </form>
            </details>
          </div>
        </section>
        <div className="read-status">
          <span>
            {loading
              ? "Reading the chain…"
              : readError
                ? "Contract reads unavailable"
                : `Updated at block ${current?.blockNumber.toLocaleString()}`}
          </span>
          <button
            className="quiet"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            ↻ Refresh
          </button>
        </div>
        {readError && (
          <p className="error-box" role="alert">
            {readError}
          </p>
        )}
        <div className="action-grid">
          <section className="claim-card" aria-labelledby="claim-title">
            <div className="card-top">
              <span className="eyebrow">01 / Take a little</span>
              <span className="small-badge">Every 24 hours</span>
            </div>
            <h2 id="claim-title">Your next drop</h2>
            <p className="card-copy">
              Claim up to 100 {symbol}, once per wallet, per token.
            </p>
            <div className="claim-number">
              <span>{current ? fmt(claimValue) : "—"}</span>
              <span className="unit">{symbol}</span>
            </div>
            <div className="stat-line">
              <span>Available in the faucet</span>
              <strong
                title={
                  current
                    ? formatUnits(current.balance, current.decimals)
                    : undefined
                }
              >
                {current ? `${fmt(current.balance)} ${symbol}` : "—"}
              </strong>
            </div>
            <p className="claim-hint">{claimHint}</p>
            <button
              className="primary"
              disabled={address ? !canClaim : connecting}
              onClick={() =>
                address
                  ? void guarded(() =>
                      send("Claim", faucet.address, faucet.abi, "claim", [
                        token,
                      ]),
                    )
                  : void connectWallet()
              }
            >
              {address ? `Claim ${symbol}` : "Connect to claim"}
              <span aria-hidden="true"> ↓</span>
            </button>
            <p className="footnote">
              Sent directly to your wallet. Transfer fees may reduce receipt.
            </p>
          </section>
          <section className="donate-card card" aria-labelledby="donate-title">
            <div className="card-top">
              <span className="eyebrow">02 / Leave a little</span>
              <span aria-hidden="true">↗</span>
            </div>
            <h2 id="donate-title">Keep the drops coming</h2>
            <p className="card-copy">
              Top up the faucet for the next person. Every donation helps.
            </p>
            <label htmlFor="donation">Amount to donate</label>
            <div className="amount-input">
              <input
                id="donation"
                name="donation"
                inputMode="decimal"
                placeholder="0.00"
                value={donation}
                onChange={(e) => {
                  setDonation(e.target.value);
                  setFinalDonation(false);
                  setDonationError("");
                }}
                disabled={busy}
                aria-invalid={!!donationError}
                aria-describedby="donation-error donation-balance"
                autoComplete="off"
              />
              <span>{symbol}</span>
            </div>
            <p id="donation-balance" className="balance">
              Your balance{" "}
              <strong>
                {current && address
                  ? `${fmt(current.walletBalance)} ${symbol}`
                  : "Connect to view"}
              </strong>
            </p>
            <p id="donation-error" className="field-error">
              {donationError}
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={finalDonation}
                disabled={busy}
                onChange={(e) => setFinalDonation(e.target.checked)}
              />
              <span>
                I understand donations are final and cannot be withdrawn.
              </span>
            </label>
            <div className="donation-steps">
              <button
                disabled={!ready || donationApproved}
                onClick={() => void approveDonation()}
              >
                {donationApproved
                  ? "1. Approved"
                  : resetDonation
                    ? "1. Reset approval"
                    : "1. Approve amount"}
              </button>
              <button
                disabled={
                  !ready ||
                  !enoughDonation ||
                  !donationApproved ||
                  !finalDonation
                }
                onClick={() => void donate()}
              >
                2. Donate {symbol}
              </button>
            </div>
            <p className="footnote">
              Approval lets this faucet spend the entered amount. Donation is a
              separate transaction. Fee tokens are credited at the amount
              received.
            </p>
          </section>
        </div>
        <div className="transaction-area" aria-live="polite">
          <p role="status">{message}</p>
          {pendingReview && (
            <button disabled={busy} onClick={() => void checkTransaction()}>
              Check transaction
            </button>
          )}
          {tx && (
            <External href={`${d.network.explorer}/tx/${tx}`}>
              View transaction {short(tx)}
            </External>
          )}
        </div>
        {actionError && (
          <p className="error-box" role="alert">
            {actionError}
          </p>
        )}
        <section className="community card" aria-labelledby="donors-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">A faucet filled by you</p>
              <h2 id="donors-title">The people behind the drops</h2>
            </div>
            <span className="small-badge">
              {current ? current.count.toLocaleString() : "—"} donors
            </span>
          </div>
          <div className="donor-header">
            <span>Donor</span>
            <span>Total donated · {symbol}</span>
          </div>
          {current?.donorRows.length ? (
            current.donorRows.map((row) => (
              <div className="donor-row" key={row.address}>
                <External href={explorer(row.address)}>
                  <span className="donor-avatar" aria-hidden="true">
                    ↗
                  </span>
                  <span title={row.address}>{short(row.address)}</span>
                  {row.address.toLowerCase() === address?.toLowerCase() && (
                    <span className="small-badge">You</span>
                  )}
                </External>
                <strong title={formatUnits(row.total, current.decimals)}>
                  {fmt(row.total)}
                </strong>
              </div>
            ))
          ) : (
            <p className="empty">
              {loading
                ? "Loading donors…"
                : readError
                  ? "Refresh to load the donor list."
                  : "No donations yet. Leave the first drop using the donation form."}
            </p>
          )}
          <div className="pagination">
            <span>
              {current?.count
                ? `Page ${page + 1n} of ${(current.count + PAGE_SIZE - 1n) / PAGE_SIZE}`
                : "Donations come directly from contract views."}
            </span>
            <div className="button-row">
              <button
                aria-label="Previous donors"
                disabled={page === 0n || loading || busy}
                onClick={() => setPage((p) => p - 1n)}
              >
                ← Previous
              </button>
              <button
                aria-label="Next donors"
                disabled={
                  !current ||
                  (page + 1n) * PAGE_SIZE >= current.count ||
                  loading ||
                  busy
                }
                onClick={() => setPage((p) => p + 1n)}
              >
                Next →
              </button>
            </div>
          </div>
        </section>
        <section className="swap-section card">
          <details>
            <summary>
              <span>
                <span className="eyebrow">Need a few drops?</span>
                <span className="summary-title">Swap {native} and DRIP</span>
              </span>
              <span className="summary-hint">
                Open swap <span aria-hidden="true">↗</span>
              </span>
            </summary>
            <div className="swap-content">
              <p>
                Trade in the launch pool through Uniswap v4 on {d.network.name}.
                Quotes expire after 60 seconds. A swap is separate from
                donating.
              </p>
              <div className="swap-fields">
                <div>
                  <label htmlFor="direction">Swap direction</label>
                  <select
                    id="direction"
                    value={buy ? "buy" : "sell"}
                    disabled={busy}
                    onChange={(e) => {
                      setBuy(e.target.value === "buy");
                      setQuote(undefined);
                      setSwapInput("");
                    }}
                  >
                    <option value="buy">{native} → DRIP</option>
                    <option value="sell">DRIP → {native}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="swap-amount">
                    You pay ({buy ? native : "DRIP"})
                  </label>
                  <input
                    id="swap-amount"
                    inputMode="decimal"
                    value={swapInput}
                    placeholder="0.01"
                    disabled={busy}
                    onChange={(e) => {
                      setSwapInput(e.target.value);
                      setQuote(undefined);
                    }}
                    aria-invalid={!!swapError}
                    aria-describedby="swap-error"
                  />
                </div>
                <div>
                  <label htmlFor="slippage">Slippage (%)</label>
                  <input
                    id="slippage"
                    inputMode="decimal"
                    value={slippage}
                    disabled={busy}
                    onChange={(e) => {
                      setSlippage(e.target.value);
                      setQuote(undefined);
                    }}
                  />
                </div>
              </div>
              <p className="balance">
                Your swap balance:{" "}
                {current && address
                  ? `${display(buy ? current.nativeBalance : current.dripBalance, 18)} ${buy ? native : "DRIP"}`
                  : "Connect to view"}{" "}
                · Keep some {native} for gas.
              </p>
              <p
                id="swap-error"
                className="field-error"
                role={swapError ? "alert" : undefined}
              >
                {swapError}
              </p>
              <div className="button-row swap-actions">
                <button disabled={!ready} onClick={() => void getQuote()}>
                  Get quote
                </button>
                {!buy && (
                  <>
                    <button
                      disabled={
                        !ready ||
                        swapValue <= 0n ||
                        !current ||
                        swapValue > current.dripBalance ||
                        tokenApproved
                      }
                      onClick={() =>
                        void guarded(() =>
                          send(
                            "Permit2 token approval",
                            featured,
                            contracts.LaunchToken.abi,
                            "approve",
                            [
                              d.network.uniswapV4.permit2,
                              current!.tokenPermit > 0n && !tokenApproved
                                ? 0n
                                : swapValue,
                            ],
                          ),
                        )
                      }
                    >
                      {tokenApproved
                        ? "1. Token approved"
                        : current && current.tokenPermit > 0n
                          ? "1. Reset token approval"
                          : "1. Approve Permit2"}
                    </button>
                    <button
                      disabled={!ready || !tokenApproved || permitApproved}
                      onClick={() =>
                        void guarded(async () => {
                          const block = await publicClient.getBlock();
                          await send(
                            "Router permission",
                            d.network.uniswapV4.permit2,
                            permitAbi,
                            "approve",
                            [
                              featured,
                              d.network.uniswapV4.universalRouter,
                              swapValue,
                              Number(block.timestamp + 3600n),
                            ],
                          );
                        })
                      }
                    >
                      {permitApproved
                        ? "2. Router permitted"
                        : "2. Permit router"}
                    </button>
                  </>
                )}
                <button
                  disabled={!ready || !quoteFresh || !swapStepsReady}
                  onClick={() => void swap()}
                >
                  Swap {buy ? native : "DRIP"} for {buy ? "DRIP" : native}
                </button>
              </div>
              {quote && (
                <div className="quote-panel">
                  <div>
                    <span>Estimated receive</span>
                    <strong>
                      {display(quote.output, 18)} {buy ? "DRIP" : native}
                    </strong>
                  </div>
                  <div>
                    <span>Minimum received · {slippage}% slippage</span>
                    <strong>
                      {formatUnits(quote.min, 18)} {buy ? "DRIP" : native}
                    </strong>
                  </div>
                  <div>
                    <span>Rate per 1 {buy ? native : "DRIP"}</span>
                    <strong>
                      {display((quote.output * 10n ** 18n) / quote.input, 18)}{" "}
                      {buy ? "DRIP" : native}
                    </strong>
                  </div>
                  <p>
                    {quoteFresh
                      ? `Quote expires in ${Math.max(0, 60 - Math.floor((clock - quote.created) / 1000))}s. Swap deadline: 5 minutes.`
                      : "Quote expired. Get a new quote before swapping."}
                  </p>
                </div>
              )}
              <p className="footnote">
                {buy
                  ? `${native} swaps need no token approval.`
                  : "Selling DRIP needs two permissions: the token to Permit2, then Permit2 to the router. Permissions use the exact input amount; router permission lasts one hour."}{" "}
                The swap is simulated before your wallet asks you to sign. Rates
                can change before confirmation.
              </p>
              <p className="faucet-links">
                Need test ETH?{" "}
                {d.network.faucets.map((url, i) => (
                  <External key={url} href={url}>
                    {i === 0 ? "Google Cloud faucet" : "Alchemy faucet"}
                  </External>
                ))}
              </p>
            </div>
          </details>
        </section>
        <section className="fine-print">
          <div>
            <h2>Open by design.</h2>
            <p>
              No owner. No withdrawal switch. The pool is the token balance held
              by the faucet, including direct transfers. Each token’s balance,
              decimals and transfers are trusted; a malicious token can hurt its
              own pool. Unsupported or frozen tokens have no rescue path.
            </p>
          </div>
          <div>
            <h2>Check it on chain.</h2>
            <div className="contract-links">
              {d.contracts.map((c) => (
                <External key={c.name} href={explorer(c.address)}>
                  {c.name} <span className="mono">{short(c.address)}</span>
                </External>
              ))}
            </div>
            <p className="footnote">
              {verified
                ? "ABI hashes, RPC chain, deployed code and featured token checked."
                : "Verification is required before transactions."}{" "}
              {address && current
                ? `You have donated ${fmt(current.donated)} ${symbol}.`
                : ""}
            </p>
          </div>
        </section>
      </main>
      <footer className="wrap">
        <span className="footer-brand">drip.</span>
        <span>Made for experiments. Filled by people.</span>
        <a href="./imd-deployment.json">Deployment record ↗</a>
      </footer>
    </>
  );
}
