import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { makeOffer, publishOk, startHub, type TestHub } from "./support.ts";

interface ListingBody {
  offer: { rails: string[] };
  liveRails: string[];
}

describe("live rails", () => {
  let hub: TestHub;

  beforeEach(() => {
    hub = startHub();
  });

  afterEach(() => {
    hub.close();
  });

  test("an offer's liveRails are only the rails this hub runs", async () => {
    const hubRail = hub.rail.declaration.id;
    const offer = makeOffer({ rails: [hubRail, "hedera"] });
    const hash = await publishOk(hub, offer);

    const listed = (await fetch(`${hub.url}/offers`).then((r) => r.json())) as {
      offers: Array<ListingBody & { offerHash: Hex }>;
    };
    const entry = listed.offers.find((item) => item.offerHash === hash);
    expect(entry).toBeDefined();
    expect(entry?.liveRails).toEqual([hubRail]);
    expect(entry?.offer.rails).toEqual([hubRail, "hedera"]);

    const shown = (await fetch(`${hub.url}/offers/${hash}`).then((r) => r.json())) as ListingBody;
    expect(shown.liveRails).toEqual([hubRail]);
    expect(shown.offer.rails).toEqual([hubRail, "hedera"]);
  });

  test("an offer whose rails the hub all runs lists them all as live", async () => {
    const hubRail = hub.rail.declaration.id;
    const offer = makeOffer({ rails: [hubRail] });
    const hash = await publishOk(hub, offer);

    const shown = (await fetch(`${hub.url}/offers/${hash}`).then((r) => r.json())) as ListingBody;
    expect(shown.liveRails).toEqual(shown.offer.rails);
    expect(shown.liveRails).toEqual([hubRail]);
  });
});
