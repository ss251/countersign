/**
 * The two phone skills: the offers this device publishes, and the outputs it returns.
 *
 * Canonical JSON carries only safe integers as numbers (packages/core canonical.ts), so the
 * coordinates travel as six-decimal strings, the accuracy as whole metres and every time as
 * unix seconds. The photo travels as base64 JPEG bytes beside their sha256, so anyone can check
 * the picture against the hash, and the slip's outputHash commits to both.
 */

import { canonicalHash, type JsonSchema, type Offer } from "@countersign/core";
import type { Address, Hex } from "viem";

export type SkillId = "phone-location" | "phone-photo";

/** Everything in an offer except who sells it and when it was first issued. */
export type SkillTerms = Omit<Offer, "seller" | "issuedAt">;

/** The long side of a delivered photo, in pixels. */
export const PHOTO_MAX_SIDE = 800;
/** JPEG bytes. Base64 of this stays near 530 kB, inside the runner's 1 MB result ceiling. */
export const PHOTO_MAX_BYTES = 400_000;
const PHOTO_MAX_BASE64 = Math.ceil(PHOTO_MAX_BYTES / 3) * 4;

const LOCATION_OUTPUT: JsonSchema = {
  type: "object",
  required: ["lat", "lon", "accuracyM", "at"],
  properties: {
    lat: { type: "string", pattern: "^-?[0-9]{1,2}\\.[0-9]{6}$", description: "Latitude, decimal degrees." },
    lon: { type: "string", pattern: "^-?[0-9]{1,3}\\.[0-9]{6}$", description: "Longitude, decimal degrees." },
    accuracyM: { type: "integer", minimum: 0, description: "The device's own accuracy radius, metres." },
    at: { type: "integer", minimum: 0, description: "When the fix was taken, unix seconds." },
  },
  additionalProperties: false,
};

const PHOTO_OUTPUT: JsonSchema = {
  type: "object",
  required: ["mime", "width", "height", "bytes", "sha256", "data", "at"],
  properties: {
    mime: { const: "image/jpeg" },
    width: { type: "integer", minimum: 1, maximum: PHOTO_MAX_SIDE },
    height: { type: "integer", minimum: 1, maximum: PHOTO_MAX_SIDE },
    bytes: { type: "integer", minimum: 1, maximum: PHOTO_MAX_BYTES },
    sha256: { type: "string", pattern: "^[0-9a-f]{64}$", description: "sha256 of the JPEG bytes, hex." },
    data: {
      type: "string",
      contentEncoding: "base64",
      contentMediaType: "image/jpeg",
      maxLength: PHOTO_MAX_BASE64,
    },
    at: { type: "integer", minimum: 0, description: "When the photo was taken, unix seconds." },
  },
  additionalProperties: false,
};

export const SKILLS: Record<SkillId, SkillTerms> = {
  "phone-location": {
    v: 1,
    title: "phone-location",
    summary:
      "Where one phone is right now. The phone reads its own position when you pay and returns latitude and longitude as six-decimal strings, its accuracy in metres and the time of the fix. Self-reported by the device: it proves what the phone said and when, not that the phone was there.",
    adapter: "skill",
    input: {
      type: "object",
      properties: { reason: { type: "string", maxLength: 140, description: "Shown to the phone's owner." } },
      additionalProperties: false,
    },
    output: LOCATION_OUTPUT,
    price: "10000",
    deadline: 120,
    bond: "0",
    rails: ["escrow"],
  },
  "phone-photo": {
    v: 1,
    title: "phone-photo",
    summary:
      "A photo taken on request by the person holding one phone. They read your prompt, then take the picture or decline. Returned as a JPEG at most 800 px on its long side, with its sha256. The phone re-encodes the picture, so no camera metadata leaves the device.",
    adapter: "skill",
    input: {
      type: "object",
      properties: { prompt: { type: "string", maxLength: 140, description: "What to photograph, shown to the owner." } },
      additionalProperties: false,
    },
    output: PHOTO_OUTPUT,
    price: "50000",
    deadline: 300,
    bond: "0",
    rails: ["escrow"],
  },
};

export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

export function offerFor(id: SkillId, seller: Address, issuedAt: number): Offer {
  return { ...SKILLS[id], seller, issuedAt };
}

/**
 * The key that decides whether an offer is "the same offer" across reloads: the seller and the
 * terms, never the clock. A device keeps one issuedAt per key, so a reload republishes the same
 * hash instead of listing a new offer every time the page opens.
 */
export function termsKey(id: SkillId, seller: Address): Hex {
  return canonicalHash({ seller: seller.toLowerCase(), terms: SKILLS[id] });
}

// ---------------------------------------------------------------------------
// Outputs

export interface LocationOutput {
  lat: string;
  lon: string;
  accuracyM: number;
  at: number;
}

export interface Fix {
  latitude: number;
  longitude: number;
  /** Metres. */
  accuracy: number;
  /** Unix ms, as GeolocationPosition.timestamp. */
  timestamp: number;
}

export function locationOutput(fix: Fix): LocationOutput {
  if (!Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90) throw new Error("The latitude is out of range.");
  if (!Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180) throw new Error("The longitude is out of range.");
  return {
    lat: degrees(fix.latitude),
    lon: degrees(fix.longitude),
    accuracyM: Number.isFinite(fix.accuracy) && fix.accuracy > 0 ? Math.ceil(fix.accuracy) : 0,
    at: Math.floor(fix.timestamp / 1000),
  };
}

/** Six decimals is about 0.1 m, finer than any phone's fix. "-0.000000" never appears. */
function degrees(value: number): string {
  const text = value.toFixed(6);
  return text === "-0.000000" ? "0.000000" : text;
}

export interface PhotoOutput {
  mime: "image/jpeg";
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  data: string;
  at: number;
}

export async function photoOutput(jpeg: Uint8Array, width: number, height: number, atSeconds: number): Promise<PhotoOutput> {
  if (jpeg.byteLength === 0) throw new Error("The photo is empty.");
  if (jpeg.byteLength > PHOTO_MAX_BYTES) throw new Error("The photo is larger than this phone sends.");
  return {
    mime: "image/jpeg",
    width,
    height,
    bytes: jpeg.byteLength,
    sha256: await sha256Hex(jpeg),
    data: toBase64(jpeg),
    at: atSeconds,
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** btoa over 32 kB chunks, so a large photo never overflows the argument list. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
