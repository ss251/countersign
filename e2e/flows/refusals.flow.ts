/**
 * 11 · Refusals before money moves. The hub's input gate, every envelope limit and an offline
 * seller each stop a call before the buyer signs anything. The flow spends nothing: a refusal
 * that let a signature through would show up as a `signed` entry in the buyer's journal.
 */

import { join } from "node:path";
import { offerHash, publishMessage, type Offer } from "@countersign/core";
import { buyerCli, readJournal, startHub, startSkillSeller, USE_ARC, type HubHandle, type SellerHandle } from "../lib/actors.ts";
import { check, equal, type Flow, type FlowCtx } from "../lib/flow.ts";
import { sleep } from "../lib/http.ts";
import { PRICE } from "./arc-spine.flow.ts";

const BAD_INPUT = "Refused. The input does not match the offer's schema.";

/** Set an envelope in a fresh state, try to buy, expect a refusal with this message and reason. */
async function refusedBy(
  ctx: FlowCtx,
  hub: HubHandle,
  seller: SellerHandle,
  label: string,
  envelope: string[],
  message: string,
  reason: string,
  buyArgs: string[] = [],
): Promise<void> {
  const state = join(ctx.dir, `buyer-state-${label}`);
  const set = await buyerCli(ctx, `${label}-envelope`, hub.url, state, "CS_BUYER_KEY", ["envelope", "set", ...envelope]);
  equal(set.code, 0, "envelope set exit code");
  const r = await buyerCli(ctx, `${label}-buy`, hub.url, state, "CS_BUYER_KEY", ["buy", seller.offerHash, "--input", "{}", ...buyArgs]);
  equal(r.code, 1, "buy exit code");
  equal(r.stderr.trim().split("\n").at(-1), message, "refusal");
  const journal = readJournal(state);
  equal(journal.at(-1)?.kind, "refused", "last journal entry");
  equal(journal.at(-1)?.reason, reason, "refusal reason in the journal");
  check(!journal.some((e) => e.kind === "signed"), "the buyer signed nothing");
}

