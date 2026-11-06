/**
 * The relay's arbiter calls get their own budget. A buyer cannot fill the shared ceiling to stop
 * the hub's v2 release, and failDelivery is charged to the hub's ceiling too. The chain is
 * simulated; nothing here reaches a network.
 */

import { describe, expect, test } from "bun:test";
import { getAddress, type Address, type Hex } from "viem";
import { SpendCeiling } from "../src/ceiling.ts";
import type { SpendCeilingConfig } from "../src/ceiling.ts";
import { loadRelayConfig } from "../src/config.ts";
import { failDeliveryJob, releaseJob } from "../src/escrow-ops.ts";
import type { EscrowContext } from "../src/escrow-ops.ts";
import { Relayer } from "../src/relayer.ts";
import { createRelayApp } from "../src/server.ts";
import { WHITECHAIN_ESCROW } from "../src/whitechain-config.ts";
import { createTestRelay, fakeHash, NOW } from "./support.ts";

const V2 = getAddress("0x7777777777777777777777777777777777777777");
const HUB_TOKEN = "a-hub-token-long-enough";
const SIG: Hex = `0x${"34".repeat(65)}`;
const SLIP: Hex = `0x${"51".repeat(32)}`;
const HOUR_MS = 3_600_000;
const CAP_WEI = 10n ** 18n;
const OTHER_PAYER = "0x1111111111111111111111111111111111111111";

const BASE_ENV = {
  WC_RELAYER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  RELAY_DB: ":memory:",
};

type TestRelay = ReturnType<typeof createTestRelay>;

function budgets(
  shared: Partial<SpendCeilingConfig> = {},
  hub: Partial<SpendCeilingConfig> = {},
) {
  return {
    shared: new SpendCeiling({
      windowMs: HOUR_MS,
      capWei: CAP_WEI,
      maxTx: 200,
      maxTxPerPayer: 30,
      ...shared,
    }),
    hub: new SpendCeiling({
      windowMs: HOUR_MS,
      capWei: CAP_WEI,
      maxTx: 200,
      maxTxPerPayer: 200,
      ...hub,
    }),
  };
}

function setup(
  options: {
    v2?: boolean;
    shared?: Partial<SpendCeilingConfig>;
    hub?: Partial<SpendCeilingConfig>;
  } = {},
) {
  const relay = createTestRelay();
  if (options.v2) {
    relay.policy.allowedEscrows.push(V2);
    relay.policy.escrowV2 = V2;
  }
  const ceilings = budgets(options.shared, options.hub);
  const relayer = new Relayer(
    relay.chain,
    relay.chain.writer,
    relay.relayerAccount,
    relay.policy,
    ceilings.shared,
    (spend) => relay.ledger.recordSpend(spend),
    ceilings.hub,
  );
  const ctx: EscrowContext = {
    chainClient: relay.chain,
    reader: relay.chain,
    relayer,
    ledger: relay.ledger,
    now: () => NOW,
  };
  const app = createRelayApp({
    reader: relay.chain,
    relayer,
    ledger: relay.ledger,
    now: () => NOW,
    config: { hubToken: HUB_TOKEN },
  });
  return { relay, ceilings, relayer, ctx, app };
}

let salt = 0;

function fundedJob(
  relay: TestRelay,
  options: { escrow?: Address; buyer?: Address; reviewWindow?: number } = {},
) {
  salt += 1;
  const jobId = `0x${salt.toString(16).padStart(64, "0")}` as Hex;
  const escrow = options.escrow ?? V2;
  const buyer = options.buyer ?? relay.buyer.address;
  relay.ledger.recordJob({
    jobId,
    offerHash: fakeHash(),
    buyer,
    payee: relay.merchant.address,
    amount: 1_500_000n,
    deadline: NOW + 3600,
    fundTx: fakeHash(),
    fundBlock: 1n,
    status: "funded",
    createdAt: NOW * 1000,
    escrow,
    bond: "0",
    ...(escrow === V2 ? { reviewWindow: options.reviewWindow ?? 0 } : {}),
  });
  relay.chain.jobs.set(jobId.toLowerCase(), 1);
  return { jobId, buyer };
}

