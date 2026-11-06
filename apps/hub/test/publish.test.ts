import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { offerHash, type ErrorBody } from "../src/deps.ts";
import { makeOffer, other, publish, startHub, type TestHub } from "./support.ts";

describe("POST /offers", () => {
  let hub: TestHub;

  beforeEach(() => {
    hub = startHub();
  });

  afterEach(() => {
    hub.close();
  });

  test("stores a valid offer once, then answers 200 for the same hash", async () => {
    const offer = makeOffer();
    const first = await publish(hub, offer);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ offerHash: offerHash(offer) });

    const again = await publish(hub, offer);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ offerHash: offerHash(offer) });

    const listed = await fetch(`${hub.url}/offers`);
    const body = (await listed.json()) as { offers: Array<{ offerHash: string; status: string }> };
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0]?.offerHash).toBe(offerHash(offer));
    expect(body.offers[0]?.status).toBe("listed");
  });

  test("refuses a signature from another key", async () => {
    const response = await publish(hub, makeOffer(), other);
    expect(response.status).toBe(401);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("bad-signature");
    expect(body.message.startsWith("Refused.")).toBe(true);
  });

  test("refuses a structurally malformed offer", async () => {
    const response = await publish(hub, makeOffer({ price: "0" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("bad-offer");
  });

  test("refuses an offer whose schema does not compile", async () => {
    const response = await publish(hub, makeOffer({ input: { type: "nonsense" } }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("bad-offer");
  });
});
