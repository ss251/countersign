/**
 * 4a, 4b · On-chain slip hash. The escrow's Released event carries the hash the hub minted the
 * slip with, so the chain holds the slip, not just a link to it. A slip whose body was changed,
 * with its own hash recomputed so it agrees with itself, must fail the on-chain check.
 */

import { keccak256, toBytes, type Hex } from "viem";
import { slipHash, type Slip } from "@countersign/core";
import { escrowAbi } from "@countersign/rail";
import { verifyCli } from "../lib/actors.ts";
import { ARC, escrowEvents, JOB, jobOf, reader, receipt, WHITECHAIN, type EvmNetwork } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow, type FlowCtx } from "../lib/flow.ts";

export interface SlipShare {
  slip: Slip;
  path: string;
  jobId: Hex;
}

async function slipOnchain(ctx: FlowCtx, net: EvmNetwork, share: SlipShare): Promise<void> {
  const { slip, path, jobId } = share;
  const local = slipHash(slip.body);

  await ctx.step("the slip agrees with itself", () => {
    sameHex(slip.hash, local, "slip.hash is the hash of its body");
    sameHex(slip.body.jobId, jobId, "slip job id");
  });

  await ctx.step("Released carries the slip hash", async () => {
    const rel = await receipt(net, slip.settlement.transaction as Hex);
    ctx.tx(net.key, "release", slip.settlement.transaction);
    // Every Released log for this job in the block, read by the job id topic, not trusted from the slip.
    const logs = await reader(net).getContractEvents({
      address: net.escrow,
      abi: escrowAbi,
      eventName: "Released",
      args: { jobId },
      fromBlock: rel.blockNumber,
      toBlock: rel.blockNumber,
    });
    equal(logs.length, 1, "Released logs for this job");
    const args = (logs[0] as unknown as { args: { slipHash: Hex } }).args;
    sameHex(args.slipHash, local, "Released.slipHash equals the hash computed here");
    equal(escrowEvents(net, rel).released.length, 1, "Released events in the release tx");
  });

  await ctx.step("the escrow stores the slip hash", async () => {
    const job = await jobOf(net, jobId);
    equal(job.status, JOB.Released, "jobOf status");
    sameHex(job.slipHash, local, "jobOf slipHash");
  });

  await ctx.step("the genuine slip verifies", async () => {
    const v = await verifyCli(ctx, "genuine", path, net.rpc);
    equal(v.verdict, "VALID", `verdict (${v.lines.join(" | ")})`);
    equal(v.checks.get("onchain"), "ok", "verifier onchain check");
  });

  await ctx.step("a tampered slip fails on chain", async () => {
    const tampered = structuredClone(slip);
    tampered.body.outputHash = keccak256(toBytes(`tampered output ${ctx.env.runId}`));
    tampered.hash = slipHash(tampered.body);
    check(tampered.hash.toLowerCase() !== local.toLowerCase(), "the tampered body hashes differently");
    const tamperedPath = ctx.save("slip-tampered.json", tampered);
    const v = await verifyCli(ctx, "tampered", tamperedPath, net.rpc);
    equal(v.checks.get("hash"), "ok", "the tampered slip's own hash check");
    equal(v.checks.get("onchain"), "FAIL", `the tampered slip's onchain check (${v.lines.join(" | ")})`);
    equal(v.verdict, "INVALID", "tampered verdict");
    equal(v.code, 1, "tampered exit code");
  });
}

export const slipOnchainArc: Flow = {
  name: "slip-onchain-arc",
  title: "On-chain slip hash on Arc",
  owner: "orch-cs",
  network: "arc",
  needs: ["arc-spine"],
  async run(ctx) {
    await slipOnchain(ctx, ARC, ctx.take<SlipShare>("arc.slip", "arc-spine"));
  },
};

export const slipOnchainWhitechain: Flow = {
  name: "slip-onchain-whitechain",
  title: "On-chain slip hash on Whitechain",
  owner: "cs-wc",
  network: "whitechain",
  needs: ["whitechain"],
  async run(ctx) {
    await slipOnchain(ctx, WHITECHAIN, ctx.take<SlipShare>("whitechain.slip", "whitechain"));
  },
};
