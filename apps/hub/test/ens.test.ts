import { afterEach, describe, expect, test } from "bun:test";
import type { Address } from "viem";
import type { EnsResolve, ErrorBody } from "../src/deps.ts";
import type { SellersResponse } from "../src/frontdoor.ts";
import { call, makeOffer, other, publish, sellerAddress, startHub, type TestHub } from "./support.ts";
import { offerHash } from "../src/deps.ts";

const OTHER = other.address;
let hub: TestHub | undefined;

afterEach(() => {
  hub?.close();
  hub = undefined;
});

/** A Sepolia stand-in: names map to addresses, and `down` makes every lookup fail. */
function registry(names: Record<string, Address>, state = { down: false }): EnsResolve {
  return async (name) => {
    if (state.down) throw new Error("rpc down");
    return names[name] ?? null;
  };
}

async function refusal(response: Response): Promise<{ status: number; body: ErrorBody }> {
  return { status: response.status, body: (await response.json()) as ErrorBody };
}

describe("POST /offers with an ENS seller name", () => {
  test("lists an offer whose name resolves to its seller", async () => {
    hub = startHub({ ens: registry({ "alice.eth": sellerAddress() }) });
    const response = await publish(hub, makeOffer({ ens: "alice.eth" }));
    expect(response.status).toBe(201);
  });

  test("refuses a name that resolves to someone else", async () => {
    hub = startHub({ ens: registry({ "alice.eth": OTHER }) });
    const { status, body } = await refusal(await publish(hub, makeOffer({ ens: "alice.eth" })));
    expect(status).toBe(422);
    expect(body.code).toBe("ens-mismatch");
    expect(body.message.startsWith("Refused.")).toBe(true);
    expect(hub.store.listOffers()).toHaveLength(0);
  });

  test("refuses an EVM payee that is not the name's address", async () => {
    hub = startHub({ ens: registry({ "alice.eth": sellerAddress() }) });
    const { status, body } = await refusal(await publish(hub, makeOffer({ ens: "alice.eth", payTo: { escrow: OTHER } })));
    expect(status).toBe(422);
    expect(body.code).toBe("ens-mismatch");
  });

  test("refuses a name that does not resolve", async () => {
    hub = startHub({ ens: registry({}) });
    const { status, body } = await refusal(await publish(hub, makeOffer({ ens: "nobody.eth" })));
    expect(status).toBe(422);
    expect(body.code).toBe("ens-unresolved");
  });

  test("fails closed when the lookup fails or the hub has no resolver", async () => {
    hub = startHub({ ens: registry({ "alice.eth": sellerAddress() }, { down: true }) });
    expect((await refusal(await publish(hub, makeOffer({ ens: "alice.eth" })))).body.code).toBe("ens-unavailable");
    hub.close();

    hub = startHub();
    const { status, body } = await refusal(await publish(hub, makeOffer({ ens: "alice.eth" })));
    expect(status).toBe(503);
    expect(body.code).toBe("ens-unavailable");
    expect((await publish(hub, makeOffer())).status).toBe(201);
  });

  test("refuses a name that is not in normal form", async () => {
    hub = startHub({ ens: registry({ "Alice.eth": sellerAddress() }) });
    expect((await refusal(await publish(hub, makeOffer({ ens: "Alice.eth" })))).body.code).toBe("bad-offer");
  });
});

describe("GET /sellers names a seller only while the lock holds", () => {
  test("shows the name, then drops it once the name points elsewhere", async () => {
    const names: Record<string, Address> = { "alice.eth": sellerAddress() };
    hub = startHub({ ens: registry(names) });
    expect((await publish(hub, makeOffer({ ens: "alice.eth" }))).status).toBe(201);

    const named = (await (await fetch(`${hub.url}/sellers`)).json()) as SellersResponse;
    expect(named.sellers[0]?.name).toBe("alice.eth");

    names["alice.eth"] = OTHER;
    const moved = (await (await fetch(`${hub.url}/sellers`)).json()) as SellersResponse;
    expect(moved.sellers[0]?.name).toBeNull();
  });
});

describe("POST /offers/:hash/call checks the name again", () => {
  test("refuses a named offer, before any payment terms, once its name points elsewhere", async () => {
    const names: Record<string, Address> = { "alice.eth": sellerAddress() };
    const state = { down: false };
    hub = startHub({ ens: registry(names, state) });
    const offer = makeOffer({ ens: "alice.eth" });
    expect((await publish(hub, offer)).status).toBe(201);
    const hash = offerHash(offer);

    // While the name holds, the call goes on to the usual checks (here: no runner, so offline).
    const holding = await refusal(await call(hub, hash, {}));
    expect(holding.body.code).not.toMatch(/^ens-/);

    names["alice.eth"] = OTHER;
    const moved = await refusal(await call(hub, hash, {}));
    expect(moved.status).toBe(409);
    expect(moved.body.code).toBe("ens-mismatch");
    expect(moved.body.message).toContain("Nothing was charged.");

    names["alice.eth"] = sellerAddress();
    state.down = true;
    const down = await refusal(await call(hub, hash, {}));
    expect(down.status).toBe(503);
    expect(down.body.code).toBe("ens-unavailable");
  });
});
