/**
 * A deliberately failing seller, for the escrow v2 failDelivery proof (#98, STEER-1950 item 3).
 *
 * It publishes one offer with a bond on a hub, connects as that offer's runner, and answers every job
 * with an output that differs from the outputHash in the slip it signs. The hub's delivery gate sees
 * the mismatch, the escrow's arbiter calls failDelivery, and the buyer gets the amount plus the bond.
 * It never serves real work: point it only at a hub and an escrow you are proving on.
 *
 * Before running it, the seller's v2 terms and free bond must be on chain (packages/runner `bond terms`
 * and `bond deposit`): the escrow funds a bonded job only at the terms its payee registered.
 *
 *   JUNK_SELLER_KEY is read from the environment, never from argv; start it inside a child shell:
 *   env -i PATH="$PATH" HOME="$HOME" bash -c 'JUNK_SELLER_KEY=$(grep ...); export JUNK_SELLER_KEY;
 *     exec bun scripts/demo/junk-seller.ts --hub <url> --price <atomic> --bond <atomic> [--rails escrow]'
 */

import {
  canonicalHash,
  offerHash,
  publishMessage,
  RUNNER_PATH,
  runnerAuthMessage,
  slipBodyFor,
  slipHash,
  slipTypedData,
  type HubToRunner,
  type Offer,
  type RailId,
  type RunnerToHub,
} from "../../packages/core/src/index.ts";
import { privateKeyToAccount, type Hex } from "../../packages/identity/src/clients.ts";

function flag(name: string, fallback?: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : fallback;
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}

const key = process.env.JUNK_SELLER_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("JUNK_SELLER_KEY must be set in the environment");
const account = privateKeyToAccount(key as Hex);
const hub = flag("hub").replace(/\/+$/, "");
const price = flag("price");
const bond = flag("bond");
const rails = flag("rails", "escrow").split(",") as RailId[];
const now = (): number => Math.floor(Date.now() / 1000);

const offer: Offer = {
  v: 1,
  seller: account.address,
  title: "failDelivery proof: a seller whose output never matches its slip",
  summary: "Deliberately fails the hub's delivery gate, so the escrow pays the buyer the amount plus the bond.",
  adapter: "skill",
  input: { type: "object", properties: { question: { type: "string", maxLength: 200 } }, additionalProperties: false },
  output: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
  price,
  deadline: 120,
  bond,
  reviewWindow: 60,
  rails,
  issuedAt: now(),
};
const hash = offerHash(offer);

const published = await fetch(`${hub}/offers`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ offer, sig: await account.signMessage({ message: publishMessage(hash) }) }),
});
if (!published.ok) throw new Error(`publish answered ${published.status}: ${await published.text()}`);
console.log(`[junk-seller] published ${hash} (price ${price}, bond ${bond}) as ${account.address}`);

const socket = new WebSocket(`${hub.replace(/^http/, "ws")}${RUNNER_PATH}`);
const send = (message: RunnerToHub): void => socket.send(JSON.stringify(message));

socket.addEventListener("message", async (event: MessageEvent) => {
  const message = JSON.parse(String(event.data)) as HubToRunner;
  if (message.t === "challenge") {
    const sig = await account.signMessage({ message: runnerAuthMessage(message.nonce) });
    send({ t: "hello", seller: account.address, offers: [hash], nonce: message.nonce, sig });
  } else if (message.t === "ready") {
    console.log("[junk-seller] serving; every delivery will fail the gate");
  } else if (message.t === "ping") {
    send({ t: "pong", ts: message.ts });
  } else if (message.t === "job") {
    const order = message.order;
    // The slip commits one output; the result carries another. Its signature is genuine, its content is not.
    const signedFor = { answer: "the output this slip commits to" };
    const delivered = { answer: "a different output: junk" };
    const body = slipBodyFor(order, account.address, canonicalHash(order.input), canonicalHash(signedFor), now());
    const sellerSig = await account.signTypedData(slipTypedData(body));
    send({ t: "result", jobId: order.jobId, output: delivered, slip: { body, hash: slipHash(body), sellerSig } });
    console.log(`[junk-seller] delivered junk for job ${order.jobId}`);
  } else if (message.t === "error") {
    console.error(`[junk-seller] hub: ${message.message}`);
  }
});
socket.addEventListener("close", () => {
  console.log("[junk-seller] disconnected");
  process.exit(0);
});
