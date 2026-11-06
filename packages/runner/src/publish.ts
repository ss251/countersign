/**
 * Publish an offer: sign offerHash with the seller key and POST it to the hub.
 */

import { offerHash, publishMessage, type Offer } from "@countersign/core";
import type { Hex, RunnerAccount } from "./account.ts";

export async function publishOffer(
  hubUrl: string,
  account: RunnerAccount,
  offer: Offer,
): Promise<Hex> {
  const hash = offerHash(offer);
  const sig = await account.signMessage({ message: publishMessage(hash) });
  const base = hubUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/offers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offer, sig }),
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
