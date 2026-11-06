/**
 * The seller key as a signer. The key stays inside this closure: the link, the publisher and the
 * screen only ever see the address and the two signing functions.
 */

import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { PhoneSigner } from "./link.ts";

export function signerFromKey(key: Hex): PhoneSigner {
  const account = privateKeyToAccount(key);
  return {
    address: account.address,
    signMessage: ({ message }) => account.signMessage({ message }),
    signTypedData: (data) => account.signTypedData(data as Parameters<typeof account.signTypedData>[0]),
  };
}
