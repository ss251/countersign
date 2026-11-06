/**
 * 1b · Runner restart. A seller's runner stops and starts again with the same state. Its offer
 * must come back under the same hash and be online, or every buyer is told the seller is
 * offline. No money moves.
 */

import { join } from "node:path";
import { startHub, startSkillSeller, USE_ARC } from "../lib/actors.ts";
import { equal, sameHex, type Flow } from "../lib/flow.ts";
import { sleep } from "../lib/http.ts";
import { PRICE } from "./arc-spine.flow.ts";

export const runnerRestart: Flow = {
  name: "runner-restart",
  title: "A restarted runner keeps its offer online",
  owner: "orch-cs",
  network: "none",
  async run(ctx) {
    const state = join(ctx.dir, "runner-state");
    const hub = await ctx.step("hub up", () => startHub(ctx, { arc: true }));
    const first = await ctx.step("runner serves use-arc", () =>
      startSkillSeller(ctx, hub, { item: USE_ARC, price: PRICE, deadline: 120, rails: ["escrow"], key: "E2E_SELLER_KEY", label: "runner-1", state }),
    );

    await ctx.step("runner stops, offer goes offline", async () => {
      await first.proc.stop();
      for (let i = 0; i < 20; i++) {
        const res = await ctx.http("listing after stop", `${hub.url}/offers/${first.offerHash}`);
        if ((res.json as { online?: boolean }).online === false) return;
        await sleep(500);
      }
      equal(true, false, "the hub still lists the stopped runner's offer as online");
    });

    // Past the second the first runner stamped, so a fresh offer would hash differently.
    await sleep(1500);

    await ctx.step("runner restarts: same offer, back online", async () => {
      const second = await startSkillSeller(ctx, hub, {
        item: USE_ARC,
        price: PRICE,
        deadline: 120,
        rails: ["escrow"],
        key: "E2E_SELLER_KEY",
        label: "runner-2",
        state,
      });
      sameHex(second.offerHash, first.offerHash, "the restarted runner republishes the same offer hash");
    });
  },
};
