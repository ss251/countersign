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
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettleResult,
} from "@countersign/core";
import {
  FACILITATORS,
  getSchedule,
  getTransaction,
  HEDERA_TESTNET,
  httpFacilitator,
  netFor,
  secondsOf,
  toSdkTxId,
  USDC_TESTNET,
  type MirrorOptions,
  type MirrorTransaction,
} from "@countersign/rail/hedera";
import type { Client } from "@hiero-ledger/sdk";
import { createScheduledPayment, type ScheduledPayment } from "./schedule.ts";
import { hederaPayment, type HederaPayer, type SignOptions } from "./signer.ts";
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
  /** Client whose operator is the agent: it pays for and signs the HCS appends. Omit when `appendLog` is given. */
  logClient?: Client;
  /** Append one entry. When given, used instead of appending with `logClient` and `topicId`. */
  appendLog?: (entry: SpendEntry) => Promise<{ sequence: number }>;
  spent?: EnvelopeSpend;
  /** Fee payers the agent will sign for. Omitted: read once from `FACILITATORS` on the first buy. */
  trustedFeePayers?: string[];
  /** Test seam: build and submit a schedule. Defaults to createScheduledPayment. */
  createSchedule?: typeof createScheduledPayment;
  fetch?: typeof fetch;
  /** Signing options for each payment, e.g. fixed node account ids in tests. */
  sign?: SignOptions;
  mirror?: MirrorOptions;
  now?: () => number;
  /** Prefer a held schedule when the hub offers one. Defaults to true. */
  preferHeld?: boolean;
  /** Test seam: wait between charge polls. Defaults to a setTimeout promise. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ScheduleHold {
  scheduleId: string;
  createTxId: string;
  offerHash: string;
  seller: string;
  payTo: string;
  asset: string;
  amount: string;
  /** Unix seconds when the schedule stops being executable. Set on a buy's hold. */
  expiresAt?: number;
}

export type ScheduleOutcome =
  | {
      kind: "scheduled";
      scheduleId: string;
      createTxId: string;
      expiresAt: number;
      logSequence: number;
      hold: ScheduleHold;
    }
  | { kind: "refused"; reason: string; message: string; logSequence?: number };

export type ReleaseOutcome = "pending" | "executed" | "released";

/** Seconds past a schedule's expiration before a missing execution counts as a release. */
export const RELEASE_MARGIN_SECONDS = 60;

/** How long the agent waits between mirror reads while a transfer could still land. */
export const CHARGE_POLL_MS = 2_000;
/** Seconds past the transfer's valid window before a missing record counts as not charged. */
export const CHARGE_MARGIN_SECONDS = 20;
/** Seconds past the window and margin before a silent mirror turns the answer into unknown. */
export const CHARGE_UNKNOWN_SECONDS = 60;
/** The most reads charged() makes, so a clock that never advances cannot spin forever. */
export const CHARGE_MAX_POLLS = 300;

export type BuyOutcome =
  | {
      kind: "paid";
      output: unknown;
      slip: CallResult["slip"];
      settlement: SettleResult;
      transactionId: string;
      logSequence: number;
      hold?: ScheduleHold;
    }
  | { kind: "refused"; reason: string; message: string; logSequence?: number }
  | {
      kind: "failed";
      status: number;
      message: string;
      charged: boolean;
      transactionId?: string;
      logSequence?: number;
      hold?: ScheduleHold;
    };

/**
 * What the agent has spent, rebuilt from its own HCS log. A schedule counts from the moment it is
 * created; an expired entry releases the amount its schedule entry added, once. A spend that lands
 * after its release means the release was wrong, so it adds its amount back, once.
 */
