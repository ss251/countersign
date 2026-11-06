import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { offerHash } from "../src/deps.ts";
import { makeOffer, publish, startHub, type TestHub } from "./support.ts";

describe("POST /offers refuses a bond without a review window", () => {
  let hub: TestHub;

  beforeEach(() => {
    hub = startHub();
  });

  afterEach(() => {
    hub.close();
  });

  test("a signed offer with a bond and no window is 400 and is not stored", async () => {
    const refused = makeOffer({ bond: "1" });
    const rejected = await publish(hub, refused);
    expect(rejected.status).toBe(400);
    expect(hub.store.listOffers()).toHaveLength(0);

    const listed = (await fetch(`${hub.url}/offers`).then((response) => response.json())) as { offers: unknown[] };
    expect(listed.offers).toHaveLength(0);

    const accepted = makeOffer({ bond: "1", reviewWindow: 60 });
    const response = await publish(hub, accepted);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ offerHash: offerHash(accepted) });
    expect(hub.store.listOffers()).toHaveLength(1);
  });
});
