/**
 * Funds countersign's escrow on Whitechain through the relay: x402 scheme "countersign".
 * The buyer signs one EIP-3009 ReceiveWithAuthorization whose nonce is the jobId; the relay
 * verifies it with the shared escrow rail and pays the gas for fund().
 *
 *   set -a; . ~/.config/countersign/wc.env; set +a
 *   bun run packages/relay/scripts/pay-countersign.ts --amount 0.30 [--deadline 600] [--title "…"] [--relay http://127.0.0.1:8402]
 *
 * Prints the jobId and the funding transaction. The merchant then releases it against a slip,
 * or refunds it in one click while it is held. Never prints a key.
 */

import { getAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  countersignPayload,
  type CountersignExtra,
  type Offer,
  parseUnits,
} from "@countersign/core";
import { txUrl } from "../src/chain.ts";
import { whitechainRailFor } from "../src/whitechain-config.ts";

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
const seller = getAddress(args.get("seller") ?? process.env.WC_MERCHANT_ADDRESS ?? "");
const relay = args.get("relay") ?? "http://127.0.0.1:8402";
const now = Math.floor(Date.now() / 1000);

const offer: Offer = {
  v: 1,
  seller,
  title: args.get("title") ?? "Whitechain checkout",
  summary: "A paid call settled in USDT on Whitechain Sepolia through countersign's escrow.",
  adapter: "openapi",
  input: { type: "object" },
  output: { type: "object" },
  price: parseUnits(args.get("amount") ?? "0.30", 6).toString(),
  deadline: Number(args.get("deadline") ?? "600"),
  bond: "0",
  rails: ["whitechain"],
  issuedAt: now,
};

const requirements = whitechainRailFor().challenge(offer, { resource: `${relay}/checkout`, now });
const extra = requirements.extra as unknown as CountersignExtra;
const input = {
  terms: {
    offerHash: extra.offerHash,
    buyer: buyer.address,
    payee: getAddress(requirements.payTo),
    amount: requirements.amount,
    deadline: now + extra.deadlineSeconds,
    salt: BigInt(toHex(crypto.getRandomValues(new Uint8Array(16)))).toString(10),
  },
  chainId: extra.chainId,
  escrow: extra.escrow,
  token: getAddress(requirements.asset),
  tokenName: extra.tokenName,
  tokenVersion: extra.tokenVersion,
  validAfter: 0,
  validBefore: now + 600,
};
const signature = await buyer.signTypedData(authorizationTypedData(input));
const payload = countersignPayload(input, signature);
const body = {
  x402Version: 2,
  paymentPayload: {
    x402Version: 2,
    resource: { url: `${relay}/checkout`, description: offer.title },
    accepted: requirements,
    payload,
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

console.log(`buyer ${buyer.address} countersigns ${offer.title}: ${args.get("amount") ?? "0.30"} USDT to ${seller}, deadline ${offer.deadline}s`);
const verified = await post("/verify");
console.log("verify:", JSON.stringify(verified));
if (verified.isValid !== true) process.exit(1);
const settled = await post("/settle");
console.log("settle:", JSON.stringify(settled));
if (settled.success !== true) process.exit(1);
console.log(`jobId ${String(settled.jobId)}`);
console.log(`funded: ${txUrl(String(settled.transaction))}`);
