/**
 * Pays a Whitechain merchant in USDT over x402 "exact", through the relay. The buyer signs one
 * EIP-3009 authorisation and never holds WBT; the relay verifies it and pays the gas.
 *
 *   set -a; . ~/.config/countersign/wc.env; set +a
 *   bun run packages/relay/scripts/pay-exact.ts --amount 0.25 [--relay http://127.0.0.1:8402] [--to 0x…] [--resource <url>]
 *
 * Prints the settlement transaction and its explorer link. Never prints a key.
 */

import { getAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseUnits } from "@countersign/core";
import { NETWORK, USDT, txUrl } from "../src/chain.ts";
import { authorizationToWire, signAuthorization } from "../src/eip3009.ts";
import type { Authorization } from "../src/eip3009.ts";

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const flag = argv[i];
  const value = argv[i + 1];
  if (!flag?.startsWith("--") || value === undefined) throw new Error(`bad argument near ${flag ?? "end"}`);
  args.set(flag.slice(2), value);
}

const key = process.env.WC_BUYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("WC_BUYER_PRIVATE_KEY is missing or malformed");
const buyer = privateKeyToAccount(key as `0x${string}`);
const relay = args.get("relay") ?? "http://127.0.0.1:8402";
const payTo = getAddress(args.get("to") ?? process.env.WC_MERCHANT_ADDRESS ?? "");
const amount = parseUnits(args.get("amount") ?? "0.25", USDT.decimals);
const resource = args.get("resource") ?? "https://countersign.local/whitechain/checkout";
const now = Math.floor(Date.now() / 1000);

const authorization: Authorization = {
  from: buyer.address,
  to: payTo,
  value: amount,
  validAfter: 0n,
  validBefore: BigInt(now + 120),
  nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
};
const signature = await signAuthorization(buyer, authorization);

const requirements = {
  scheme: "exact",
  network: NETWORK,
  amount: amount.toString(),
  asset: USDT.address,
  payTo,
  maxTimeoutSeconds: 120,
  extra: { assetTransferMethod: "eip3009", name: USDT.name, version: USDT.version },
};
const body = {
  x402Version: 2,
  paymentPayload: {
    x402Version: 2,
    resource: { url: resource, description: "countersign checkout on Whitechain" },
    accepted: requirements,
    payload: { signature, authorization: authorizationToWire(authorization) },
  },
  paymentRequirements: requirements,
};

async function post(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${relay}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

console.log(`buyer ${buyer.address} pays ${args.get("amount") ?? "0.25"} USDT to ${payTo} on ${NETWORK}`);
const verified = await post("/verify");
console.log("verify:", JSON.stringify(verified));
if (verified.isValid !== true) process.exit(1);
const settled = await post("/settle");
console.log("settle:", JSON.stringify(settled));
if (settled.success !== true) process.exit(1);
console.log(`settled: ${txUrl(String(settled.transaction))}`);
