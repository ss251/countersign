/**
 * The few hub calls the phone makes over plain HTTP. The hub answers every route with CORS open,
 * so a phone page on any origin can publish and read. Only signatures leave the device.
 */

import { offerHash, publishMessage, type Offer, type Slip } from "@countersign/core";
import type { Hex } from "viem";
import type { PhoneSigner } from "./link.ts";

export interface HubJob {
  jobId: Hex;
  offerHash: Hex;
  rail: string;
  /** funded | paid | released | settled | failed | refunded */
  status: string;
  deadline: number;
  settleTx: string | null;
  closeTx: string | null;
  slipHash: Hex | null;
}

export class HubError extends Error {
  override name = "HubError";
}

function base(hubUrl: string): string {
  const where = typeof location === "undefined" ? undefined : location.href;
  return new URL(hubUrl, where).toString().replace(/\/+$/, "");
}

/** Sign the offer's hash and list it. Publishing the same offer again is a no-op on the hub. */
export async function publishOffer(hubUrl: string, signer: PhoneSigner, offer: Offer): Promise<Hex> {
  const hash = offerHash(offer);
  const sig = await signer.signMessage({ message: publishMessage(hash) });
  let response: Response;
  try {
    response = await fetch(`${base(hubUrl)}/offers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offer, sig }),
    });
  } catch {
    throw new HubError("The hub did not answer.");
  }
  if (response.status === 200 || response.status === 201) {
    const body = (await response.json()) as { offerHash?: unknown };
    if (typeof body.offerHash !== "string" || body.offerHash.toLowerCase() !== hash.toLowerCase()) {
      throw new HubError("The hub listed a different offer hash.");
    }
    return hash;
  }
  throw new HubError(await sentence(response, `The hub refused the offer (${response.status}).`));
}

/** The hub's record of one job, or null when it does not know it. */
export async function readJob(hubUrl: string, jobId: Hex): Promise<HubJob | null> {
  const response = await fetch(`${base(hubUrl)}/jobs/${jobId}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new HubError(await sentence(response, `The hub answered ${response.status}.`));
  return (await response.json()) as HubJob;
}

/** The slip as the hub stores it once released, with the settlement it closed in. */
export async function readSlip(hubUrl: string, slipHash: Hex): Promise<Slip | null> {
  const response = await fetch(`${base(hubUrl)}/slips/${slipHash}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new HubError(await sentence(response, `The hub answered ${response.status}.`));
  return (await response.json()) as Slip;
}

async function sentence(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message) return body.message;
  } catch {
    // Not JSON: keep the status sentence.
  }
  return fallback;
}
