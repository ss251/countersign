import { afterEach, describe, expect, test } from "bun:test";
import { generatePrivateKey } from "viem/accounts";
import { recoverMessageAddress, type Hex } from "viem";
import {
  assertOffer,
  assertSchema,
  canonicalHash,
  checkSchema,
  offerHash,
  runnerAuthMessage,
  type HubToRunner,
  type JobOrder,
  type RunnerToHub,
} from "@countersign/core";
import { JobRefusal, REFUSED, RunnerLink } from "../src/runner/link.ts";
import { signerFromKey } from "../src/runner/signer.ts";
import {
  locationOutput,
  offerFor,
  PHOTO_MAX_BYTES,
  photoOutput,
  SKILL_IDS,
  SKILLS,
  termsKey,
} from "../src/runner/skills.ts";

const NOW = 1_800_000_000;
const SELLER = "0x00000000000000000000000000000000000000AA" as const;

describe("phone skill offers", () => {
  test("both offers pass the hub's own offer and schema checks", () => {
    for (const id of SKILL_IDS) {
      const offer = offerFor(id, SELLER, NOW);
      expect(() => assertOffer(offer)).not.toThrow();
      expect(() => assertSchema(offer.input)).not.toThrow();
      expect(() => assertSchema(offer.output)).not.toThrow();
      expect(offer.rails).toEqual(["escrow"]);
      expect(offer.bond).toBe("0");
    }
    expect(SKILLS["phone-location"].price).toBe("10000");
    expect(SKILLS["phone-photo"].price).toBe("50000");
  });

  test("an empty input is accepted and an unknown field is not", () => {
    const location = offerFor("phone-location", SELLER, NOW);
    expect(checkSchema(location.input, {}).ok).toBe(true);
    expect(checkSchema(location.input, { reason: "x" }).ok).toBe(true);
    expect(checkSchema(location.input, { track: true }).ok).toBe(false);
    const photo = offerFor("phone-photo", SELLER, NOW);
    expect(checkSchema(photo.input, { prompt: "the gate" }).ok).toBe(true);
    expect(checkSchema(photo.input, { prompt: "x".repeat(141) }).ok).toBe(false);
  });

  test("the same seller and terms give the same hash for the same issuedAt, and a key per seller", () => {
    expect(offerHash(offerFor("phone-photo", SELLER, NOW))).toBe(offerHash(offerFor("phone-photo", SELLER, NOW)));
    expect(offerHash(offerFor("phone-photo", SELLER, NOW))).not.toBe(offerHash(offerFor("phone-photo", SELLER, NOW + 1)));
    expect(termsKey("phone-photo", SELLER)).toBe(termsKey("phone-photo", SELLER.toLowerCase() as typeof SELLER));
    expect(termsKey("phone-photo", SELLER)).not.toBe(termsKey("phone-location", SELLER));
  });
});

describe("location output", () => {
  test("six-decimal strings, whole metres rounded up, unix seconds, and canonical", () => {
    const out = locationOutput({ latitude: -33.8688197, longitude: 151.2092957, accuracy: 4.01, timestamp: 1_800_000_000_999 });
    expect(out).toEqual({ lat: "-33.868820", lon: "151.209296", accuracyM: 5, at: 1_800_000_000 });
    expect(checkSchema(SKILLS["phone-location"].output, out).ok).toBe(true);
    expect(() => canonicalHash(out)).not.toThrow();
  });

  test("never prints negative zero, and refuses a position off the globe", () => {
    expect(locationOutput({ latitude: -0.0000001, longitude: 0, accuracy: 0, timestamp: 0 }).lat).toBe("0.000000");
    expect(() => locationOutput({ latitude: 91, longitude: 0, accuracy: 1, timestamp: 0 })).toThrow();
    expect(() => locationOutput({ latitude: 0, longitude: Number.NaN, accuracy: 1, timestamp: 0 })).toThrow();
  });

  test("a raw float output would not hash, which is why the coordinates are strings", () => {
    expect(() => canonicalHash({ lat: 19.07609 })).toThrow();
  });
});

describe("photo output", () => {
  test("carries the sha256 of the exact bytes and fits the offer's schema", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const out = await photoOutput(bytes, 800, 600, NOW);
    expect(out.sha256).toBe(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
    expect(out.data).toBe(Buffer.from(bytes).toString("base64"));
    expect(checkSchema(SKILLS["phone-photo"].output, out).ok).toBe(true);
  });

  test("refuses a photo above the size the hub's runners send", async () => {
    await expect(photoOutput(new Uint8Array(PHOTO_MAX_BYTES + 1), 800, 800, NOW)).rejects.toThrow();
    const largest = await photoOutput(new Uint8Array(PHOTO_MAX_BYTES), 800, 800, NOW);
    expect(checkSchema(SKILLS["phone-photo"].output, largest).ok).toBe(true);
  });
});

