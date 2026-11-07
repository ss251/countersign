import type { JSX } from "react";
import { CopyButton } from "./primitives.tsx";

/** The header's Copy for the connected wallet's full address (captain, firstmate 02:10:53Z): the same copy component. */
export function WalletAddressCopy({ address }: { address: string }): JSX.Element {
  return <CopyButton value={address} label="wallet address" />;
}