function release(app: ReturnType<typeof createRelayApp>, jobId: Hex) {
  return app.request("/escrow/release", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${HUB_TOKEN}`,
    },
    body: JSON.stringify({ jobId, slipHash: SLIP, sellerSig: SIG }),
  });
}

describe("the hub's own budget", () => {
  test("a buyer at its per-payer quota cannot block the hub's v2 release", async () => {
    const { relay, ceilings, app } = setup({ v2: true });
    const { jobId, buyer } = fundedJob(relay);
    const at = Date.now();
    ceilings.shared.seed(
      Array.from({ length: 30 }, () => ({ payer: buyer, costWei: 1n, at })),
    );
    expect(ceilings.shared.reserve({ payer: buyer, worstCaseWei: 1n })).toEqual({
      ok: false,
      reason: "ceiling_payer",
    });

    const res = await release(app, jobId);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "released" });
    expect(relay.chain.writes.at(-1)!.functionName).toBe("release");
    expect(relay.chain.writes.at(-1)!.address).toBe(V2);
    expect(ceilings.shared.snapshot().txCount).toBe(30);
    expect(ceilings.hub.snapshot().txCount).toBe(1);
  });

  test("a full shared hour's transaction cap cannot block the hub's v2 release", async () => {
    const { relay, ceilings, app } = setup({ v2: true, shared: { maxTx: 2 } });
    const { jobId } = fundedJob(relay);
    const at = Date.now();
    ceilings.shared.seed([
      { payer: OTHER_PAYER, costWei: 1n, at },
      { payer: "0x2222222222222222222222222222222222222222", costWei: 1n, at },
    ]);
    expect(ceilings.shared.reserve({ payer: relay.buyer.address, worstCaseWei: 1n })).toEqual({
      ok: false,
      reason: "ceiling_tx",
    });

    const res = await release(app, jobId);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "released" });
    expect(relay.chain.writes.at(-1)!.functionName).toBe("release");
    expect(ceilings.shared.snapshot().txCount).toBe(2);
    expect(ceilings.hub.snapshot().txCount).toBe(1);
  });

  test("a full shared hour's WBT cap cannot block the hub's v2 release", async () => {
    const { relay, ceilings, app } = setup({ v2: true, shared: { capWei: 1000n } });
    const { jobId } = fundedJob(relay);
    ceilings.shared.seed([{ payer: OTHER_PAYER, costWei: 1000n, at: Date.now() }]);
    expect(ceilings.shared.reserve({ payer: relay.buyer.address, worstCaseWei: 1n })).toEqual({
      ok: false,
      reason: "ceiling_wei",
    });

    const res = await release(app, jobId);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "released" });
    expect(relay.chain.writes.at(-1)!.functionName).toBe("release");
    expect(ceilings.shared.snapshot().usedWei).toBe(1000n);
    expect(ceilings.hub.snapshot().txCount).toBe(1);
  });

  test("RELAY_HUB_MAX_TX_PER_HOUR bounds the hub: a second release is ceiling_tx", async () => {
    const config = loadRelayConfig({ ...BASE_ENV, RELAY_HUB_MAX_TX_PER_HOUR: "1" });
    const { relay, ceilings, app } = setup({ v2: true, hub: config.hubCeiling });
    const first = fundedJob(relay);
    expect((await release(app, first.jobId)).status).toBe(200);

    const second = fundedJob(relay);
    const writes = relay.chain.writes.length;
    const res = await release(app, second.jobId);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, reason: "ceiling_tx" });
    expect(relay.chain.writes).toHaveLength(writes);
    expect(relay.ledger.getJob(second.jobId)!.status).toBe("funded");
    expect(ceilings.hub.snapshot().txCount).toBe(1);
  });

  test("failDelivery is reserved on the hub ceiling", async () => {
    const { relay, ceilings, app } = setup({ v2: true, shared: { capWei: 0n } });
    const { jobId } = fundedJob(relay);

    const res = await app.request("/escrow/fail", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${HUB_TOKEN}`,
      },
      body: JSON.stringify({ jobId }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "failed" });
    expect(relay.chain.writes.at(-1)!.functionName).toBe("failDelivery");
    expect(relay.chain.writes.at(-1)!.address).toBe(V2);
    expect(ceilings.shared.snapshot().txCount).toBe(0);
    expect(ceilings.hub.snapshot().txCount).toBe(1);
  });

  test("a v1 release is still reserved on the shared ceiling, charged to the buyer", async () => {
    const { relay, ceilings, app } = setup({ shared: { maxTxPerPayer: 1 } });
    const { jobId, buyer } = fundedJob(relay, { escrow: WHITECHAIN_ESCROW });

    const res = await release(app, jobId);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "released" });
    expect(relay.chain.writes.at(-1)!.functionName).toBe("release");
    expect(relay.chain.writes.at(-1)!.address).toBe(WHITECHAIN_ESCROW);
    expect(ceilings.shared.snapshot().txCount).toBe(1);
    expect(ceilings.hub.snapshot().txCount).toBe(0);
    expect(ceilings.shared.reserve({ payer: buyer, worstCaseWei: 1n })).toEqual({
      ok: false,
      reason: "ceiling_payer",
    });
    expect(ceilings.shared.reserve({ payer: OTHER_PAYER, worstCaseWei: 1n }).ok).toBe(true);
  });

  test("a direct failDelivery call takes the hub ceiling", async () => {
    const { relay, ceilings, ctx } = setup({ v2: true });
    const { jobId } = fundedJob(relay);

    const result = await failDeliveryJob({ jobId }, ctx);

    expect(result).toMatchObject({ ok: true, status: "failed" });
    expect(ceilings.shared.snapshot().txCount).toBe(0);
    expect(ceilings.hub.snapshot().txCount).toBe(1);
  });
});

