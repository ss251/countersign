import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import {
  WagmiProvider as PrivyWagmiProvider,
  createConfig as createPrivyWagmiConfig,
} from "@privy-io/wagmi";
import { WagmiProvider, http } from "wagmi";
import {
  PRIVY_APP_ID,
  arcTestnet,
  walletConfig,
  walletModeFor,
  whitechainTestnet,
  type WalletMode,
} from "../lib/wallet.ts";

const queryClient = new QueryClient();

const privyWagmiConfig = createPrivyWagmiConfig({
  chains: [arcTestnet, whitechainTestnet],
  transports: {
    [arcTestnet.id]: http(),
    [whitechainTestnet.id]: http(),
  },
});

const failureKey = "countersign.privy-failed";
/**
 * Privy's ready must come within this long, or the console drops to the injected wallet with its reason line and
 * an enabled "Connect a browser wallet": the menu's waiting options can never stay disabled for good.
 */
export const watchdogAfter = 8_000;
export const watchdogReason = "Email sign-in did not start on this page, so connect a browser wallet.";

/** Forget this tab's Privy failure and load the page again, so email sign-in gets another try. */
export function retryPrivy(): void {
  try {
    sessionStorage.removeItem(failureKey);
  } catch {
    // Private mode: nothing was kept.
  }
  window.location.reload();
}

export const WalletModeContext = createContext<WalletMode>({ privy: false, reason: null });

export function useWalletMode(): WalletMode {
  return useContext(WalletModeContext);
}

function rememberedFailure(): string | null {
  try {
    return sessionStorage.getItem(failureKey);
  } catch {
    return null;
  }
}

function rememberFailure(reason: string): void {
  try {
    sessionStorage.setItem(failureKey, reason);
  } catch {
  }
}

function PrivyWatchdog({ onFail }: { onFail: (reason: string) => void }) {
  const { ready } = usePrivy();

  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => onFail(watchdogReason), watchdogAfter);
    return () => clearTimeout(timer);
  }, [onFail, ready]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [failed, setFailed] = useState<string | null>(rememberedFailure);
  const fail = useCallback((reason: string) => {
    rememberFailure(reason);
    setFailed(reason);
  }, []);
  const mode = walletModeFor(PRIVY_APP_ID, failed);

  if (!mode.privy || !PRIVY_APP_ID) {
    return (
      <WalletModeContext.Provider value={mode}>
        {/* Nothing touches a wallet on load: it connects only when the person clicks Connect (STEER-2225). */}
        <WagmiProvider config={walletConfig} reconnectOnMount={false}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </WagmiProvider>
      </WalletModeContext.Provider>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "passkey", "wallet"],
        // showWalletUIs pinned on: the embedded wallet always shows its prompt before it signs, whatever the
        // dashboard says, so no script on the page can sign a payment the person never saw (cs-w1, PR #190).
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: true },
        defaultChain: arcTestnet,
        supportedChains: [arcTestnet, whitechainTestnet],
      }}
    >
      <PrivyWatchdog onFail={fail} />
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={privyWagmiConfig} reconnectOnMount={false}>
          <WalletModeContext.Provider value={mode}>{children}</WalletModeContext.Provider>
        </PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
