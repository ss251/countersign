/**
 * On v2 only the escrow's arbiter may release, at any time, and on Whitechain the arbiter is the
 * relay's own key. So every v2 /escrow/release needs the hub's bearer token, exactly as /escrow/fail
 * does; a v1 release is unchanged. The chain is
 * simulated; nothing here reaches a network.
 */

import { describe, expect, test } from "bun:test";
import { getAddress, type Hex } from "viem";
import { WHITECHAIN_ESCROW } from "../src/whitechain-config.ts";
import { createRelayApp } from "../src/server.ts";
import { createTestRelay, fakeHash, NOW } from "./support.ts";

const V2 = getAddress("0x7777777777777777777777777777777777777777");
const SIG: Hex = `0x${"34".repeat(65)}`;
const JUNK_SLIP: Hex = `0x${"de".repeat(32)}`;
const HUB_TOKEN = "a-hub-token-long-enough";

type TestRelay = ReturnType<typeof createTestRelay>;

let salt = 0;

/** A funded job on the ledger and on the simulated chain, with this on-chain deadline. */
function fundedJob(relay: TestRelay, escrow: string, deadline: number) {
  salt += 1;
  const jobId = `0x${salt.toString(16).padStart(64, "0")}` as Hex;
  relay.policy.allowedEscrows.push(V2);
  relay.policy.escrowV2 = V2;
  relay.ledger.recordJob({
    jobId,
    offerHash: fakeHash(),
    buyer: "0x1111111111111111111111111111111111111111",
    payee: relay.merchant.address,
    amount: 1_500_000n,
    deadline,
    fundTx: fakeHash(),
    fundBlock: 1n,
    status: "funded",
    createdAt: NOW * 1000,
    escrow,
    bond: "0",
    ...(escrow === V2 ? { reviewWindow: 0 } : {}),
  });
  const read = relay.chain.readContract.bind(relay.chain);
  relay.chain.readContract = async (call) => {
    const id = String(call.args?.[0] ?? "").toLowerCase();
    if (call.functionName === "jobOf" && id === jobId.toLowerCase()) {
      return { status: 1, deadline: BigInt(deadline) };
    }
    if (call.functionName === "reviewOf") return [0n, 0n, 0n];
    if (call.functionName === "bondOfJob") return 0n;
    if (call.functionName === "tollBps") return 100n;
    return read(call);
  };
  return jobId;
}

function appFor(relay: TestRelay, hubToken?: string) {
  return createRelayApp({
    reader: relay.chain,
    relayer: relay.relayer,
    ledger: relay.ledger,
    now: () => NOW,
    config: hubToken ? { hubToken } : {},
  });
}

function release(app: ReturnType<typeof createRelayApp>, jobId: Hex, headers: Record<string, string> = {}) {
  return app.request("/escrow/release", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jobId, slipHash: JUNK_SLIP, sellerSig: SIG }),
  });
}

function releases(relay: TestRelay): number {
  return relay.chain.writes.filter((call) => call.functionName === "release").length;
}

describe("on v2 every release needs the hub", () => {
  test("a seller's Release(junk) without the hub token is refused 401, and nothing is submitted", async () => {
    const relay = createTestRelay();
    const jobId = fundedJob(relay, V2, NOW + 3600);
    const res = await release(appFor(relay, HUB_TOKEN), jobId);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "hub_auth_required" });
    expect(releases(relay)).toBe(0);
  });

  test("past the deadline it is refused the same way", async () => {
    const relay = createTestRelay();
    const jobId = fundedJob(relay, V2, NOW - 10);
    const res = await release(appFor(relay, HUB_TOKEN), jobId);
    expect(res.status).toBe(401);
    expect(releases(relay)).toBe(0);
  });

  test("a wrong bearer is the same as none", async () => {
    const relay = createTestRelay();
    const jobId = fundedJob(relay, V2, NOW + 3600);
    const res = await release(appFor(relay, HUB_TOKEN), jobId, { authorization: "Bearer not-the-hub-token-at-all" });
    expect(res.status).toBe(401);
    expect(releases(relay)).toBe(0);
  });

  test("with the hub token a release is forwarded, on time and late alike", async () => {
    for (const deadline of [NOW + 3600, NOW - 10]) {
      const relay = createTestRelay();
      const jobId = fundedJob(relay, V2, deadline);
      const res = await release(appFor(relay, HUB_TOKEN), jobId, { authorization: `Bearer ${HUB_TOKEN}` });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
      expect(releases(relay)).toBe(1);
    }
  });

  test("a relay with no hub token refuses a v2 release 503", async () => {
    const relay = createTestRelay();
    const jobId = fundedJob(relay, V2, NOW + 3600);
    const res = await release(appFor(relay), jobId);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "release_not_configured" });
    expect(releases(relay)).toBe(0);
  });

  test("a v1 job is unchanged: its release needs no token", async () => {
    const relay = createTestRelay();
    const jobId = fundedJob(relay, WHITECHAIN_ESCROW, NOW - 10);
    const res = await release(appFor(relay, HUB_TOKEN), jobId);
    expect(res.status).toBe(200);
    expect(releases(relay)).toBe(1);
  });
});
