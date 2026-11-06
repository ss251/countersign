/**
 * The phone's runner link against the real hub (apps/hub, in process, with the escrow test rail):
 * publish, register over the runner WebSocket, take a paid job, return a signed slip, release.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import {
  canonicalHash,
  offerHash,
  publishMessage,
  slipSigner,
  type Offer,
  type PaymentRequired,
  type Slip,
} from "@countersign/core";
import { call, NOW, paymentFor, startHub, type TestHub } from "../../hub/test/support.ts";
import { JobRefusal, RunnerLink, type LinkStatus, type PhoneJob, type ServedSkill } from "../src/runner/link.ts";
import { signerFromKey } from "../src/runner/signer.ts";
import { fromBase64, locationOutput, offerFor, photoOutput, sha256Hex } from "../src/runner/skills.ts";

const FIX = { latitude: 19.0760901, longitude: 72.8774202, accuracy: 11.2, timestamp: NOW * 1000 - 2_000 };
/** Bytes standing in for a JPEG: nothing in the protocol decodes them. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 300 }, (_, i) => i % 251), 0xff, 0xd9]);

let hub: TestHub | null = null;
let link: RunnerLink | null = null;

afterEach(() => {
  link?.stop();
  link = null;
  hub?.close();
  hub = null;
});

async function publishAs(target: TestHub, signer: ReturnType<typeof signerFromKey>, offer: Offer): Promise<Hex> {
  const hash = offerHash(offer);
  const sig = await signer.signMessage({ message: publishMessage(hash) });
  const response = await fetch(`${target.url}/offers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offer, sig }),
  });
  expect(response.status).toBe(201);
  return hash;
}

function until(read: () => boolean, ms = 3_000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (read()) return resolve();
      if (Date.now() - started > ms) return reject(new Error("timed out waiting"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

/** Pay for one call the way the hub's own tests do: read the 402, answer with that entry. */
async function buy(target: TestHub, hash: Hex, input: unknown, nonce: Hex): Promise<Response> {
  const challenge = await call(target, hash, input);
  expect(challenge.status).toBe(402);
  const required = (await challenge.json()) as PaymentRequired;
  const accepted = required.accepts[0];
  if (!accepted) throw new Error("no rail offered");
  return call(target, hash, input, paymentFor(accepted, nonce, NOW + 60));
}

