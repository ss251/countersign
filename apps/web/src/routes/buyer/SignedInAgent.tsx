import { useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { setSignedInAgent, signedInAgent } from "../../lib/hub.ts";

/**
 * Makes the phone follow the wallet the person signed in with: Privy's embedded wallet. Mounted only
 * where Privy is available, so no other screen has to ask a wallet provider for it.
 */
export function SignedInAgent({ onChange }: { onChange: () => void }) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");

  useEffect(() => {
    const next = authenticated && embedded ? embedded.address : null;
    if (next !== signedInAgent()) {
      setSignedInAgent(next);
      onChange();
    }
  }, [authenticated, embedded, onChange]);

  return null;
}
