import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  offerHash,
  PAYMENT_SIGNATURE_HEADER,
  publishMessage,
  RUNNER_PATH,
  toBase64Json,
  type EnsResolve,
  type Offer,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
} from "../src/deps.ts";
import { createHub } from "../src/app.ts";
import type { HubDeps } from "../src/app.ts";
import { RunnerLink } from "../src/runners.ts";
import { Store } from "../src/store.ts";
import { FakeRail } from "./fake-rail.ts";

export const NOW = 1_700_000_000;
export const SELLER_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";
export const OTHER_KEY = "0x0000000000000000000000000000000000000000000000000000000000000002";
export const NONCE = `0x${"11".repeat(32)}` as Hex;

export const seller = privateKeyToAccount(SELLER_KEY);
export const other = privateKeyToAccount(OTHER_KEY);

export interface TestHub {
  url: string;
  store: Store;
  rail: FakeRail;
  rails: FakeRail[];
  runners: RunnerLink;
  deps: HubDeps & { runners: RunnerLink };
  setNow(at: number): void;
  close(): void;
}

export function startHub(options: { rails?: FakeRail[]; jobTimeoutMs?: number; ens?: EnsResolve } = {}): TestHub {
  const store = new Store(":memory:");
  const fallback = new FakeRail();
  const rails = options.rails ?? [fallback];
  const rail = rails[0] ?? fallback;
  let now = NOW;

  const deps: HubDeps = {
    store,
    rails,
    now: () => now,
    publicUrl: "http://hub.test",
    jobTimeoutMs: options.jobTimeoutMs ?? 2_000,
  };
  if (options.ens) deps.ens = options.ens;
  const { app, websocket, runners } = createHub(deps);
  const server = Bun.serve({
    port: 0,
    fetch: (request, bunServer) => app.fetch(request, bunServer),
    websocket,
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    store,
    rail,
    rails,
    runners,
    deps: { ...deps, runners },
    setNow: (at) => {
      now = at;
    },
    close: () => {
      runners.stop();
      server.stop(true);
    },
  };
}

export function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    v: 1,
    seller: seller.address,
    title: "Echo the question",
    summary: "Returns the question it was given.",
    adapter: "skill",
    input: {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
      additionalProperties: false,
    },
    price: "1000",
    deadline: 120,
    bond: "0",
    rails: ["escrow"],
    issuedAt: NOW,
    ...overrides,
  };
}

export async function publish(
  hub: TestHub,
  offer: Offer,
  signer: typeof seller | typeof other = seller,
): Promise<Response> {
  const sig = await signer.signMessage({ message: publishMessage(offerHash(offer)) });
  return fetch(`${hub.url}/offers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offer, sig }),
  });
}

export async function publishOk(hub: TestHub, offer: Offer): Promise<Hex> {
  const response = await publish(hub, offer);
  if (response.status !== 201) throw new Error(`publish failed with ${response.status}`);
  const body = (await response.json()) as { offerHash: Hex };
  return body.offerHash;
}

export function call(
  hub: TestHub,
  hash: Hex,
  input: unknown,
  payment?: PaymentPayload,
  lineage?: Hex[],
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (payment) headers[PAYMENT_SIGNATURE_HEADER] = toBase64Json(payment);
  const body = lineage !== undefined && lineage.length > 0 ? { input, lineage } : { input };
  return fetch(`${hub.url}/offers/${hash}/call`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export async function requirementsFor(hub: TestHub, hash: Hex): Promise<PaymentRequired> {
  const response = await call(hub, hash, { q: "hello" });
  if (response.status !== 402) throw new Error(`expected 402, got ${response.status}`);
  return (await response.json()) as PaymentRequired;
}

export function paymentFor(
  accepted: PaymentRequirements,
  nonce: Hex = NONCE,
  deadline = NOW + 60,
): PaymentPayload {
  return {
    x402Version: 2,
    accepted,
    payload: { authorization: { nonce }, terms: { deadline } },
  };
}

export function wsUrl(hub: TestHub): string {
  return `${hub.url.replace(/^http/, "ws")}${RUNNER_PATH}`;
}

export function sellerAddress(): Address {
  return seller.address;
}
