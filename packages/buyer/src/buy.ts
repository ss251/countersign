import { getAddress, type Hex } from "viem";
import {
  canonicalHash,
  checkEnvelope,
  checkSchema,
  needsHuman,
  slipHash,
  slipSigner,
  type CallResult,
  type CountersignExtra,
  type Envelope,
  type PaymentPayload,
  type PaymentRequirements,
} from "@countersign/core";
import type { HubClient } from "./hub-client.ts";
import type { Journal } from "./journal.ts";
import { KNOWN_RAILS, type KnownRail } from "./known-rails.ts";
import type { Payer } from "./payer.ts";
import type { State } from "./state.ts";
import { checkTerms } from "./terms.ts";

export class BuyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuyError";
  }
}

export interface BuyArgs {
  hub: HubClient;
  offerHash: Hex;
  input: unknown;
  payers: Payer[];
  envelope: Envelope;
  journal: Journal;
  state: State;
  now: number;
  approve?: boolean;
  lineage?: Hex[];
  known?: KnownRail[];
}

export async function buy(a: BuyArgs): Promise<CallResult> {
  const { hub, offerHash, input, journal, envelope } = a;
  const listing = await hub.getOffer(offerHash);
  const offer = listing.offer;
  // The offer is only what the hub says it is until it hashes to the hash we asked for.
  if (canonicalHash(offer).toLowerCase() !== offerHash.toLowerCase()) {
    throw new BuyError("Refused. The hub served an offer that does not match the hash asked for.");
  }
  if (listing.status === "delisted") throw new BuyError("Refused. The offer is delisted.");
  if (!listing.online) throw new BuyError("Refused. The seller is offline.");

  if (!checkSchema(offer.input, input).ok) {
    throw new BuyError("Refused. The input does not match the offer's schema.");
  }

  const first = await hub.call(offerHash, input, undefined, a.lineage);
  if (first.kind === "error") throw new BuyError(first.message);
  if (first.kind === "paid") throw new BuyError("Refused. The hub served the call without payment terms.");
  let entry: PaymentRequirements | undefined;
  let payer: Payer | undefined;
  for (const req of first.required.accepts) {
    const p = a.payers.find((x) => x.canPay(req));
    if (p) {
      entry = req;
      payer = p;
      break;
    }
  }
  if (!entry || !payer) throw new BuyError("Refused. No rail here that this agent can pay.");

  const terms = checkTerms(offer, offerHash, entry, a.known ?? KNOWN_RAILS);
  if (!terms.ok) {
    journal.append({ at: a.now, kind: "refused", offerHash, seller: offer.seller, amount: entry.amount, reason: "terms" });
    throw new BuyError(terms.message);
  }
  const rail = terms.rail;
  const extra = entry.extra as unknown as CountersignExtra;
  const base = { at: a.now, offerHash, seller: offer.seller, amount: entry.amount, network: rail.network, rail: extra.rail };

  if (needsHuman(envelope, entry.amount) && !a.approve) {
    journal.append({ ...base, kind: "refused", reason: "held" });
    throw new BuyError("Held. This call is above your ask-above limit; approve it to countersign.");
  }

  const reservationId = crypto.randomUUID();
  const decision = journal.reserve({ ...base, kind: "countersigned", reservationId }, (spend) =>
    checkEnvelope(envelope, spend, { seller: offer.seller, offerHash, amount: entry.amount }, a.now),
  );
  if (!decision.ok) {
    journal.append({ ...base, kind: "refused", reason: decision.reason });
    throw new BuyError(decision.message);
  }

  let signed: { payment: PaymentPayload; jobId: Hex };
  try {
    signed = await payer.pay(entry, { now: a.now, rail });
  } catch (e) {
    journal.append({ ...base, kind: "failed", reservationId, reason: "signing" });
    throw e;
  }
  const { payment, jobId } = signed;
  journal.append({ ...base, kind: "signed", reservationId, jobId });

  const paid = await hub.call(offerHash, input, payment, a.lineage);
  if (paid.kind !== "paid") {
    const message = paid.kind === "error" ? paid.message : "Refused. The hub asked for payment again.";
    journal.append({ ...base, kind: "failed", jobId, reason: message });
    throw new BuyError(message);
  }
  const { result } = paid;
  const slip = result.slip;

  const bad = async (): Promise<boolean> => {
    try {
      return (
        slip.hash !== slipHash(slip.body) ||
        getAddress(await slipSigner(slip)) !== getAddress(offer.seller) ||
        slip.body.offerHash !== offerHash ||
        slip.body.jobId !== jobId ||
        slip.body.amount !== entry.amount ||
        slip.body.inputHash !== canonicalHash(input) ||
        slip.body.outputHash !== canonicalHash(result.output) ||
        !checkSchema(offer.output, result.output).ok
      );
    } catch {
      return true;
    }
  };
  if (await bad()) {
    journal.append({ ...base, kind: "failed", jobId, reason: "bad-slip" });
    throw new BuyError("Refused. The slip does not verify; the escrow refunds at the deadline.");
  }

  a.state.saveSlip(slip);
  journal.append({
    ...base,
    kind: slip.body.escrow ? "released" : "settled",
    rail: slip.body.rail,
    jobId,
    slipHash: slip.hash,
    closeTx: slip.settlement.transaction,
  });
  return result;
}