describe("status and config", () => {
  test("/status shows hubCeiling beside ceiling, and null when the relayer has none", async () => {
    const { app } = setup();
    const body = (await (await app.request("/status")).json()) as {
      ceiling: { maxTx: number; capWei: string };
      hubCeiling: { maxTx: number; capWei: string; txCount: number } | null;
    };
    expect(body.ceiling.maxTx).toBe(200);
    expect(body.hubCeiling).not.toBeNull();
    expect(body.hubCeiling!.maxTx).toBe(200);
    expect(body.hubCeiling!.capWei).toBe(CAP_WEI.toString());
    expect(body.hubCeiling!.txCount).toBe(0);

    const bare = createTestRelay();
    const bareApp = createRelayApp({
      reader: bare.chain,
      relayer: bare.relayer,
      ledger: bare.ledger,
      now: () => NOW,
      config: {},
    });
    const bareBody = (await (await bareApp.request("/status")).json()) as {
      hubCeiling: unknown;
    };
    expect(bareBody.hubCeiling).toBeNull();
  });

  test("the hub ceiling defaults: the shared cap, 200 transactions, and no separate payer cap", () => {
    const config = loadRelayConfig(BASE_ENV);
    expect(config.hubCeiling).toEqual({
      windowMs: HOUR_MS,
      capWei: 50_000_000_000_000_000n,
      maxTx: 200,
      maxTxPerPayer: 200,
    });
    expect(config.hubCeiling.capWei).toBe(config.ceiling.capWei);
  });

  test("RELAY_HUB_CAP_WEI_PER_HOUR and RELAY_HUB_MAX_TX_PER_HOUR parse", () => {
    const config = loadRelayConfig({
      ...BASE_ENV,
      RELAY_HUB_CAP_WEI_PER_HOUR: "123",
      RELAY_HUB_MAX_TX_PER_HOUR: "7",
    });
    expect(config.hubCeiling.capWei).toBe(123n);
    expect(config.hubCeiling.maxTx).toBe(7);
    expect(config.hubCeiling.maxTxPerPayer).toBe(7);
  });

  test("the hub cap follows the shared cap when only RELAY_CAP_WEI_PER_HOUR is set", () => {
    const config = loadRelayConfig({ ...BASE_ENV, RELAY_CAP_WEI_PER_HOUR: "999" });
    expect(config.hubCeiling.capWei).toBe(999n);
  });
});