/**
 * A stand-in hub that speaks the runner protocol frame by frame, for the refusals a real hub
 * never lets through (it checks input before payment), and to watch every byte the phone sends.
 */
describe("phone-side refusals and what leaves the phone", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let link: RunnerLink | null = null;
  afterEach(() => {
    link?.stop();
    server?.stop(true);
    link = null;
    server = null;
  });

  test("the hello is the seller's signature over the nonce, and the key is never sent", async () => {
    const key = generatePrivateKey();
    const signer = signerFromKey(key);
    const offer = offerFor("phone-location", signer.address, NOW);
    const hash = offerHash(offer);
    const sent: string[] = [];
    const nonce = "phone-test-nonce";
    let served = 0;

    const order = (over: Partial<JobOrder>): JobOrder => ({
      jobId: `0x${"31".repeat(32)}` as Hex,
      offerHash: hash,
      input: {},
      rail: "escrow",
      network: "eip155:5042002",
      buyer: "0x5555555555555555555555555555555555555555",
      payTo: signer.address,
      asset: "0x3600000000000000000000000000000000000000",
      amount: "10000",
      deadline: NOW + 60,
      lineage: [],
      ...over,
    });
    const jobs: JobOrder[] = [
      order({ jobId: `0x${"32".repeat(32)}`, input: { track: true } }),
      order({ jobId: `0x${"33".repeat(32)}`, offerHash: `0x${"44".repeat(32)}` }),
      order({ jobId: `0x${"34".repeat(32)}`, deadline: NOW }),
      order({ jobId: `0x${"35".repeat(32)}` }),
    ];

    server = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req, { data: undefined }) ? undefined : new Response("no", { status: 400 })),
      websocket: {
        open: (ws) => {
          ws.send(JSON.stringify({ t: "challenge", nonce } satisfies HubToRunner));
        },
        message: (ws, data) => {
          const text = String(data);
          sent.push(text);
          const frame = JSON.parse(text) as RunnerToHub;
          if (frame.t === "hello") {
            ws.send(JSON.stringify({ t: "ready", seller: signer.address, offers: [hash] } satisfies HubToRunner));
            ws.send(JSON.stringify({ t: "ping", ts: 7 } satisfies HubToRunner));
            for (const job of jobs) ws.send(JSON.stringify({ t: "job", order: job } satisfies HubToRunner));
          }
        },
      },
    });

    link = new RunnerLink({
      hubUrl: `http://127.0.0.1:${server.port}`,
      signer,
      now: () => NOW,
      skills: () => [
        {
          offer,
          hash,
          serve: async () => {
            served += 1;
            if (served > 1) throw new JobRefusal("unexpected");
            return locationOutput({ latitude: 1, longitude: 2, accuracy: 3, timestamp: NOW * 1000 });
          },
        },
      ],
    });
    link.start();
    const started = Date.now();
    while (sent.filter((t) => t.includes('"t":"fail"') || t.includes('"t":"result"')).length < 4) {
      if (Date.now() - started > 3_000) throw new Error("timed out");
      await Bun.sleep(10);
    }

    const frames = sent.map((t) => JSON.parse(t) as RunnerToHub);
    const hello = frames.find((f) => f.t === "hello");
    if (hello?.t !== "hello") throw new Error("no hello");
    expect(hello.offers).toEqual([hash]);
    expect(await recoverMessageAddress({ message: runnerAuthMessage(nonce), signature: hello.sig })).toBe(signer.address);
    expect(frames).toContainEqual({ t: "pong", ts: 7 });

    const reasons = Object.fromEntries(
      frames.flatMap((f) => (f.t === "fail" ? [[f.jobId, f.reason]] : [])),
    );
    expect(reasons[`0x${"32".repeat(32)}`]).toBe(REFUSED.input);
    expect(reasons[`0x${"33".repeat(32)}`]).toBe(REFUSED.unknownOffer);
    expect(reasons[`0x${"34".repeat(32)}`]).toBe(REFUSED.deadline);
    expect(frames.some((f) => f.t === "result" && f.jobId === `0x${"35".repeat(32)}`)).toBe(true);
    // Only the good job reached the skill: nothing is read for a job the offer would refuse.
    expect(served).toBe(1);

    const everything = sent.join("\n").toLowerCase();
    expect(everything.includes(key.slice(2).toLowerCase())).toBe(false);
  });
});
