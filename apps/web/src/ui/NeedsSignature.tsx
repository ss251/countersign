import { useAccount, useConnect } from "wagmi";
import { chainName, shortAddress } from "../lib/wallet.ts";

export function NeedsSignature() {
  const account = useAccount();
  const connect = useConnect();

  if (account.status === "connected") {
    return (
      <p className="needs-sig">
        Your wallet <span className="mono">{shortAddress(account.address)}</span> is connected on {chainName(account.chainId)}.
      </p>
    );
  }

  const startConnect = () => {
    connect.reset();
    const connector = connect.connectors[0];
    if (connector) connect.connect({ connector });
  };

  return (
    <p className="needs-sig">
      To sign in this browser instead, connect a wallet.{" "}
      <button type="button" className="wallet__go" onClick={startConnect} disabled={connect.isPending}>
        Connect wallet
      </button>
    </p>
  );
}
