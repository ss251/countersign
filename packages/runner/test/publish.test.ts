import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "bun";
import { privateKeyToAccount } from "viem/accounts";
import { offerHash, type Offer } from "@countersign/core";
import type { Hex } from "../src/account.ts";
import { parseOptions } from "../src/cli.ts";
import { publishOffer } from "../src/publish.ts";
import { readSkill, skillOffer } from "../src/skill.ts";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");

const server: Server<undefined> = Bun.serve({
  port: 0,
  async fetch(request) {
    const body = (await request.json()) as { offer: Offer };
    return Response.json({ offerHash: offerHash(body.offer) });
  },
});
const hubUrl = `http://127.0.0.1:${server.port}`;

afterEach(() => {
  // The server lives for the file; each test uses its own state directory.
});

describe("stable offers", () => {
  test("two publishes with identical inputs keep the same hash", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const skill = await readSkill(FIXTURE);
    const stateDir = mkdtempSync(join(tmpdir(), "cs-runner-offers-"));
    const offer = (now: number): Offer =>
      skillOffer({
        seller: account.address,
        skill,
        price: "1000",
        deadline: 120,
        rails: ["escrow"],
        now,
      });

    const first = await publishOffer(hubUrl, account, offer(1_700_000_000), {
      stateDir,
      skillSha256: skill.sha256,
    });
    const second = await publishOffer(hubUrl, account, offer(1_800_000_000), {
      stateDir,
      skillSha256: skill.sha256,
    });

    expect(offerHash(first.offer)).toBe(first.offerHash);
    expect(second.offerHash).toBe(first.offerHash);
    expect(second.offer).toEqual(first.offer);
  });

  test("a changed input gets a fresh issuedAt", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const skill = await readSkill(FIXTURE);
    const stateDir = mkdtempSync(join(tmpdir(), "cs-runner-offers-"));
    const base = {
      seller: account.address,
      skill,
      deadline: 120,
      rails: ["escrow" as const],
    };

    await publishOffer(hubUrl, account, skillOffer({ ...base, price: "1000", now: 100 }), {
      stateDir,
      skillSha256: skill.sha256,
    });
    const changed = skillOffer({ ...base, price: "2000", now: 200 });
    const published = await publishOffer(hubUrl, account, changed, {
      stateDir,
      skillSha256: skill.sha256,
    });

    expect(offerHash(published.offer)).toBe(published.offerHash);
    expect(published.offerHash).toBe(offerHash(changed));
    expect(published.offer).toEqual(changed);
  });
});

describe("--pay-to", () => {
  test("writes the payee for a rail into the offer", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const skill = await readSkill(FIXTURE);
    const options = parseOptions([
      "--hub",
      hubUrl,
      "--skill",
      FIXTURE,
      "--price",
      "1000",
      "--pay-to",
      "hedera=0.0.11337065",
      "--pay-to",
      "gateway=0x00000000000000000000000000000000000000A7",
    ]);

    const offer = skillOffer({
      seller: account.address,
      skill,
      price: options.price,
      deadline: options.deadline,
      rails: options.rails,
      payTo: options.payTo,
      now: 1_700_000_000,
    });

    expect(offer.payTo).toEqual({
      hedera: "0.0.11337065",
      gateway: "0x00000000000000000000000000000000000000A7",
    });
  });

  test("refuses a rail that is not in RAIL_IDS", () => {
    expect(() =>
      parseOptions([
        "--hub",
        hubUrl,
        "--skill",
        FIXTURE,
        "--price",
        "1000",
        "--pay-to",
        "solana=123",
      ]),
    ).toThrow("Unknown rail solana.");
  });
});
