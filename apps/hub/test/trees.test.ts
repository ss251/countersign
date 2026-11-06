import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import type { CallResult, ErrorBody, JobOrder } from "../src/deps.ts";
import {
  call,
  makeOffer,
  NOW,
  paymentFor,
  publishOk,
  requirementsFor,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";
import { startRunner, type RunnerHandle } from "./runner-client.ts";

const UNKNOWN = `0x${"ab".repeat(32)}` as Hex;
const CHILD_NONCE = `0x${"22".repeat(32)}` as Hex;

describe("receipt trees", () => {
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

  test("an unknown root is a 404", async () => {
    const response = await fetch(`${hub.url}/trees/${UNKNOWN}`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("unknown-root");
    expect(body.message).toBe("Refused. That slip is not known.");
  });

  test("a served call that buys another offer records that slip as its child", async () => {
    const parentHash = await publishOk(hub, makeOffer({ title: "Parent work" }));
    const childHash = await publishOk(hub, makeOffer({ title: "Child work" }));
    runners.push(await connect(hub, childHash));

    const childEntry = (await requirementsFor(hub, childHash)).accepts[0];
    if (!childEntry) throw new Error("missing child accepts entry");

    let childSlip: Hex | undefined;
    runners.push(
      await connect(hub, parentHash, async (order) => {
        const paid = await call(hub, childHash, { q: "nested" }, paymentFor(childEntry, CHILD_NONCE), [order.jobId]);
        expect(paid.status).toBe(200);
        const result = (await paid.json()) as CallResult;
        childSlip = result.slip.hash;
        return { output: { q: "hello" } };
      }),
    );

    const parentEntry = (await requirementsFor(hub, parentHash)).accepts[0];
    if (!parentEntry) throw new Error("missing parent accepts entry");
    const response = await call(hub, parentHash, { q: "hello" }, paymentFor(parentEntry));
    expect(response.status).toBe(200);

    const result = (await response.json()) as CallResult;
    if (childSlip === undefined) throw new Error("missing child slip");
    expect(result.slip.body.children).toEqual([childSlip]);

    const treeResponse = await fetch(`${hub.url}/trees/${result.slip.hash}`);
    expect(treeResponse.status).toBe(200);
    const tree = (await treeResponse.json()) as {
      root: string;
      nodes: Record<string, { title: string; seller: string; slip: CallResult["slip"] }>;
    };
    expect(tree.root).toBe(result.slip.hash);
    expect(Object.keys(tree.nodes)).toEqual([result.slip.hash, childSlip]);
    const parent = tree.nodes[result.slip.hash];
    const child = tree.nodes[childSlip];
    if (!parent || !child) throw new Error("missing tree node");
    expect(parent.title).toBe("Parent work");
    expect(parent.seller.toLowerCase()).toBe(seller.address.toLowerCase());
    expect(parent.slip.body.children).toEqual([childSlip]);
    expect(child.title).toBe("Child work");
    expect(child.slip.body.children).toEqual([]);
  });
});

async function connect(
  hub: TestHub,
  hash: Hex,
  respond: (order: JobOrder) => Promise<{ output: unknown } | { fail: string }> = async () => ({
    output: { q: "hello" },
  }),
): Promise<RunnerHandle> {
  const runner = startRunner({
    url: wsUrl(hub),
    account: seller,
    offers: [hash],
    now: () => NOW,
    respond,
  });
  await runner.ready;
  return runner;
}
