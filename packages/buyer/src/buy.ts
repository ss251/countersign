import { getAddress, type Hex } from "viem";
import {
  canonicalHash,
  checkEnvelope,
  checkSchema,
  needsHuman,
  RAIL_IDS,
  slipHash,
  slipSigner,
  type CallResult,
  type CountersignExtra,
  type Envelope,
  type PaymentPayload,
  type PaymentRequirements,
  type RailId,
} from "@countersign/core";
import type { HubClient } from "./hub-client.ts";
import type { Journal } from "./journal.ts";
import { KNOWN_RAILS, type KnownRail } from "./known-rails.ts";
import type { Payer } from "./payer.ts";
import type { State } from "./state.ts";
import { checkGatewayTerms, checkTerms } from "./terms.ts";

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
  /** Restrict the choice to one rail id, e.g. "gateway". */
  rail?: RailId;
}

type Chosen = { kind: "countersign"; rail: KnownRail } | { kind: "gateway" };

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

  const known = a.known ?? KNOWN_RAILS;
  let entry: PaymentRequirements | undefined;
  let payer: Payer | undefined;
  let chosen: Chosen | undefined;
  let refusal: string | undefined;
  let refusedAmount: string | undefined;

  for (const req of first.required.accepts) {
    if (a.rail !== undefined && railIdFor(req) !== a.rail) continue;
    const candidate = a.payers.find((x) => x.canPay(req));
    if (!candidate) continue;

    if (req.scheme === "countersign") {
      const terms = checkTerms(offer, offerHash, req, known);
      if (!terms.ok) {
        refusal ??= terms.message;
        refusedAmount ??= req.amount;
        continue;
      }
      entry = req;
      payer = candidate;
      chosen = { kind: "countersign", rail: terms.rail };
      break;
    }

    if (req.scheme === "exact") {
      const terms = checkGatewayTerms(offer, req);
      if (!terms.ok) {
        refusal ??= terms.message;
        refusedAmount ??= req.amount;
        continue;
      }
      entry = req;
      payer = candidate;
      chosen = { kind: "gateway" };
      break;
    }

    refusal ??= "Refused. This rail is not one this agent knows.";
    refusedAmount ??= req.amount;
  }

  if (!entry || !payer || !chosen) {
    if (refusal !== undefined) {
      journal.append({
        at: a.now,
        kind: "refused",
        offerHash,
        seller: offer.seller,
        amount: refusedAmount ?? offer.price,
        reason: "terms",
      });
      throw new BuyError(refusal);
    }
    throw new BuyError("Refused. No rail here that this agent can pay.");
  }

  const rail = chosen.kind === "countersign" ? chosen.rail : undefined;
  const railId = chosen.kind === "gateway" ? ("gateway" as const) : railIdFor(entry);
  const base = {
    at: a.now,
    offerHash,
    seller: offer.seller,
    amount: entry.amount,
    network: entry.network,
    ...(railId !== undefined ? { rail: railId } : {}),
  };

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
    signed = await payer.pay(entry, {
      now: a.now,
      ...(rail !== undefined ? { rail } : {}),
      resource: first.required.resource,
    });
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

/** The rail id a 402 entry names: extra.rail for countersign, "gateway" for exact batched. */
function railIdFor(req: PaymentRequirements): RailId | undefined {
  if (req.scheme === "countersign") {
    const extra = req.extra as Partial<CountersignExtra> | undefined;
    if (typeof extra?.rail !== "string") return undefined;
    return RAIL_IDS.includes(extra.rail as RailId) ? (extra.rail as RailId) : undefined;
  }
  const name = req.extra?.name;
  if (req.scheme === "exact" && typeof name === "string" && name.toLowerCase() === "gatewaywalletbatched") {
    return "gateway";
  }
  return undefined;
}
