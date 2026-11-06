import { useEffect, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { retryPrivy, useWalletMode, watchdogReason } from "../app/Providers.tsx";
import { arcTestnet, chainName, shortAddress, whitechainTestnet } from "../lib/wallet.ts";

function hasInjectedProvider(): boolean {
  return typeof window !== "undefined" && "ethereum" in window;
}

function messageOf(error: { shortMessage?: string; message: string }): string {
  return error.shortMessage || error.message;
}

type MenuOption = {
  testId: string;
  label: string;
  href?: string;
  onSelect?: () => void;
};

type WalletBodyProps = {
  signIn?: () => void | Promise<void>;
  connectBrowser: () => void;
  beforeDisconnect?: () => Promise<void>;
  reason: string | null;
  /** Options after the browser wallet, e.g. another try at email sign-in. */
  more?: MenuOption[];
  /** The closed button's words: a sign-in where email works, else a connect. */
  cta: string;
  /** Which kind of wallet holds this address, for e2e/human's data-kind. */
  kindOf?: (address: string | undefined) => "privy" | "injected";
};

function WalletBody({ signIn, connectBrowser, beforeDisconnect, reason, more = [], cta, kindOf = () => "injected" }: WalletBodyProps) {
  const account = useAccount();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const { switchChain, reset: resetSwitch, error: switchError } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const error = connect.error ?? switchError;
  const connecting = account.status === "connecting" || account.status === "reconnecting" || connect.isPending;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const startSwitch = () => {
    resetSwitch();
    switchChain({ chainId: arcTestnet.id });
  };

  const disconnectNow = async () => {
    connect.reset();
    resetSwitch();
    try {
      await beforeDisconnect?.();
    } finally {
      disconnect.disconnect();
    }
  };

  const options: MenuOption[] = [];
  if (signIn) {
    options.push({
      testId: "wallet-signin",
      label: "Sign in with email or passkey",
      onSelect: () => void signIn(),
    });
  }
  if (hasInjectedProvider()) {
    options.push({
      testId: "wallet-connect-injected",
      label: "Connect a browser wallet",
      onSelect: connectBrowser,
    });
  } else {
    options.push({
      testId: "wallet-connect-injected",
      label: "No wallet in this browser · Get one",
      href: "https://metamask.io/download/",
    });
  }
  options.push(...more);

  return (
    <div className="wallet" aria-live="polite" ref={root}>
      {account.status === "connected" ? (
        <>
          <span
            className="wallet__who mono"
            data-testid="wallet-address"
            data-value={account.address}
            data-kind={kindOf(account.address)}
          >
            {shortAddress(account.address)}
          </span>
          <span aria-hidden="true"> · </span>
          <span data-testid="wallet-chain" data-value={account.chainId}>
            {chainName(account.chainId)}
          </span>
          {account.chainId !== arcTestnet.id && account.chainId !== whitechainTestnet.id ? (
            <button type="button" className="wallet__go" onClick={startSwitch}>
              Switch to Arc testnet
            </button>
          ) : null}
          <button
            type="button"
            className="wallet__quiet"
            data-testid="wallet-disconnect"
            onClick={() => void disconnectNow()}
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="wallet__go"
            data-testid="wallet-menu"
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => {
              connect.reset();
              resetSwitch();
              setOpen((visible) => !visible);
            }}
            disabled={connecting}
          >
            {connecting ? "Connecting" : cta}
          </button>
          {open ? (
            <div className="wallet__menu" role="menu">
              {options.map((option) =>
                option.href ? (
                  <a
                    key={option.testId}
                    className="wallet__item"
                    data-testid={option.testId}
                    href={option.href}
                    target="_blank"
                    rel="noreferrer"
                    role="menuitem"
                  >
                    {option.label}
                  </a>
                ) : (
                  <button
                    key={option.testId}
                    type="button"
                    className="wallet__item"
                    data-testid={option.testId}
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      option.onSelect?.();
                    }}
                  >
                    {option.label}
                  </button>
                ),
              )}
              {reason ? (
                <p className="wallet__why" data-testid="wallet-fallback-reason">
                  {reason}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {error ? (
        <p className="wallet__error" role="status">
          {`The wallet did not connect: ${messageOf(error)}`}
        </p>
      ) : null}
    </div>
  );
}

function PrivyWalletButton() {
  const { login, connectWallet, logout } = usePrivy();
  const { wallets } = useWallets();
  // Privy's embedded wallet reports walletClientType "privy"; anything else came from the browser.
  const kindOf = (address: string | undefined) =>
    wallets.find((w) => w.address.toLowerCase() === address?.toLowerCase())?.walletClientType === "privy" ? "privy" : "injected";

  return (
    <WalletBody
      signIn={() => login()}
      connectBrowser={() => connectWallet()}
      beforeDisconnect={() => logout()}
      reason={null}
      cta="Sign in"
      kindOf={kindOf}
    />
  );
}

function InjectedWalletButton({ reason }: { reason: string | null }) {
  const connect = useConnect();

  const connectBrowser = () => {
    const connector = connect.connectors[0];
    if (connector) connect.connect({ connector });
  };

  // Only a failed start gets another try; with no app id there is nothing to retry.
  const more: MenuOption[] =
    reason === watchdogReason
      ? [{ testId: "wallet-privy-retry", label: "Try email sign-in again", onSelect: retryPrivy }]
      : [];

  return <WalletBody connectBrowser={connectBrowser} reason={reason} more={more} cta="Connect" />;
}

export function WalletButton() {
  const mode = useWalletMode();
  return mode.privy ? <PrivyWalletButton /> : <InjectedWalletButton reason={mode.reason} />;
}
