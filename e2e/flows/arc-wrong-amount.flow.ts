/**
 * 2 · Arc wrong-amount settle. The buyer countersigns the listed price. Claimed at any other
 * price, the hub refuses the payment, and a `fund` forced onto the chain reverts.
 */

import { encodeFunctionData, type Hex } from "viem";
import {
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  toBase64Json,
  canonicalJson,
  jobIdOf,
  type CountersignExtra,
  type CountersignPayload,
  type PaymentRequired,
} from "@countersign/core";
import { countersignPayer, KNOWN_RAILS } from "@countersign/buyer";
import { escrowAbi, escrowV2Abi, fundArgs, fundArgsV2 } from "@countersign/rail";
import { arcV2Rail, startHub, startSkillSeller, USE_ARC } from "../lib/actors.ts";
import { units, wallets } from "../lib/budget.ts";
import { ARC, escrowEvents, JOB, jobOf, receipt, revertOf, sameAddress, tokenTransfers, writer } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow } from "../lib/flow.ts";
import { PRICE } from "./arc-spine.flow.ts";

const MOVED = PRICE * 2n;

export const arcWrongAmount: Flow = {
  name: "arc-wrong-amount",
  title: "Arc wrong-amount settle reverts",
  owner: "orch-cs",
  network: "arc",
  spends(env) {
    // Nothing moves from the buyer. The stranger pays gas for one reverted transaction.
    return [{ wallet: wallets(env.secrets).arcStranger(), amount: units("0.01", 18), floor: units("0.05", 18) }];
  },
  async run(ctx) {
    const s = ctx.env.secrets;
    const buyerAccount = s.account("CS_BUYER_KEY");
    const stranger = s.account("E2E_STRANGER_KEY");

    const hub = await ctx.step("hub up", () => startHub(ctx, { arc: true }));
    const seller = await ctx.step("seller publishes use-arc", () =>
      startSkillSeller(ctx, hub, { item: USE_ARC, price: PRICE, deadline: 120, rails: ["escrow"], key: "E2E_SELLER_KEY" }),
    );
    const callUrl = `${hub.url}/offers/${seller.offerHash}/call`;

    const entry = await ctx.step("402 challenge", async () => {
      const res = await ctx.http("unpaid call", callUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: {} }),
      });
      equal(res.status, 402, "unpaid call status");
      const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
      check(header, "402 carries a PAYMENT-REQUIRED header");
      const required = fromBase64Json<PaymentRequired>(header);
      equal(canonicalJson(required), canonicalJson(res.json), "PAYMENT-REQUIRED header equals the body");
      const e = required.accepts.find((a) => a.scheme === "countersign" && a.network === `eip155:${ARC.chainId}`);
      check(e, "the 402 offers the countersign scheme on Arc");
      equal(e.amount, PRICE.toString(), "challenge amount is the listed price");
      check(sameAddress(e.payTo, seller.seller), "challenge pays the seller");
      check(sameAddress(e.asset, ARC.token), "challenge asset is Arc USDC");
      const extra = e.extra as unknown as CountersignExtra;
      sameHex(extra.escrow, ARC.escrow, "challenge escrow");
      equal(extra.chainId, ARC.chainId, "challenge chain id");
      sameHex(extra.offerHash, seller.offerHash, "challenge offer hash");
      return e;
    });

    const signed = await ctx.step("buyer countersigns the listed price", async () => {
      const rail =
        ARC.escrowVersion === 2
          ? arcV2Rail()
          : KNOWN_RAILS.find((k) => k.chainId === ARC.chainId && sameAddress(k.escrow, ARC.escrow));
      check(rail, "the buyer pins the Arc escrow");
      const out = await countersignPayer(buyerAccount).pay(entry, { now: Math.floor(Date.now() / 1000), rail });
      ctx.save("payment.json", out.payment);
      return out;
    });
    const payload = signed.payment.payload as unknown as CountersignPayload;

    await ctx.step("hub refuses a moved price", async () => {
      const moved = structuredClone(signed.payment);
      moved.accepted.amount = MOVED.toString();
      const res = await ctx.http("call at a moved price", callUrl, {
        method: "POST",
        headers: { "content-type": "application/json", [PAYMENT_SIGNATURE_HEADER]: toBase64Json(moved) },
        body: JSON.stringify({ input: {} }),
      });
      equal(res.status, 402, "moved-price call status");
      equal((res.json as { error?: string }).error, "Refused. The price moved after you signed.", "hub refusal");
      const job = await ctx.http("job after the refusal", `${hub.url}/jobs/${signed.jobId}`);
      equal(job.status, 404, "the hub opened no job");
      equal((await jobOf(ARC, signed.jobId)).status, JOB.None, "no job on chain for the signed terms");
    });

    await ctx.step("chain refuses a moved price", async () => {
      const movedJobId = jobIdOf({ ...payload.terms, amount: MOVED.toString() }, ARC.chainId, ARC.escrow);
      let data: Hex;
      let callArgs: readonly unknown[];
      if (ARC.escrowVersion === 2) {
        const [offer, cs] = fundArgsV2(seller.offerHash, payload);
        const movedCs = { ...cs, amount: MOVED };
        const args = [offer, movedCs, "0x"] as const;
        data = encodeFunctionData({ abi: escrowV2Abi, functionName: "fund", args });
        callArgs = args;
      } else {
        const [offer, cs] = fundArgs(seller.offerHash, payload);
        const movedCs = { ...cs, amount: MOVED };
        data = encodeFunctionData({ abi: escrowAbi, functionName: "fund", args: [offer, movedCs] });
        callArgs = [offer, movedCs];
      }
      // Gas is set by hand so the transaction is mined and its revert is on the record.
      const hash: Hex = await writer(ARC, stranger).sendTransaction({ to: ARC.escrow, data, gas: 300_000n });
      ctx.tx("arc", "fund at twice the signed price", hash, { reverted: true });
      const rcpt = await receipt(ARC, hash);
      equal(rcpt.status, "reverted", "moved-price fund receipt status");
      equal(escrowEvents(ARC, rcpt).funded.length, 0, "Funded events in the reverted tx");
      equal(tokenTransfers(ARC, rcpt).length, 0, "token transfers in the reverted tx");
      const why = await revertOf(ARC, stranger.address, "fund", callArgs);
      check(why, "replaying the moved-price fund reverts");
      equal(why.errorName, "CountersignatureMismatch", "revert reason");
      sameHex(why.args[0] as string, movedJobId, "CountersignatureMismatch names the moved terms' job id");
      equal((await jobOf(ARC, movedJobId)).status, JOB.None, "no job for the moved terms");
      equal((await jobOf(ARC, signed.jobId)).status, JOB.None, "no job for the signed terms");
    });

    await ctx.step("the signature holds at the signed price", async () => {
      // Replayed as a call only: nothing is sent and the buyer's authorisation is never used.
      const args: readonly unknown[] =
        ARC.escrowVersion === 2 ? [...fundArgsV2(seller.offerHash, payload), "0x"] : fundArgs(seller.offerHash, payload);
      const why = await revertOf(ARC, stranger.address, "fund", args);
      check(why === null, `fund at the signed price would revert with ${why?.errorName}`);
    });
  },
};