describe("phone runner link on the hub", () => {
  test("a location job is dispatched to the phone, delivered with a signed slip, and released", async () => {
    hub = startHub();
    const signer = signerFromKey(generatePrivateKey());
    const offer = offerFor("phone-location", signer.address, NOW);
    const hash = await publishAs(hub, signer, offer);

    const statuses: LinkStatus[] = [];
    const skill: ServedSkill = { offer, hash, serve: async () => locationOutput(FIX) };
    link = new RunnerLink({
      hubUrl: hub.url,
      signer,
      skills: () => [skill],
      now: () => NOW,
      onStatus: (s) => statuses.push(s),
    });
    link.start();
    await until(() => link?.status.phase === "registered");
    expect(link.status.accepted).toEqual([hash]);
    expect(statuses.map((s) => s.phase)).toEqual(["dialing", "proving", "registered"]);
    expect(hub.runners.isOnline(hash)).toBe(true);

    const response = await buy(hub, hash, { reason: "is the courier at the gate" }, `0x${"21".repeat(32)}`);
    expect(response.status).toBe(200);
    const { output, slip } = (await response.json()) as { output: unknown; slip: Slip };

    expect(output).toEqual({ lat: "19.076090", lon: "72.877420", accuracyM: 12, at: NOW - 2 });
    expect(slip.body.outputHash).toBe(canonicalHash(output));
    expect(slip.body.seller).toBe(signer.address);
    expect(slip.body.offerHash).toBe(hash);
    expect(await slipSigner(slip)).toBe(signer.address);

    expect(hub.rail.releaseCalls).toHaveLength(1);
    expect(hub.rail.releaseCalls[0]?.slipHash).toBe(slip.hash);
    expect(hub.store.getJob(slip.body.jobId)?.status).toBe("released");
  });

  test("a photo job returns the picture with its sha256, and the slip commits to both", async () => {
    hub = startHub();
    const signer = signerFromKey(generatePrivateKey());
    const offer = offerFor("phone-photo", signer.address, NOW);
    const hash = await publishAs(hub, signer, offer);

    const seen: PhoneJob[] = [];
    link = new RunnerLink({
      hubUrl: hub.url,
      signer,
      now: () => NOW,
      skills: () => [
        {
          offer,
          hash,
          serve: async (job) => {
            seen.push(job);
            return photoOutput(JPEG, 640, 480, NOW);
          },
        },
      ],
    });
    link.start();
    await until(() => link?.status.phase === "registered");

    const response = await buy(hub, hash, { prompt: "the parcel on the doorstep" }, `0x${"22".repeat(32)}`);
    expect(response.status).toBe(200);
    const { output, slip } = (await response.json()) as {
      output: { sha256: string; data: string; bytes: number };
      slip: Slip;
    };

    const bytes = fromBase64(output.data);
    expect(bytes).toEqual(JPEG);
    expect(output.bytes).toBe(JPEG.byteLength);
    expect(output.sha256).toBe(new Bun.CryptoHasher("sha256").update(JPEG).digest("hex"));
    expect(output.sha256).toBe(await sha256Hex(bytes));
    expect(slip.body.outputHash).toBe(canonicalHash(output));
    expect(hub.rail.releaseCalls[0]?.slipHash).toBe(slip.hash);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.order.input).toEqual({ prompt: "the parcel on the doorstep" });
    // The hub's test clock gives the buyer 60 s, so the phone may wait 55 s for the person.
    expect(seen[0]?.waitUntil).toBe(NOW + 55);
  });

  test("a declined photo fails the delivery and releases nothing", async () => {
    hub = startHub();
    const signer = signerFromKey(generatePrivateKey());
    const offer = offerFor("phone-photo", signer.address, NOW);
    const hash = await publishAs(hub, signer, offer);
    const refusals: string[] = [];

    link = new RunnerLink({
      hubUrl: hub.url,
      signer,
      now: () => NOW,
      skills: () => [
        {
          offer,
          hash,
          serve: async () => {
            throw new JobRefusal("Refused. The phone's owner declined.");
          },
        },
      ],
      onJob: (update) => {
        if (update.kind === "refused") refusals.push(update.reason);
      },
    });
    link.start();
    await until(() => link?.status.phase === "registered");

    const nonce: Hex = `0x${"23".repeat(32)}`;
    const response = await buy(hub, hash, {}, nonce);
    expect(response.status).toBe(502);
    expect(refusals).toEqual(["Refused. The phone's owner declined."]);
    expect(hub.rail.releaseCalls).toHaveLength(0);
    expect(hub.store.getJob(nonce)?.status).toBe("failed");
  });

  test("a person slower than the hub's wait is told the job is gone, and nothing is released", async () => {
    hub = startHub({ jobTimeoutMs: 5_000 });
    const signer = signerFromKey(generatePrivateKey());
    const offer = offerFor("phone-photo", signer.address, NOW);
    const hash = await publishAs(hub, signer, offer);
    const refusals: string[] = [];

    link = new RunnerLink({
      hubUrl: hub.url,
      signer,
      now: () => NOW,
      hubWaitSeconds: 1,
      skills: () => [
        {
          offer,
          hash,
          // Stands in for a person who never taps: it settles only when the wait runs out.
          serve: (job) =>
            new Promise((_, reject) => {
              job.signal.addEventListener("abort", () => reject(new JobRefusal("Refused. Nobody took the photo in time.")));
            }),
        },
      ],
      onJob: (update) => {
        if (update.kind === "refused") refusals.push(update.reason);
      },
    });
    link.start();
    await until(() => link?.status.phase === "registered");

    const response = await buy(hub, hash, {}, `0x${"24".repeat(32)}`);
    expect(response.status).toBe(502);
    expect(refusals).toEqual(["Refused. Nobody took the photo in time."]);
    expect(hub.rail.releaseCalls).toHaveLength(0);
  });

  test("turning a skill off says hello again with only the skills still on", async () => {
    hub = startHub();
    const signer = signerFromKey(generatePrivateKey());
    const location = offerFor("phone-location", signer.address, NOW);
    const photo = offerFor("phone-photo", signer.address, NOW);
    const locationHash = await publishAs(hub, signer, location);
    const photoHash = await publishAs(hub, signer, photo);

    let on: ServedSkill[] = [
      { offer: location, hash: locationHash, serve: async () => locationOutput(FIX) },
      { offer: photo, hash: photoHash, serve: async () => photoOutput(JPEG, 1, 1, NOW) },
    ];
    link = new RunnerLink({ hubUrl: hub.url, signer, now: () => NOW, skills: () => on });
    link.start();
    await until(() => link?.status.phase === "registered");
    expect(new Set(link.status.accepted)).toEqual(new Set([locationHash, photoHash]));

    on = on.filter((skill) => skill.hash === locationHash);
    link.refresh();
    await until(() => link?.status.phase === "registered" && link.status.accepted.length === 1);
    expect(link.status.accepted).toEqual([locationHash]);
    await until(() => hub?.runners.isOnline(photoHash) === false);
    expect(hub.runners.isOnline(locationHash)).toBe(true);

    on = [];
    link.refresh();
    expect(link.status.phase).toBe("off");
    await until(() => hub?.runners.count === 0);
  });

  test("an offer published by another key is not registered for this phone", async () => {
    hub = startHub();
    const phone = signerFromKey(generatePrivateKey());
    const someoneElse = signerFromKey(generatePrivateKey());
    const theirs = offerFor("phone-location", someoneElse.address, NOW);
    const theirHash = await publishAs(hub, someoneElse, theirs);

    link = new RunnerLink({
      hubUrl: hub.url,
      signer: phone,
      now: () => NOW,
      skills: () => [{ offer: theirs, hash: theirHash, serve: async () => locationOutput(FIX) }],
    });
    link.start();
    await until(() => link?.status.phase === "registered");
    expect(link.status.accepted).toEqual([]);
    expect(hub.runners.isOnline(theirHash)).toBe(false);
  });
});
