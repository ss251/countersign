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
import type { Journal, JournalEntry } from "./journal.ts";
import { requestApproval, type ApprovalOutcome } from "./approvals.ts";
import { KNOWN_DIRECTS, KNOWN_RAILS, knownDirectFor, type KnownRail } from "./known-rails.ts";
import { publishEnvelope, type SigningAccount } from "./mirror.ts";
import type { Payer } from "./payer.ts";
import type { State } from "./state.ts";
import { checkDirectTerms, checkGatewayTerms, checkTerms } from "./terms.ts";

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
  /** "local" refuses above askAbove; "hub" asks the human through the hub first. */
  approvals?: "local" | "hub";
  /** The agent key, needed to sign hub approvals and envelope mirrors. */
  account?: SigningAccount;
  /** Publish the envelope mirror after the buy finishes. */
  mirror?: boolean;
  /** Abort a mirror publish after this many milliseconds. Default 5000. */
  mirrorTimeoutMs?: number;
}

type Chosen = { kind: "countersign"; rail: KnownRail } | { kind: "gateway" } | { kind: "eip3009" };

export async function buy(a: BuyArgs): Promise<CallResult> {
  const { hub, offerHash, input, journal, envelope } = a;
  const agent: SigningAccount | undefined =
    a.account ?? a.payers.find((payer) => payer.account !== undefined)?.account;
  const publishMirror = async (force = false): Promise<void> => {
    if ((!a.mirror && !force) || !agent) return;
    await publishEnvelope({
      hub,
      account: agent,
      envelope,
      spent: journal.spend(),
      now: a.now,
      ...(a.mirrorTimeoutMs !== undefined ? { timeoutMs: a.mirrorTimeoutMs } : {}),
    });
  };
  const record = async (entry: JournalEntry): Promise<void> => {
    journal.append(entry);
  };

  try {
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
        if (req.extra?.name === "GatewayWalletBatched") {
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

        const terms = checkDirectTerms(offer, req, KNOWN_DIRECTS);
        if (!terms.ok) {
          refusal ??= terms.message;
          refusedAmount ??= req.amount;
          continue;
        }
        entry = req;
        payer = candidate;
        chosen = { kind: "eip3009" };
        break;
      }

      refusal ??= "Refused. This rail is not one this agent knows.";
      refusedAmount ??= req.amount;
    }

    if (!entry || !payer || !chosen) {
      if (refusal !== undefined) {
        await record({
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
    const railId =
      chosen.kind === "gateway"
        ? ("gateway" as const)
        : chosen.kind === "eip3009"
          ? ("eip3009" as const)
          : railIdFor(entry);
    const base = {
      at: a.now,
      offerHash,
      seller: offer.seller,
      amount: entry.amount,
      network: entry.network,
      ...(railId !== undefined ? { rail: railId } : {}),
    };

    if (needsHuman(envelope, entry.amount) && !a.approve) {
      if ((a.approvals ?? "local") === "local") {
        await record({ ...base, kind: "refused", reason: "held" });
        throw new BuyError("Held. This call is above your ask-above limit; approve it to countersign.");
      }

      const account = agent;
      if (!account) throw new BuyError("Held. The agent key is not available to ask the hub.");
      const local = checkEnvelope(
        envelope,
        journal.spend(),
        { seller: offer.seller, offerHash, amount: entry.amount },
        a.now,
      );
      if (!local.ok) {
        await record({ ...base, kind: "refused", reason: local.reason });
        throw new BuyError(local.message);
      }

      if (envelope.approver === undefined) {
        await record({ ...base, kind: "refused", reason: "no-approver" });
        throw new BuyError(
          "Held. This envelope names no approver key, so a held call can be approved only on this machine.",
        );
      }

      // The hub must know the approver before the phone can be asked.
      await publishMirror(true);

      let outcome: ApprovalOutcome;
      try {
        outcome = await requestApproval({
          hub,
          account,
          approver: envelope.approver,
          state: a.state,
          offerHash,
          title: offer.title,
          amount: entry.amount,
          rail: railId ?? "unknown",
          terms: entry,
          now: a.now,
        });
      } catch {
        await record({ ...base, kind: "refused", reason: "approval-unavailable" });
        throw new BuyError("Held. The hub could not take the approval request; nothing was signed.");
      }

      if (outcome === "unverified") {
        await record({ ...base, kind: "refused", reason: "human-unverified" });
        throw new BuyError(
          "Held. The hub's answer is not signed by your approver key; nothing was signed.",
        );
      }
      if (outcome !== "countersign") {
        const reason =
          outcome === "decline"
            ? "human-declined"
            : outcome === "expired"
              ? "human-expired"
              : "human-timeout";
        await record({ ...base, kind: "refused", reason });
        throw new BuyError("Held. The human did not countersign this call.");
      }
    }

    const reservationId = crypto.randomUUID();
    const decision = journal.reserve({ ...base, kind: "countersigned", reservationId }, (spend) =>
      checkEnvelope(envelope, spend, { seller: offer.seller, offerHash, amount: entry.amount }, a.now),
    );
    if (!decision.ok) {
      await record({ ...base, kind: "refused", reason: decision.reason });
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
      await record({ ...base, kind: "failed", reservationId, reason: "signing" });
      throw e;
    }
    const { payment, jobId } = signed;
    await record({ ...base, kind: "signed", reservationId, jobId });

    const paid = await hub.call(offerHash, input, payment, a.lineage);
    if (paid.kind !== "paid") {
      const message = paid.kind === "error" ? paid.message : "Refused. The hub asked for payment again.";
      await record({ ...base, kind: "failed", jobId, reason: message });
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
      await record({ ...base, kind: "failed", jobId, reason: "bad-slip" });
      throw new BuyError("Refused. The slip does not verify; the escrow refunds at the deadline.");
    }

    a.state.saveSlip(slip);
    await record({
      ...base,
      kind: slip.body.escrow ? "released" : "settled",
      rail: slip.body.rail,
      jobId,
      slipHash: slip.hash,
      closeTx: slip.settlement.transaction,
    });
    return result;
  } finally {
    await publishMirror();
  }
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
  if (req.scheme === "exact" && knownDirectFor(req, KNOWN_DIRECTS) !== undefined) {
    return "eip3009";
  }
  return undefined;
}
