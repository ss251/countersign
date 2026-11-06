// An agent that pays on the hedera rail with no human in the loop. It finds offers on a hub,
// lets the envelope decide, countersigns the USDC transfer, and writes every spend and every
// refusal to its HCS spending log. Its running total is rebuilt from that log, not from local state.
import {
  checkEnvelope,
  fromBase64Json,
  needsHuman,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  recordSpend,
  toBase64Json,
  type CallResult,
  type Envelope,
  type EnvelopeSpend,
  type Offer,
  type PaymentRequired,
  type PaymentRequirements,
  type SettleResult,
} from "@countersign/core";
import { getTransaction, HEDERA_TESTNET, netFor, toSdkTxId, type MirrorOptions } from "@countersign/rail/hedera";
import type { Client } from "@hiero-ledger/sdk";
import { hederaPayment, type HederaPayer } from "./signer.ts";
import { appendEntry, type LoggedEntry, type SpendEntry } from "./spendlog.ts";

export interface Listing {
  offerHash: string;
  offer: Offer;
  online: boolean;
  status: "listed" | "delisted";
}

export interface HederaAgentOptions {
  hub: string;
  payer: HederaPayer;
  envelope: Envelope;
  topicId: string;
  /** Client whose operator is the agent: it pays for and signs the HCS appends. */
  logClient: Client;
  spent?: EnvelopeSpend;
  fetch?: typeof fetch;
  mirror?: MirrorOptions;
  now?: () => number;
}

export type BuyOutcome =
  | {
      kind: "paid";
      output: unknown;
      slip: CallResult["slip"];
      settlement: SettleResult;
      transactionId: string;
      logSequence: number;
    }
  | { kind: "refused"; reason: string; message: string; logSequence?: number }
  | { kind: "failed"; status: number; message: string; charged: boolean; transactionId?: string; logSequence?: number };

/** What the agent has spent, rebuilt from its own HCS log. */
export function spentFromLog(entries: LoggedEntry[]): EnvelopeSpend {
  let spent: EnvelopeSpend = { total: "0", bySeller: {} };
  for (const { entry } of entries) {
    if (entry.kind === "spend") spent = recordSpend(spent, { seller: entry.seller, offerHash: entry.offerHash, amount: entry.amount });
  }
  return spent;
}

export function createHederaAgent(opts: HederaAgentOptions) {
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  let spent: EnvelopeSpend = opts.spent ?? { total: "0", bySeller: {} };
  const hub = opts.hub.replace(/\/$/, "");

  async function log(
    kind: SpendEntry["kind"],
    listing: Listing,
    req: PaymentRequirements,
    extra: { tx?: string; reason?: string },
  ): Promise<number> {
    const entry: SpendEntry = {
      v: 1,
      kind,
      rail: "hedera",
      network: HEDERA_TESTNET,
      offerHash: listing.offerHash,
      seller: listing.offer.seller,
      payTo: req.payTo,
      asset: req.asset,
      amount: req.amount,
      ...extra,
      total: spent.total,
      cap: opts.envelope.cap,
      at: now(),
    };
    return (await appendEntry(opts.logClient, opts.topicId, entry)).sequence;
  }

  /** Did this payment reach consensus? Used when the hub fails after the facilitator may have settled. */
  async function charged(transactionId: string, req: PaymentRequirements): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
      const tx = await getTransaction(transactionId, opts.mirror).catch(() => null);
      if (tx) return tx.result === "SUCCESS" && netFor(tx.tokens[req.asset] ?? [], opts.payer.accountId) === -BigInt(req.amount);
      await new Promise((r) => setTimeout(r, 2_000));
    }
    return false;
  }

  return {
    get spent() {
      return spent;
    },

    /** Listed, online offers that settle on the hedera rail. */
    async discover(): Promise<Listing[]> {
      const r = await f(`${hub}/offers`);
      if (!r.ok) throw new Error(`hub /offers -> ${r.status}`);
      const { offers } = (await r.json()) as { offers: Listing[] };
      return offers.filter((l) => l.status === "listed" && l.online && l.offer.rails.includes("hedera") && !!l.offer.payTo?.hedera);
    },

    async buy(listing: Listing, input: unknown): Promise<BuyOutcome> {
      const url = `${hub}/offers/${listing.offerHash}/call`;
      const body = JSON.stringify({ input });
      const first = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body });
      if (first.status !== 402) {
        return { kind: "failed", status: first.status, message: await first.text(), charged: false };
      }
      const header = first.headers.get(PAYMENT_REQUIRED_HEADER);
      const required = header ? fromBase64Json<PaymentRequired>(header) : ((await first.json()) as PaymentRequired);
      const req = required.accepts.find((a) => a.network === HEDERA_TESTNET && a.scheme === "exact");
      if (!req) return { kind: "refused", reason: "no-hedera", message: "Refused. The hub offered no hedera payment for this offer." };

      // The challenge must be for the offer that was published, at its published price and payee.
      if (
        req.extra?.offerHash !== listing.offerHash ||
        req.amount !== listing.offer.price ||
        req.payTo !== listing.offer.payTo?.hedera
      ) {
        return { kind: "refused", reason: "challenge-mismatch", message: "Refused. The hub asked for terms that differ from the offer." };
      }

      const decision = needsHuman(opts.envelope, req.amount)
        ? { ok: false as const, reason: "needs-human", message: "Refused. This amount needs a human; the agent does not ask." }
        : checkEnvelope(opts.envelope, spent, { seller: listing.offer.seller, offerHash: listing.offerHash, amount: req.amount }, now());
      if (!decision.ok) {
        const seq = await log("refused", listing, req, { reason: decision.reason });
        return { kind: "refused", reason: decision.reason, message: decision.message, logSequence: seq };
      }

      const { payment, transactionId } = await hederaPayment(opts.payer, req, url);
      const paid = await f(url, {
        method: "POST",
        headers: { "content-type": "application/json", [PAYMENT_SIGNATURE_HEADER]: toBase64Json(payment) },
        body,
      });
      if (paid.status === 200) {
        const result = (await paid.json()) as CallResult;
        const responseHeader = paid.headers.get(PAYMENT_RESPONSE_HEADER);
        const settlement: SettleResult = responseHeader
          ? fromBase64Json<SettleResult>(responseHeader)
          : { success: true, transaction: result.slip.settlement.transaction, network: HEDERA_TESTNET };
        if (toSdkTxId(settlement.transaction) !== toSdkTxId(transactionId)) {
          throw new Error(`hub reported settlement ${settlement.transaction}, but this agent signed ${transactionId}`);
        }
        spent = recordSpend(spent, { seller: listing.offer.seller, offerHash: listing.offerHash, amount: req.amount });
        const seq = await log("spend", listing, req, { tx: transactionId });
        return { kind: "paid", output: result.output, slip: result.slip, settlement, transactionId, logSequence: seq };
      }

      // Anything else: the log must still say whether money moved.
      const message = await paid.text();
      const wasCharged = await charged(transactionId, req);
      let seq: number | undefined;
      if (wasCharged) {
        spent = recordSpend(spent, { seller: listing.offer.seller, offerHash: listing.offerHash, amount: req.amount });
        seq = await log("spend", listing, req, { tx: transactionId });
      }
      return { kind: "failed", status: paid.status, message, charged: wasCharged, transactionId, logSequence: seq };
    },
  };
}
