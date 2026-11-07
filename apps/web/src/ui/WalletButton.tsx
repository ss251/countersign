import { useEffect, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { retryPrivy, useWalletMode, watchdogReason } from "../app/Providers.tsx";
import {
  connectHashPack,
  disconnectHashPack,
  HASHPACK_ENABLED,
  useHashPack,
  type HashPackStatus,
} from "../lib/hashpack.ts";
import { getHederaAccount, HEDERA_BUY_EVENT, type HederaAccount } from "../lib/hedera.ts";
import { isOwnHub } from "../lib/hub.ts";
import { arcTestnet, chainName, shortAddress, whitechainTestnet } from "../lib/wallet.ts";
import { CopyButton } from "./primitives.tsx";

const HEDERA_FAUCET = "https://faucet.circle.com";

function hasInjectedProvider(): boolean {
  return typeof window !== "undefined" && "ethereum" in window;
}

function messageOf(error: { shortMessage?: string; message: string }): string {
  return error.shortMessage || error.message;
}

export type MenuOption = {
  testId: string;
  label: string;
  href?: string;
  onSelect?: () => void;
  /** Not yet usable, e.g. Privy has not reported ready: a click would do nothing, so it cannot be clicked. */
  disabled?: boolean;
};

/**
 * The menu's options, in order. Privy's login and connectWallet do nothing until usePrivy().ready, so while
 * it starts both say so and cannot be pressed (cs-e2e, run 20261106-174813-90b8: a quick click did nothing).
 */
export function menuOptions(a: {
  signIn?: () => void;
  connectBrowser: () => void;
  injected: boolean;
  starting: boolean;
  more?: MenuOption[];
}): MenuOption[] {
  const options: MenuOption[] = [];
  if (a.signIn) {
    const signIn = a.signIn;
    options.push({
      testId: "wallet-signin",
      label: a.starting ? "Loading sign-in…" : "Sign in with email or passkey",
      onSelect: () => signIn(),
      disabled: a.starting,
    });
  }
  if (a.injected) {
    options.push({
      testId: "wallet-connect-injected",
      label: "Connect a browser wallet",
      onSelect: a.connectBrowser,
      disabled: a.starting,
    });
  } else {
    options.push({
      testId: "wallet-connect-injected",
      label: "No wallet in this browser · Get one",
      href: "https://metamask.io/download/",
    });
  }
  options.push(...(a.more ?? []));
  return options;
}

/**
 * HashPack beside the other wallets: the same words and quiet buttons, shown only when the console
 * was built with VITE_HASHPACK=1. Connecting opens the HashPack extension or the pairing modal.
 */
export function HashPackControls({
  enabled,
  status,
  accountId,
  error,
  onConnect,
  onDisconnect,
}: {
  enabled: boolean;
  status: HashPackStatus;
  accountId: string | null;
  error: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (!enabled) return null;
  if (status === "connected" && accountId) {
    return (
      <span className="wallet__hashpack" data-testid="hashpack-connected">
        <span aria-hidden="true"> · </span>
        <span className="wallet__who mono">HashPack · {accountId}</span>
        <span aria-hidden="true"> · </span>
        <button type="button" className="wallet__quiet" data-testid="hashpack-disconnect" onClick={onDisconnect}>
          Disconnect
        </button>
      </span>
    );
  }
  return (
    <span className="wallet__hashpack" data-testid="hashpack-menu">
      <span aria-hidden="true"> · </span>
      <button
        type="button"
        className="wallet__quiet"
        data-testid="hashpack-connect"
        disabled={status === "connecting"}
        onClick={onConnect}
      >
        {status === "connecting" ? "Connecting HashPack…" : "Connect HashPack"}
      </button>
      {status === "error" && error ? (
        <span className="wallet__error" role="status" data-testid="hashpack-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}

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
  /** Privy has not reported ready yet, so its options wait. */
  starting?: boolean;
  /** The signed-in person's Hedera account, when the hub has the feature on. */
  hedera?: HederaAccount | null;
};

function WalletBody({
  signIn,
  connectBrowser,
  beforeDisconnect,
  reason,
  more = [],
  cta,
  kindOf = () => "injected",
  starting = false,
  hedera = null,
}: WalletBodyProps) {
  const account = useAccount();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const { switchChain, reset: resetSwitch, error: switchError } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const hashpack = useHashPack();
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

  const options = menuOptions({
    signIn: signIn ? () => void signIn() : undefined,
    connectBrowser,
    injected: hasInjectedProvider(),
    starting,
    more,
  });

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
          <HederaAccountLine account={hedera} />
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
                    data-state={option.disabled ? "loading" : "ready"}
                    role="menuitem"
                    disabled={option.disabled}
                    aria-disabled={option.disabled || undefined}
                    onClick={() => {
                      if (option.disabled) return;
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
      <HashPackControls
        enabled={HASHPACK_ENABLED}
        status={hashpack.status}
        accountId={hashpack.accountId}
        error={hashpack.error}
        onConnect={() => {
          void connectHashPack().catch(() => undefined);
        }}
        onDisconnect={() => {
          void disconnectHashPack().catch(() => undefined);
        }}
      />
    </div>
  );
}

/** One line in the signed-in menu: the Hedera account, a copy button, and the Testnet faucet. */
export function HederaAccountLine({ account }: { account: HederaAccount | null }) {
  if (!account) return null;
  return (
    <span className="wallet__why" data-testid="wallet-hedera" data-account-id={account.accountId}>
      Hedera account <span className="mono">{account.accountId}</span> · {account.usdc} USDC
      <CopyButton value={account.accountId} label="Hedera account" />
      <a data-testid="wallet-hedera-faucet" href={HEDERA_FAUCET} target="_blank" rel="noopener noreferrer">
        Fund on faucet.circle.com (Hedera Testnet)
      </a>
    </span>
  );
}

/**
 * The page-load read. Only this console's own hub may see the person's Privy token, so a ?hub= link
 * never turns the sign-in menu into a request to another host.
 */
export async function loadHederaAccount(getAccessToken: () => Promise<string | null>): Promise<HederaAccount | null> {
  if (!isOwnHub()) return null;
  const token = await getAccessToken();
  if (!token) return null;
  return getHederaAccount(token);
}

/** The wallet line shows only on this console's own hub, whatever a page already read. */
export function ownHubHederaAccount(account: HederaAccount | null): HederaAccount | null {
  return isOwnHub() ? account : null;
}

/** Read the Hedera account once signed in, and again whenever a purchase on the card settles. */
function useHederaAccount(ready: boolean, authenticated: boolean, getAccessToken: () => Promise<string | null>): HederaAccount | null {
  const [account, setAccount] = useState<HederaAccount | null>(null);
  const tokenOf = useRef(getAccessToken);
  tokenOf.current = getAccessToken;

  useEffect(() => {
    if (!ready || !authenticated) {
      setAccount(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const found = await loadHederaAccount(tokenOf.current);
        if (alive) setAccount(found);
      } catch {
        // The line simply does not show: the hub is off, starting, or unreachable.
        if (alive) setAccount(null);
      }
    };
    void load();
    const onBuy = () => void load();
    window.addEventListener(HEDERA_BUY_EVENT, onBuy);
    return () => {
      alive = false;
      window.removeEventListener(HEDERA_BUY_EVENT, onBuy);
    };
  }, [ready, authenticated]);

  return account;
}

function PrivyWalletButton() {
  const { ready, login, connectWallet, logout, authenticated, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const hedera = useHederaAccount(ready, authenticated, getAccessToken);
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
      starting={!ready}
      hedera={ownHubHederaAccount(hedera)}
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