export const refusals: Flow = {
  name: "refusals",
  title: "Refusals before money moves",
  owner: "orch-cs",
  network: "none",
  async run(ctx) {
    const hub = await ctx.step("hub up", () => startHub(ctx, { arc: true }));
    const seller = await ctx.step("seller publishes use-arc", () =>
      startSkillSeller(ctx, hub, { item: USE_ARC, price: PRICE, deadline: 120, rails: ["escrow"], key: "E2E_SELLER_KEY" }),
    );
    const allow = ["--allow", seller.seller.toLowerCase()];

    await ctx.step("the hub's input gate refuses a bad input", async () => {
      const res = await ctx.http("bad input", `${hub.url}/offers/${seller.offerHash}/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { section: 7 } }),
      });
      equal(res.status, 422, "bad input status");
      const body = res.json as { code?: string; message?: string };
      equal(body.code, "bad-input", "bad input code");
      equal(body.message, BAD_INPUT, "bad input message");
    });

    await ctx.step("an input the slip cannot hash is refused before any 402", async () => {
      // The seller publishes an offer whose schema takes a number. Nobody serves it, so a call
      // that passed every gate would stop at "seller offline"; one that cannot be hashed stops first.
      const account = ctx.env.secrets.account("E2E_SELLER_KEY");
      const offer: Offer = {
        v: 1,
        seller: account.address,
        title: `e2e numeric input ${ctx.env.runId}`,
        summary: "An offer whose input is a number, published only to test the hub's gates.",
        adapter: "skill",
        input: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false },
        output: { type: "object" },
        price: PRICE.toString(),
        deadline: 120,
        bond: "0",
        rails: ["escrow"],
        issuedAt: Math.floor(Date.now() / 1000),
      };
      const hash = offerHash(offer);
      const sig = await account.signMessage({ message: publishMessage(hash) });
      const pub = await ctx.http("publish numeric offer", `${hub.url}/offers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offer, sig }),
      });
      check(pub.status === 200 || pub.status === 201, `publish status ${pub.status}`);
      const call = (n: number) =>
        ctx.http(`call with n=${n}`, `${hub.url}/offers/${hash}/call`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: { n } }),
        });
      const fractional = await call(0.5);
      equal(fractional.status, 422, "fractional input status");
      const body = fractional.json as { code?: string; message?: string };
      equal(body.code, "bad-input", "fractional input code");
      equal(body.message, "Refused. The input holds a value the slip cannot hash, such as a fractional number. Nothing was charged.", "fractional input message");
      check(!fractional.headers.has("payment-required"), "no payment terms were issued");
      const whole = await call(2);
      equal(whole.status, 503, "a whole number passes the gate and stops at the offline seller");
    });

    await ctx.step("the buyer refuses a bad input before signing", async () => {
      const state = join(ctx.dir, "buyer-state-input");
      await buyerCli(ctx, "input-envelope", hub.url, state, "CS_BUYER_KEY", ["envelope", "set", "--cap", "0.05", "--per-merchant", "0.05", ...allow]);
      const r = await buyerCli(ctx, "input-buy", hub.url, state, "CS_BUYER_KEY", ["buy", seller.offerHash, "--input", JSON.stringify({ section: 7 })]);
      equal(r.code, 1, "buy exit code");
      equal(r.stderr.trim().split("\n").at(-1), BAD_INPUT, "refusal");
      check(!readJournal(state).some((e) => e.kind === "signed"), "the buyer signed nothing");
    });

    await ctx.step("over the budget", () =>
      refusedBy(ctx, hub, seller, "cap", ["--cap", "0.005", "--per-merchant", "0.05", ...allow], "Refused. This would spend 0.01 of a 0.005 budget.", "over-cap"),
    );
    await ctx.step("over the per-seller limit", () =>
      refusedBy(ctx, hub, seller, "merchant", ["--cap", "0.05", "--per-merchant", "0.005", ...allow], "Refused. This would spend 0.01 with one seller; the limit is 0.005.", "over-merchant-limit"),
    );
    await ctx.step("seller not on the allowlist", () =>
      refusedBy(ctx, hub, seller, "allowlist", ["--cap", "0.05", "--per-merchant", "0.05", "--allow", "0x0000000000000000000000000000000000000001"], "Refused. This seller is not on the allowlist.", "not-allowlisted"),
    );
    await ctx.step("envelope revoked", () =>
      refusedBy(ctx, hub, seller, "revoked", ["--cap", "0.05", "--per-merchant", "0.05", ...allow, "--revoke"], "Refused. The envelope was revoked.", "revoked"),
    );
    await ctx.step("held above ask-above until the human approves", () =>
      refusedBy(ctx, hub, seller, "held", ["--cap", "0.05", "--per-merchant", "0.05", "--ask-above", "0.005", ...allow], "Held. This call is above your ask-above limit; approve it to countersign.", "held"),
    );

    await ctx.step("seller offline: refused, nothing charged", async () => {
      await seller.proc.stop();
      for (let i = 0; i < 20; i++) {
        const l = await ctx.http("listing after stop", `${hub.url}/offers/${seller.offerHash}`);
        if ((l.json as { online?: boolean }).online === false) break;
        await sleep(500);
      }
      const res = await ctx.http("call with the seller offline", `${hub.url}/offers/${seller.offerHash}/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: {} }),
      });
      equal(res.status, 503, "offline call status");
      equal((res.json as { message?: string }).message, "The seller is offline. Nothing was charged.", "offline message");
      const state = join(ctx.dir, "buyer-state-offline");
      await buyerCli(ctx, "offline-envelope", hub.url, state, "CS_BUYER_KEY", ["envelope", "set", "--cap", "0.05", "--per-merchant", "0.05", ...allow]);
      const r = await buyerCli(ctx, "offline-buy", hub.url, state, "CS_BUYER_KEY", ["buy", seller.offerHash, "--input", "{}"]);
      equal(r.code, 1, "buy exit code");
      equal(r.stderr.trim().split("\n").at(-1), "Refused. The seller is offline.", "refusal");
    });
  },
};