export function spentFromLog(entries: LoggedEntry[]): EnvelopeSpend {
  let spent: EnvelopeSpend = { total: "0", bySeller: {} };
  const scheduled = new Map<string, { seller: string; amount: string }>();
  const released = new Set<string>();
  const restored = new Set<string>();

  const add = (seller: string, offerHash: string, amount: string) => {
    spent = recordSpend(spent, { seller, offerHash, amount });
  };
  const subtract = (seller: string, amount: string) => {
    const key = seller.toLowerCase();
    spent = {
      total: (BigInt(spent.total) - BigInt(amount)).toString(10),
      bySeller: { ...spent.bySeller, [key]: (BigInt(spent.bySeller[key] ?? "0") - BigInt(amount)).toString(10) },
    };
  };

  for (const { entry } of entries) {
    if (entry.kind === "schedule") {
      if (entry.schedule) scheduled.set(entry.schedule, { seller: entry.seller, amount: entry.amount });
      add(entry.seller, entry.offerHash, entry.amount);
    } else if (entry.kind === "expired") {
      if (!entry.schedule || released.has(entry.schedule)) continue;
      const held = scheduled.get(entry.schedule);
      if (!held) continue;
      released.add(entry.schedule);
      subtract(held.seller, held.amount);
    } else if (entry.kind === "spend") {
      if (entry.schedule && released.has(entry.schedule)) {
        // The release was wrong: the money moved, so put it back once.
        if (restored.has(entry.schedule)) continue;
        restored.add(entry.schedule);
        add(entry.seller, entry.offerHash, entry.amount);
        continue;
      }
      // A spend that follows its schedule entry was already counted at create time.
      if (entry.schedule && scheduled.has(entry.schedule)) continue;
      add(entry.seller, entry.offerHash, entry.amount);
    }
  }
  return spent;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createHederaAgent(opts: HederaAgentOptions) {
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const createSchedule = opts.createSchedule ?? createScheduledPayment;
  let spent: EnvelopeSpend = opts.spent ?? { total: "0", bySeller: {} };
  const hub = opts.hub.replace(/\/$/, "");
  const reservations = new Map<number, { seller: string; offerHash: string; amount: string }>();
  const releasedSchedules = new Set<string>();
  let nextReservation = 0;
  let trusted: Set<string> | null = opts.trustedFeePayers ? new Set(opts.trustedFeePayers) : null;
  let trustLookup: Promise<Set<string>> | null = null;

  /** Fee payers this agent will sign for, read from the hosted facilitators once when not configured. */
  function trustedFeePayers(): Promise<Set<string>> {
    if (trusted) return Promise.resolve(trusted);
    trustLookup ??= (async () => {
      const found = new Set<string>();
      await Promise.all(
        FACILITATORS.map(async ({ name, url }) => {
          try {
            const feePayer = await httpFacilitator(name, url).feePayer();
            if (feePayer) found.add(feePayer);
          } catch {
            // An unreachable facilitator contributes no fee payer.
          }
        }),
      );
      trusted = found;
      return found;
    })();
    return trustLookup;
  }

  /** Settled spend plus every reserved amount. Rebuilt from the reservations so a release cannot drift. */
  function spendIncludingPending(): EnvelopeSpend {
    let held: EnvelopeSpend = { total: "0", bySeller: {} };
    for (const req of reservations.values()) held = recordSpend(held, req);
    const bySeller = { ...spent.bySeller };
    for (const [seller, amount] of Object.entries(held.bySeller)) {
      bySeller[seller] = (BigInt(bySeller[seller] ?? "0") + BigInt(amount)).toString(10);
    }
    return { total: (BigInt(spent.total) + BigInt(held.total)).toString(10), bySeller };
  }

  function reserve(req: { seller: string; offerHash: string; amount: string }): number {
    const id = nextReservation++;
    reservations.set(id, req);
    return id;
  }

  function release(id: number): void {
    reservations.delete(id);
  }

  function settleReservation(id: number): void {
    const held = reservations.get(id);
    if (!held) return;
    reservations.delete(id);
    spent = recordSpend(spent, held);
  }

  async function log(
    kind: SpendEntry["kind"],
    subject: { offerHash: string; seller: string },
    terms: { payTo: string; asset: string; amount: string },
    extra: { tx?: string; schedule?: string; expiresAt?: number; reason?: string },
  ): Promise<number> {
    const entry: SpendEntry = {
      v: 1,
      kind,
      rail: "hedera",
      network: HEDERA_TESTNET,
      offerHash: subject.offerHash,
      seller: subject.seller,
      payTo: terms.payTo,
      asset: terms.asset,
      amount: terms.amount,
      ...extra,
      total: spent.total,
      cap: opts.envelope.cap,
      at: now(),
    };
    if (opts.appendLog) return (await opts.appendLog(entry)).sequence;
    if (!opts.logClient) throw new Error("hedera agent needs logClient or appendLog");
    return (await appendEntry(opts.logClient, opts.topicId, entry)).sequence;
  }

  /** Did this payment reach consensus? Used when the hub fails after the facilitator may have settled. */
  async function charged(transactionId: string, req: PaymentRequirements, validUntil: number): Promise<boolean> {
    for (let i = 0; i < CHARGE_MAX_POLLS; i++) {
      let tx: MirrorTransaction | null | undefined;
      try {
        tx = await getTransaction(transactionId, opts.mirror);
      } catch {
        tx = undefined;
      }
      if (tx) return tx.result === "SUCCESS" && netFor(tx.tokens[req.asset] ?? [], opts.payer.accountId) === -BigInt(req.amount);
      if (tx === null && now() >= validUntil + CHARGE_MARGIN_SECONDS) return false;
      if (now() >= validUntil + CHARGE_MARGIN_SECONDS + CHARGE_UNKNOWN_SECONDS) break;
      await sleep(CHARGE_POLL_MS);
    }
    throw new Error(`Unknown whether ${transactionId} was charged: the mirror did not answer after the transfer's valid window closed.`);
  }

  /** Create the scheduled payment, settle its reservation, and write the schedule entry. */
  async function createHold(input: {
    client: Client;
    seller: string;
    offerHash: string;
    payTo: string;
    asset: string;
    amount: string;
    expiresInSeconds: number;
  }): Promise<{ payment: ScheduledPayment; logSequence: number; expiresAt: number; hold: ScheduleHold }> {
    const subject = { offerHash: input.offerHash, seller: input.seller };
    const terms = { payTo: input.payTo, asset: input.asset, amount: input.amount };
    const reservation = reserve({ seller: input.seller, offerHash: input.offerHash, amount: input.amount });
    const expiresAt = now() + input.expiresInSeconds;

    let payment: ScheduledPayment;
    try {
      payment = await createSchedule(input.client, opts.payer, {
        payTo: input.payTo,
        asset: input.asset,
        amount: BigInt(input.amount),
        offerHash: input.offerHash,
        expiresInSeconds: input.expiresInSeconds,
      });
    } catch (error) {
      // The create may have reached consensus, so the reservation stays held for the life of the
      // agent: releasing it could let a second schedule pass a cap the first still occupies.
      throw error;
    }

    settleReservation(reservation);
    const logSequence = await log("schedule", subject, terms, {
      tx: payment.createTxId,
      schedule: payment.scheduleId,
      expiresAt,
    });
    const hold: ScheduleHold = {
      scheduleId: payment.scheduleId,
      createTxId: payment.createTxId,
      offerHash: input.offerHash,
      seller: input.seller,
      payTo: input.payTo,
      asset: input.asset,
      amount: input.amount,
    };
    return { payment, logSequence, expiresAt, hold };
  }

  /** Pay a held offer: create the schedule, then send its id. Nothing moves until the seller countersigns. */
  async function buyHeld(
    listing: Listing,
    held: PaymentRequirements,
    url: string,
    body: string,
  ): Promise<BuyOutcome> {
    const holdSeconds = held.extra?.holdSeconds;
    if (
      held.extra?.offerHash !== listing.offerHash ||
      held.amount !== listing.offer.price ||
      held.payTo !== listing.offer.payTo?.["hedera-scheduled"] ||
      typeof holdSeconds !== "number" ||
      holdSeconds < 60 ||
      holdSeconds > 3600
    ) {
      return {
        kind: "refused",
        reason: "challenge-mismatch",
        message: "Refused. The hub asked for terms that differ from the offer.",
      };
    }

    const client = opts.logClient;
    if (!client) throw new Error("hedera agent needs logClient to pay a held offer");

    const subject = { offerHash: listing.offerHash, seller: listing.offer.seller };
    const terms = { payTo: held.payTo, asset: held.asset, amount: held.amount };
    const request = { seller: listing.offer.seller, offerHash: listing.offerHash, amount: held.amount };
    const decision = needsHuman(opts.envelope, held.amount)
      ? { ok: false as const, reason: "needs-human", message: "Refused. This amount needs a human; the agent does not ask." }
      : checkEnvelope(opts.envelope, spendIncludingPending(), request, now());
    if (!decision.ok) {
      const seq = await log("refused", subject, terms, { reason: decision.reason });
      return { kind: "refused", reason: decision.reason, message: decision.message, logSequence: seq };
    }

    const { payment, logSequence, expiresAt, hold: created } = await createHold({
      client,
      seller: listing.offer.seller,
      offerHash: listing.offerHash,
      payTo: held.payTo,
      asset: held.asset,
      amount: held.amount,
      expiresInSeconds: holdSeconds,
    });
    const hold: ScheduleHold = { ...created, expiresAt };

    const sent: PaymentPayload = {
      x402Version: 2,
      accepted: held,
      payload: { scheduleId: payment.scheduleId, createTxId: payment.createTxId },
      resource: { url },
    };
    let paid: Response | null = null;
    let fetchMessage = "";
    try {
      paid = await f(url, {
        method: "POST",
        headers: { "content-type": "application/json", [PAYMENT_SIGNATURE_HEADER]: toBase64Json(sent) },
        body,
      });
    } catch (error) {
      fetchMessage = messageOf(error);
    }

    if (paid?.status === 200) {
      const result = (await paid.json()) as CallResult;
      const responseHeader = paid.headers.get(PAYMENT_RESPONSE_HEADER);
      const settlement: SettleResult = responseHeader
        ? fromBase64Json<SettleResult>(responseHeader)
        : { success: true, transaction: result.slip.settlement.transaction, network: HEDERA_TESTNET };
      if (toSdkTxId(settlement.transaction) !== toSdkTxId(hold.createTxId)) {
        throw new Error(
          `hub reported settlement ${settlement.transaction}, but this agent's schedule was created by ${hold.createTxId}`,
        );
      }
      return {
        kind: "paid",
        output: result.output,
        slip: result.slip,
        settlement,
        transactionId: hold.createTxId,
        logSequence,
        hold,
      };
    }

    const status = paid?.status ?? 0;
    const message = paid ? await paid.text() : fetchMessage;
    const record = await getSchedule(hold.scheduleId, opts.mirror).catch(() => null);
    const charged = record?.executedTimestamp != null;
    return { kind: "failed", status, message, charged, transactionId: hold.createTxId, logSequence, hold };
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
      const held = required.accepts.find(
        (a) => a.network === HEDERA_TESTNET && a.scheme === "countersign" && a.extra?.name === "hedera-scheduled",
      );
      if (held && opts.preferHeld !== false) return buyHeld(listing, held, url, body);
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

      const trustedNow = await trustedFeePayers();
      if (typeof req.extra?.feePayer !== "string" || !trustedNow.has(req.extra.feePayer)) {
        return {
          kind: "refused",
          reason: "untrusted-fee-payer",
          message: "Refused. The hub named a fee payer this agent does not trust.",
        };
      }

      // No await between this check and the reservation: one JavaScript turn, so parallel buys serialise.
      const request = { seller: listing.offer.seller, offerHash: listing.offerHash, amount: req.amount };
      const decision = needsHuman(opts.envelope, req.amount)
        ? { ok: false as const, reason: "needs-human", message: "Refused. This amount needs a human; the agent does not ask." }
        : checkEnvelope(opts.envelope, spendIncludingPending(), request, now());
      if (!decision.ok) {
        const seq = await log("refused", { offerHash: listing.offerHash, seller: listing.offer.seller }, req, { reason: decision.reason });
        return { kind: "refused", reason: decision.reason, message: decision.message, logSequence: seq };
      }
      const reservation = reserve(request);

      let payment: PaymentPayload;
      let transactionId: string;
      let validUntil: number;
      try {
        ({ payment, transactionId, validUntil } = await hederaPayment(opts.payer, req, url, opts.sign));
      } catch (error) {
        // Nothing signed, so nothing can land.
        release(reservation);
        throw error;
      }
      let paid: Response;
      try {
        paid = await f(url, {
          method: "POST",
          headers: { "content-type": "application/json", [PAYMENT_SIGNATURE_HEADER]: toBase64Json(payment) },
          body,
        });
      } catch (error) {
        // The request left without an answer: hold the reservation until the chain can rule it out.
        const wasCharged = await charged(transactionId, req, validUntil);
        if (wasCharged) {
          settleReservation(reservation);
          await log("spend", { offerHash: listing.offerHash, seller: listing.offer.seller }, req, { tx: transactionId });
        } else {
          release(reservation);
        }
        throw error;
      }
      if (paid.status === 200) {
        const result = (await paid.json()) as CallResult;
        const responseHeader = paid.headers.get(PAYMENT_RESPONSE_HEADER);
        const settlement: SettleResult = responseHeader
          ? fromBase64Json<SettleResult>(responseHeader)
          : { success: true, transaction: result.slip.settlement.transaction, network: HEDERA_TESTNET };
        if (toSdkTxId(settlement.transaction) !== toSdkTxId(transactionId)) {
          throw new Error(`hub reported settlement ${settlement.transaction}, but this agent signed ${transactionId}`);
        }
        settleReservation(reservation);
        const seq = await log("spend", { offerHash: listing.offerHash, seller: listing.offer.seller }, req, { tx: transactionId });
        return { kind: "paid", output: result.output, slip: result.slip, settlement, transactionId, logSequence: seq };
      }

      // Anything else: the log must still say whether money moved.
      const message = await paid.text();
      const wasCharged = await charged(transactionId, req, validUntil);
      let seq: number | undefined;
      if (wasCharged) {
        settleReservation(reservation);
        seq = await log("spend", { offerHash: listing.offerHash, seller: listing.offer.seller }, req, { tx: transactionId });
      } else {
        release(reservation);
      }
      return { kind: "failed", status: paid.status, message, charged: wasCharged, transactionId, logSequence: seq };
    },

    /**
     * Create a scheduled USDC transfer under the envelope. The amount is reserved and logged as a
     * schedule the moment the create is submitted, so a second schedule cannot slip past the cap
     * while the first is still executable.
     */
    async schedule(
      target: { offer: Offer; offerHash: string },
      scheduleOpts: { client: Client; expiresInSeconds: number },
    ): Promise<ScheduleOutcome> {
      const payTo = target.offer.payTo?.hedera ?? "";
      const subject = { offerHash: target.offerHash, seller: target.offer.seller };
      const terms = { payTo, asset: USDC_TESTNET, amount: target.offer.price };

      if (!target.offer.rails.includes("hedera") || !/^0\.0\.\d+$/.test(payTo)) {
        const reason = "no-hedera";
        const message = "Refused. The offer does not settle on the hedera rail with an account id.";
        const seq = await log("refused", subject, terms, { reason });
        return { kind: "refused", reason, message, logSequence: seq };
      }

      // No await between this check and the reservation: one JavaScript turn, so parallel schedules serialise.
      const request = { seller: target.offer.seller, offerHash: target.offerHash, amount: target.offer.price };
      const decision = needsHuman(opts.envelope, request.amount)
        ? { ok: false as const, reason: "needs-human", message: "Refused. This amount needs a human; the agent does not ask." }
        : checkEnvelope(opts.envelope, spendIncludingPending(), request, now());
      if (!decision.ok) {
        const seq = await log("refused", subject, terms, { reason: decision.reason });
        return { kind: "refused", reason: decision.reason, message: decision.message, logSequence: seq };
      }
      const { logSequence, expiresAt, hold } = await createHold({
        client: scheduleOpts.client,
        seller: target.offer.seller,
        offerHash: target.offerHash,
        payTo,
        asset: USDC_TESTNET,
        amount: target.offer.price,
        expiresInSeconds: scheduleOpts.expiresInSeconds,
      });
      return {
        kind: "scheduled",
        scheduleId: hold.scheduleId,
        createTxId: hold.createTxId,
        expiresAt,
        logSequence,
        hold,
      };
    },

    /**
     * Release a schedule that is deleted, or whose expiration passed by more than
     * `RELEASE_MARGIN_SECONDS` with no execution on the mirror. A schedule that executed, or is
     * still pending, changes nothing. Releasing the same schedule twice logs once.
     */
    async releaseExpired(hold: ScheduleHold): Promise<ReleaseOutcome> {
      const record = await getSchedule(hold.scheduleId, opts.mirror);
      if (!record) return "pending";
      if (record.executedTimestamp) return "executed";
      const expirationSeconds = secondsOf(record.expirationTime);
      const expired =
        record.deleted || (expirationSeconds !== null && now() >= expirationSeconds + RELEASE_MARGIN_SECONDS);
      if (!expired) return "pending";
      if (releasedSchedules.has(hold.scheduleId)) return "released";
      releasedSchedules.add(hold.scheduleId);

      const key = hold.seller.toLowerCase();
      spent = {
        total: (BigInt(spent.total) - BigInt(hold.amount)).toString(10),
        bySeller: {
          ...spent.bySeller,
          [key]: (BigInt(spent.bySeller[key] ?? "0") - BigInt(hold.amount)).toString(10),
        },
      };
      await log(
        "expired",
        { offerHash: hold.offerHash, seller: hold.seller },
        { payTo: hold.payTo, asset: hold.asset, amount: hold.amount },
        { tx: hold.createTxId, schedule: hold.scheduleId },
      );
      return "released";
    },
  };
}
