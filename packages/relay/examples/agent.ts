import { privateKeyToAccount } from "viem/accounts";
import { createPayFetch } from "../src/pay-fetch.ts";
import { txUrl } from "../src/chain.ts";

const key = process.env.WC_BUYER_PRIVATE_KEY;
if (!key) throw new Error("WC_BUYER_PRIVATE_KEY is required");
const pay = createPayFetch({
  account: privateKeyToAccount(key as `0x${string}`),
  maxPerCall: "0.10",
});

const response = await pay("http://127.0.0.1:8404/forecast");
console.log(JSON.stringify(await response.json(), null, 2));
if (response.payment) {
  console.log(`settled: ${txUrl(response.payment.transaction)}`);
  console.log(`spent: ${pay.spent()} USDT`);
}
