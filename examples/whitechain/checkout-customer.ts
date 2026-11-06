import { createPayFetch } from "@countersign-hub/relay/browser";
import type { Address, LocalAccount } from "viem";

// Pay the 402 from your wallet. You hold USDT only, never WBT.
export async function buy(account: LocalAccount, url: string, merchant: Address) {
  const pay = createPayFetch({ account, maxPerCall: "0.10", payTo: [merchant] });
  const res = await pay(url);
  return { item: await res.json(), receipt: res.payment ?? null };
}
