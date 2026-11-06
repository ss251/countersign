/**
 * Two `exact` rails share scheme and network on Arc. The signing-domain name in `extra`
 * is what keeps them apart: each payment must reach the rail it names.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import type { CallResult, Offer, PaymentRequired, PaymentRequirements, RailId } from "../src/deps.ts";
import {
  call,
  makeOffer,
  paymentFor,
  publishOk,
  requirementsFor,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";
import { ASSET, FakeRail } from "./fake-rail.ts";
import { startRunner, type RunnerHandle } from "./runner-client.ts";

class ExactRail extends FakeRail {
  readonly signingName: string;

  constructor(id: RailId, signingName: string) {
    super(id);
    this.signingName = signingName;
    this.declaration.scheme = "exact";
  }

  override challenge(offer: Offer): PaymentRequirements {
    this.challengeCalls += 1;
    return {
      scheme: "exact",
      network: this.declaration.network,
      amount: offer.price,
      asset: ASSET,
      payTo: offer.seller,
      maxTimeoutSeconds: offer.deadline,
      extra: { name: this.signingName, version: "1" },
    };
  }
}

describe("eip3009 and gateway option matching", () => {
  let hub: TestHub;
  let runners: RunnerHandle[];

  beforeEach(() => {
    hub = startHub();
    runners = [];
  });

  afterEach(() => {
    for (const runner of runners) runner.close();
    hub.close();
  });

  test("each exact payment reaches its own rail", async () => {
    const gateway = new ExactRail("gateway", "GatewayWalletBatched");
    const direct = new ExactRail("eip3009", "USDC");
    hub.close();
    hub = startHub({ rails: [gateway, direct] });

    const hash = await publishOk(hub, makeOffer({ rails: ["gateway", "eip3009"] }));
    const runner = startRunner({
      url: wsUrl(hub),
      account: seller,
      offers: [hash],
      now: () => hub.deps.now(),
      respond: async () => ({ output: { q: "hello" } }),
    });
    runners.push(runner);
    await runner.ready;

    const accepts = (await requirementsFor(hub, hash)).accepts;
    expect(accepts.map((entry) => entry.extra?.name)).toEqual(["GatewayWalletBatched", "USDC"]);

    const gatewayEntry = accepts[0];
    const directEntry = accepts[1];
    if (!gatewayEntry || !directEntry) throw new Error("missing accepts entry");

    const first = await call(
      hub,
      hash,
      { q: "hello" },
      paymentFor(gatewayEntry, `0x${"21".repeat(32)}` as Hex),
    );
    expect(first.status).toBe(200);
    expect(((await first.json()) as CallResult).slip.body.rail).toBe("gateway");
    expect(gateway.verifyCalls).toHaveLength(1);
    expect(gateway.settleCalls).toHaveLength(1);
    expect(direct.verifyCalls).toHaveLength(0);
    expect(direct.settleCalls).toHaveLength(0);

    const second = await call(
      hub,
      hash,
      { q: "hello" },
      paymentFor(directEntry, `0x${"22".repeat(32)}` as Hex),
    );
    expect(second.status).toBe(200);
    expect(((await second.json()) as CallResult).slip.body.rail).toBe("eip3009");
    expect(gateway.verifyCalls).toHaveLength(1);
    expect(gateway.settleCalls).toHaveLength(1);
    expect(direct.verifyCalls).toHaveLength(1);
    expect(direct.settleCalls).toHaveLength(1);
  });

  test("a different extra.name matches no option", async () => {
    const gateway = new ExactRail("gateway", "GatewayWalletBatched");
    const direct = new ExactRail("eip3009", "USDC");
    hub.close();
    hub = startHub({ rails: [gateway, direct] });

    const hash = await publishOk(hub, makeOffer({ rails: ["gateway", "eip3009"] }));
    const runner = startRunner({
      url: wsUrl(hub),
      account: seller,
      offers: [hash],
      now: () => hub.deps.now(),
      respond: async () => ({ output: { q: "hello" } }),
    });
    runners.push(runner);
    await runner.ready;

    const entry = (await requirementsFor(hub, hash)).accepts[1];
    if (!entry) throw new Error("missing accepts entry");

    const response = await call(
      hub,
      hash,
      { q: "hello" },
      paymentFor(
        { ...entry, extra: { ...entry.extra, name: "SomethingElse" } },
        `0x${"23".repeat(32)}` as Hex,
      ),
    );
    expect(response.status).toBe(402);
    expect(((await response.json()) as PaymentRequired).error).toBe(
      "Refused. This offer does not take that rail.",
    );
    expect(gateway.verifyCalls).toHaveLength(0);
    expect(direct.verifyCalls).toHaveLength(0);
  });
});
