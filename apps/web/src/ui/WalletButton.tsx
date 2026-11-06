import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { arcTestnet, chainName, shortAddress, whitechainTestnet } from "../lib/wallet.ts";

function hasInjectedProvider(): boolean {
  return typeof window !== "undefined" && "ethereum" in window;
}

function messageOf(error: { shortMessage?: string; message: string }): string {
  return error.shortMessage || error.message;
}

export function WalletButton() {
  const account = useAccount();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const { switchChain, reset: resetSwitch, error: switchError } = useSwitchChain();
  const error = connect.error ?? switchError;
  const connecting = account.status === "connecting" || account.status === "reconnecting" || connect.isPending;

  const startConnect = () => {
    connect.reset();
    resetSwitch();
    const connector = connect.connectors[0];
    if (connector) connect.connect({ connector });
  };

  const startSwitch = () => {
    connect.reset();
    resetSwitch();
    switchChain({ chainId: arcTestnet.id });
  };

  const disconnectNow = () => {
    connect.reset();
    resetSwitch();
    disconnect.disconnect();
  };

  return (
    <div className="wallet" aria-live="polite">
      {!hasInjectedProvider() ? (
        <>
          <span>No wallet in this browser</span>
          <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
            Get one
          </a>
        </>
      ) : account.status === "connected" ? (
        <>
          <span className="wallet__who mono">{shortAddress(account.address)}</span>
          <span aria-hidden="true"> · </span>
          <span>{chainName(account.chainId)}</span>
          {account.chainId !== arcTestnet.id && account.chainId !== whitechainTestnet.id ? (
            <button type="button" className="wallet__go" onClick={startSwitch}>
              Switch to Arc testnet
            </button>
          ) : null}
          <button type="button" className="wallet__quiet" onClick={disconnectNow}>
            Disconnect
          </button>
        </>
      ) : (
        <button type="button" className="wallet__go" onClick={startConnect} disabled={connecting}>
          {connecting ? "Connecting" : "Connect wallet"}
        </button>
      )}
      {error ? (
        <p className="wallet__error" role="status">
          {`The wallet did not connect: ${messageOf(error)}`}
        </p>
      ) : null}
    </div>
  );
}
