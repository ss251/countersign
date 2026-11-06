/**
 * Publish an offer: reuse the issuedAt that belongs to this offer's inputs so a
 * restart republishes the same hash, then sign the hash and POST it to the hub.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { offerHash, publishMessage, type Offer } from "@countersign/core";
import type { Hex, RunnerAccount } from "./account.ts";

export interface PublishOptions {
  /** Directory holding offers.json; defaults to ~/.countersign/runner. */
  stateDir?: string;
  /** The skill file's sha256. Part of the stable-offer key. */
  skillSha256?: string;
}

interface StoredIssuedAt {
  issuedAt: number;
}

type OfferState = Record<string, StoredIssuedAt>;

export async function publishOffer(
  hubUrl: string,
  account: RunnerAccount,
  offer: Offer,
  options: PublishOptions = {},
): Promise<Hex> {
  const stable = withStableIssuedAt(account.address, offer, options);
  const hash = offerHash(stable);
  const sig = await account.signMessage({ message: publishMessage(hash) });
  const base = hubUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/offers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offer: stable, sig }),
  });

  if (response.status === 200 || response.status === 201) {
    const body = (await response.json()) as { offerHash?: unknown };
    if (typeof body.offerHash !== "string") {
      throw new Error("The hub did not return an offer hash.");
    }
    return body.offerHash as Hex;
  }

  let message = `The hub refused the offer with status ${response.status}.`;
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message) message = body.message;
  } catch {
    // Keep the status message when the body is not JSON.
  }
  throw new Error(message);
}

/** Return the offer with the issuedAt stored for its inputs, storing it the first time. */
function withStableIssuedAt(seller: string, offer: Offer, options: PublishOptions): Offer {
  const dir = options.stateDir ?? join(homedir(), ".countersign", "runner");
  const path = join(dir, "offers.json");
  const key = stableKey(seller, offer, options.skillSha256);
  const state = readState(path);
  const stored = state[key];
  if (stored !== undefined) return { ...offer, issuedAt: stored.issuedAt };

  state[key] = { issuedAt: offer.issuedAt };
  writeState(path, state);
  return offer;
}

/** Everything that decides what the seller is publishing, apart from the clock. */
function stableKey(seller: string, offer: Offer, skillSha256: string | undefined): string {
  return JSON.stringify({
    seller: seller.toLowerCase(),
    skill: skillSha256 ?? "",
    price: offer.price,
    deadline: offer.deadline,
    rails: offer.rails,
    payTo: Object.fromEntries(Object.entries(offer.payTo ?? {}).sort(([a], [b]) => a.localeCompare(b))),
  });
}

function readState(path: string): OfferState {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(value)) return {};
    const state: OfferState = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!isRecord(entry)) continue;
      const issuedAt = entry.issuedAt;
      if (typeof issuedAt === "number" && Number.isSafeInteger(issuedAt) && issuedAt > 0) {
        state[key] = { issuedAt };
      }
    }
    return state;
  } catch {
    return {};
  }
}

function writeState(path: string, state: OfferState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
