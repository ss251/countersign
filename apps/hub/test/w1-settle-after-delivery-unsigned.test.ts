import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { keccak256, toBytes, type Hex } from "viem";
import type { JobOrder, PaymentPayload, PaymentRequirements } from "../src/deps.ts";
import { call, makeOffer, NONCE, NOW, paymentFor, publishOk, requirementsFor, seller, startHub, wsUrl, type TestHub } from "./support.ts";
import { FakeRail } from "./fake-rail.ts";
import { startRunner, type JobAnswer } from "./runner-client.ts";

// cs-w1 (B31, PR #321 hd-30 86a25f5): on a rail that settles after delivery, only `payload.transaction` is signed
// by the buyer. `payload.authorization.nonce` and `payload.terms.deadline` are plain JSON anyone can add, so they
// must not pick the job id (the claim that stops a second dispatch) or the deadline (which sets the dispatch
// timeout and, through dispatchFault, who a timeout is blamed on). Both run before anything is charged.

/** The same rail cs-hd's suite uses: it settles after delivery, and every payment is one signed transfer. */
class DeferredRail extends FakeRail {
  readonly settlesAfterDelivery = true;
  dispatches = 0;

  constructor() {
    super("hedera", "hedera:testnet");
  }

  pending(_payment: PaymentPayload): { transaction: string; validUntil: number } | null {
    return { transaction: this.settleTx, validUntil: NOW + 600 };
  }
}

const OFFER = makeOffer({ rails: ["hedera"] });
const OTHER_NONCE = `0x${"22".repeat(32)}` as Hex;

describe("W1 B31: unsigned payload fields on a rail that settles after delivery", () => {
  let hub: TestHub;
  let rail: DeferredRail;
  let closes: Array<() => void>;

  beforeEach(() => {
    rail = new DeferredRail();
    hub = startHub({ rails: [rail] });
    closes = [];
  });

  afterEach(() => {
    for (const close of closes) close();
    hub.close();
  });

  async function connect(hash: Hex): Promise<void> {
    const respond = async (_order: JobOrder): Promise<JobAnswer> => {
      rail.dispatches += 1;
      return { output: { q: "hello" } };
    };
    const runner = startRunner({ url: wsUrl(hub), account: seller, offers: [hash], now: () => NOW, respond });
    await runner.ready;
    closes.push(() => runner.close());
  }

  async function entryOf(hash: Hex): Promise<PaymentRequirements> {
    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    return entry;
  }

  test("one signed transfer dispatches the seller once, whatever authorization.nonce the payload carries", async () => {
    const hash = await publishOk(hub, OFFER);
    await connect(hash);
    const entry = await entryOf(hash);

    const first = await call(hub, hash, { q: "hello" }, paymentFor(entry, NONCE));
    expect(first.status).toBe(200);

    // The same signed transfer (pending() names the same transaction), with a different unsigned nonce.
    const second = await call(hub, hash, { q: "hello" }, paymentFor(entry, OTHER_NONCE));
    expect(second.status).toBe(409);
    expect(rail.dispatches).toBe(1);
  });

  test("the job deadline is the offer's, never an unsigned terms.deadline", async () => {
    const hash = await publishOk(hub, OFFER);
    await connect(hash);
    const entry = await entryOf(hash);

    // now + 1 passes the window check (validUntil = now + 600) and leaves the seller no time at all.
    await call(hub, hash, { q: "hello" }, paymentFor(entry, NONCE, NOW + 1));

    const job = hub.store.getJob(NONCE) ?? hub.store.getJob(keccak256(toBytes(rail.settleTx)));
    expect(job).toBeDefined();
    expect(job?.deadline).toBe(NOW + OFFER.deadline);
  });
});
