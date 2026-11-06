#!/usr/bin/env bun
/**
 * Serve the phone's skills from a terminal, through the same RunnerLink, skills and hub client
 * the phone page uses. A manual tool for protocol checks with no phone at hand, not a test.
 *
 * It is not a phone. The position is the one you state with --lat and --lon, not a sensed fix,
 * and the photo is a file you name. Never point it at a hub to sell a real position.
 *
 *   PHONE_SELLER_KEY=0x... bun apps/phone/test/bench.ts --hub http://127.0.0.1:8787 \
 *     --lat 19.076090 --lon 72.877420 [--accuracy 25] [--photo picture.jpg] [--once]
 *
 * The key comes from the environment only, never argv. issuedAt is kept per seller and skill
 * under --state (default ~/.countersign/phone-bench), so a rerun republishes the same offers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { KNOWN_ESCROWS } from "@countersign/verify";
import { fundingRefusal, rpcJobReader } from "../src/runner/funding.ts";
import { publishOffer, readJob } from "../src/runner/hub.ts";
import { RunnerLink, type ServedSkill } from "../src/runner/link.ts";
import { signerFromKey } from "../src/runner/signer.ts";
import { locationOutput, offerFor, photoOutput, termsKey, type SkillId } from "../src/runner/skills.ts";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const key = process.env.PHONE_SELLER_KEY;
if (!key) throw new Error("Set PHONE_SELLER_KEY to the bench seller's key.");
const hubUrl = flag("hub") ?? "http://127.0.0.1:8787";
const lat = flag("lat");
const lon = flag("lon");
const photoPath = flag("photo");
const once = process.argv.includes("--once");
const stateDir = flag("state") ?? join(homedir(), ".countersign", "phone-bench");

const signer = signerFromKey((key.startsWith("0x") ? key : `0x${key}`) as Hex);
const now = (): number => Math.floor(Date.now() / 1000);

function issuedAt(id: SkillId): number {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, "issued.json");
  const state = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, number>) : {};
  const k = termsKey(id, signer.address);
  state[k] ??= now();
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
  return state[k] as number;
}

const skills: ServedSkill[] = [];
if (lat !== undefined && lon !== undefined) {
  const offer = offerFor("phone-location", signer.address, issuedAt("phone-location"));
  const hash = await publishOffer(hubUrl, signer, offer);
  const accuracy = Number(flag("accuracy") ?? "25");
  skills.push({
    offer,
    hash,
    serve: async () =>
      locationOutput({ latitude: Number(lat), longitude: Number(lon), accuracy, timestamp: Date.now() }),
  });
  console.log(`phone-location ${hash} (stated position ${lat}, ${lon})`);
}
if (photoPath !== undefined) {
  const offer = offerFor("phone-photo", signer.address, issuedAt("phone-photo"));
  const hash = await publishOffer(hubUrl, signer, offer);
  const bytes = new Uint8Array(readFileSync(photoPath));
  const width = Number(flag("width") ?? "800");
  const height = Number(flag("height") ?? "600");
  skills.push({ offer, hash, serve: async () => photoOutput(bytes, width, height, now()) });
  console.log(`phone-photo ${hash} (file ${photoPath})`);
}
if (skills.length === 0) throw new Error("Name a skill: --lat and --lon, or --photo.");

console.log(`seller ${signer.address} on ${hubUrl}`);
const chainJob = rpcJobReader();
const link = new RunnerLink({
  hubUrl,
  signer,
  // The same check the phone runs: the job must be funded on Arc for this seller at the price.
  checkOrder: (order, offer) =>
    fundingRefusal(order, offer, { seller: signer.address, now: now(), known: KNOWN_ESCROWS, read: chainJob }),
  skills: () => skills,
  onStatus: (s) => console.log(`link ${s.phase}${s.accepted.length ? ` ${s.accepted.length} offers` : ""}${s.refusal ? ` ${s.refusal}` : ""}`),
  onJob: (update) => {
    if (update.kind === "started") console.log(`job ${update.job.order.jobId} started, wait until ${update.job.waitUntil}`);
    if (update.kind === "refused") console.log(`job ${update.order.jobId} refused: ${update.reason}`);
    if (update.kind === "delivered") {
      console.log(`job ${update.order.jobId} delivered, slip ${update.slip.hash}, outputHash ${update.slip.body.outputHash}`);
      if (once) void settle(update.order.jobId);
    }
  },
});
link.start();

/** Wait for the hub to close the job, print where the money went, then stop. */
async function settle(jobId: Hex): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await Bun.sleep(1_000);
    const job = await readJob(hubUrl, jobId).catch(() => null);
    if (job && job.status !== "funded" && job.status !== "paid") {
      console.log(`hub job ${job.status}, close tx ${job.closeTx}, slip ${job.slipHash}`);
      link.stop();
      process.exit(job.status === "released" || job.status === "settled" ? 0 : 1);
    }
  }
  console.log("the hub did not close the job within 60 s");
  link.stop();
  process.exit(1);
}
