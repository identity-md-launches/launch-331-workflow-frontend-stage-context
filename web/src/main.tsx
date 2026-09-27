import React from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider, createConfig, http, fallback } from "wagmi";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadDeployment } from "./config";
import App from "./App";
import "./style.css";
const root = createRoot(document.getElementById("root")!);
root.render(
  <main className="boot">
    <p className="eyebrow">Drip / Sepolia faucet</p>
    <h1>A little goes a long way.</h1>
    <p role="status">Checking deployment configuration…</p>
  </main>,
);
loadDeployment()
  .then((config) => {
    const wagmi = createConfig({
      chains: [config.chain],
      connectors: [injected()],
      transports: {
        [config.chain.id]: fallback(
          config.deployment.network.rpcUrls.map((url) => http(url)),
        ),
      },
      ssr: false,
    });
    root.render(
      <React.StrictMode>
        <WagmiProvider config={wagmi}>
          <QueryClientProvider client={new QueryClient()}>
            <App config={config} />
          </QueryClientProvider>
        </WagmiProvider>
      </React.StrictMode>,
    );
  })
  .catch((error) =>
    root.render(
      <main className="boot">
        <p className="eyebrow">Drip / Sepolia faucet</p>
        <h1>Unable to load this deployment.</h1>
        <p role="alert">{String(error.message)}</p>
        <button onClick={() => location.reload()}>Reload page</button>
      </main>,
    ),
  );
