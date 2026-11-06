/**
 * cs-audit, Pashov final pass on #164 e513fe7 (M-relay): past a job's deadline only the escrow's arbiter may
 * release (LateReleaseNeedsArbiter), and on 1874 the arbiter IS this relay's key. So the relay must not
 * forward a late POST /escrow/release from anyone but the hub, or a seller in default turns its default
 * (amount + bond to the buyer) into payment plus its bond back. Red on cs/wc-09b 6f7e20b.
 * The chain is simulated; the simulation succeeds, as the real one does when the arbiter sends the call.
 */

import { describe, expect, test } from "bun:test";
import { getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  countersignPayload,
  type CountersignExtra,
  type CountersignTerms,
  jobIdOf,
  type Offer,
  offerHash,
} from "@countersign/core";
import { whitechainRail } from "@countersign/rail";
import { settleCountersign } from "../src/countersign-scheme.ts";
import { createRelayApp } from "../src/server.ts";
import { csContext, makeOffer } from "./escrow-support.ts";
import { createTestRelay, NOW } from "./support.ts";

const V2 = getAddress("0x7777777777777777777777777777777777777777");
const SIG: Hex = `0x${"34".repeat(65)}`;
const JUNK: Hex = `0x${"6a".repeat(32)}`;
const HUB_TOKEN = "a-hub-token-long-enough";

type TestRelay = ReturnType<typeof createTestRelay>;
let salt = 1000;

/** A v2 relay whose jobOf answers the funded job's status and on-chain deadline (uint64, a bigint in viem). */
function withV2(relay: TestRelay, deadlines: Map<string, bigint>) {
  relay.policy.allowedEscrows.push(V2);
  relay.policy.escrowV2 = V2;
  const read = relay.chain.readContract.bind(relay.chain);
  relay.chain.readContract = async (call) => {
    const jobId = String(call.args?.[0] ?? "").toLowerCase();
    if (call.functionName === "reviewOf") return [3600n, 0n, 0n] as const;
    if (call.functionName === "bondOfJob") return 500_000n;
    if (call.functionName === "tollBps") return 100n;
    if (call.functionName === "jobOf") {
      const base = (await read(call)) as { status: number };
      const deadline = deadlines.get(jobId) ?? 0n;
      return { ...base, status: base.status || (deadline ? 1 : 0), deadline };
    }
    return read(call);
  };
}

/** Fund a bonded, windowed v2 job through /settle, as the hub's whitechain rail does. */
async function fundedV2(relay: TestRelay, deadlines: Map<string, bigint>) {
  const buyer = privateKeyToAccount(generatePrivateKey());
  relay.chain.setBalance(buyer.address, 100_000_000n);
  const offer: Offer = { ...makeOffer(relay.merchant.address), bond: "500000", reviewWindow: 3600 };
  const rail = whitechainRail({ relayUrl: "http://relay", version: 2, escrow: V2 });
  const req = rail.challenge(offer, { resource: "http://merchant.example/x", now: NOW });
  const extra = req.extra as unknown as CountersignExtra & { bond?: string; reviewWindow?: number };
  salt += 1;
  const terms: CountersignTerms = {
    offerHash: offerHash(offer),
    buyer: buyer.address,
    payee: getAddress(req.payTo),
    amount: req.amount,
    deadline: NOW + extra.deadlineSeconds,
    salt: String(salt),
    bond: extra.bond ?? "0",
    reviewWindow: extra.reviewWindow ?? 0,
  };
  const input = {
    terms,
    chainId: extra.chainId,
    escrow: extra.escrow,
    token: getAddress(req.asset),
    tokenName: extra.tokenName,
    tokenVersion: extra.tokenVersion,
    validAfter: 0,
    validBefore: NOW + 600,
  };
  const signature = await buyer.signTypedData(authorizationTypedData(input));
  const payload = countersignPayload(input, signature);
  const jobId: Hex = jobIdOf(terms, extra.chainId, extra.escrow);
  const body = {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted: req,
      payload: payload as unknown as Record<string, unknown>,
      resource: { url: "http://merchant.example/x" },
    },
    paymentRequirements: req,
    lockSig: SIG,
  };
  const result = await settleCountersign(body, csContext(relay));
  expect(result.success).toBe(true);
  deadlines.set(jobId.toLowerCase(), BigInt(terms.deadline));
  return { jobId, deadline: terms.deadline };
}

function appAt(relay: TestRelay, now: number) {
  return createRelayApp({
    reader: relay.chain,
    relayer: relay.relayer,
    ledger: relay.ledger,
    now: () => now,
    config: { hubToken: HUB_TOKEN },
  });
}

function release(app: ReturnType<typeof createRelayApp>, jobId: Hex, headers: Record<string, string> = {}) {
  return app.request("/escrow/release", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jobId, slipHash: JUNK, sellerSig: SIG }),
  });
}

function releaseWrites(relay: TestRelay) {
  return relay.chain.writes.filter((w) => w.functionName === "release").length;
}

describe("cs-audit e513fe7: past the deadline /escrow/release is the hub's verdict, not anyone's", () => {
  test("a seller's late Release(junk) without the hub token is refused and nothing is submitted", async () => {
    const relay = createTestRelay();
    const deadlines = new Map<string, bigint>();
    withV2(relay, deadlines);
    const { jobId, deadline } = await fundedV2(relay, deadlines);

    const res = await release(appAt(relay, deadline + 1), jobId);

    expect([401, 403]).toContain(res.status);
    expect(releaseWrites(relay)).toBe(0);
    expect(relay.ledger.getJob(jobId)!.status).toBe("funded");
  });

  test("a late release with a wrong token is refused and nothing is submitted", async () => {
    const relay = createTestRelay();
    const deadlines = new Map<string, bigint>();
    withV2(relay, deadlines);
    const { jobId, deadline } = await fundedV2(relay, deadlines);

    const res = await release(appAt(relay, deadline + 1), jobId, { authorization: "Bearer wrong-token-wrong-token-xx" });

    expect([401, 403]).toContain(res.status);
    expect(releaseWrites(relay)).toBe(0);
  });

  test("H1: the hub's late release with its token is forwarded through settleBy", async () => {
    const relay = createTestRelay();
    const deadlines = new Map<string, bigint>();
    withV2(relay, deadlines);
    const { jobId, deadline } = await fundedV2(relay, deadlines);

    const res = await release(appAt(relay, deadline + 600), jobId, { authorization: `Bearer ${HUB_TOKEN}` });

    expect(res.status).toBe(200);
    expect(releaseWrites(relay)).toBe(1);
  });

  // orch-cs 19:44:14Z: only the arbiter may release, at any time, so on time is refused too.
  test("an on-time release (now == deadline) without the token is refused too, and nothing is submitted", async () => {
    const relay = createTestRelay();
    const deadlines = new Map<string, bigint>();
    withV2(relay, deadlines);
    const { jobId, deadline } = await fundedV2(relay, deadlines);

    const res = await release(appAt(relay, deadline), jobId);

    expect([401, 403]).toContain(res.status);
    expect(releaseWrites(relay)).toBe(0);
  });
});
