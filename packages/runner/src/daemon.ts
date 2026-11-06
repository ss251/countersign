/**
 * The runner daemon: dial out to the hub, prove the seller key, serve the
 * seller's offers, and answer every job with a result and a signed slip.
 */

import {
  canonicalHash,
  canaryMessage,
  checkSchema,
  jobIdOf,
  lockTypedData,
  offerHash,
  RUNNER_PATH,
  runnerAuthMessage,
  slipBodyFor,
  slipHash,
  slipTypedData,
  type HubToRunner,
  type JobOrder,
  type LockTerms,
  type Offer,
  type RunnerToHub,
} from "@countersign/core";
import type { Hex, RunnerAccount } from "./account.ts";
import { runInChild, type ChildSpec } from "./child.ts";
import { fundingReader, fundingRefusal, type FundingConfig } from "./funding.ts";
import { substituteBuyer } from "./mcp.ts";
import { assertRemoteCanServe } from "./remote-signer.ts";

export type { FundingConfig, JobReader, PinnedEscrow } from "./funding.ts";

export interface ServedOffer {
  offer: Offer;
  spec: ChildSpec;
}

export interface RunnerLimits {
  timeMs?: number;
  maxOutputBytes?: number;
}

export interface RunnerJobEvent {
  jobId: string;
  title: string;
  ok: boolean;
  reason?: string;
}

export interface RunnerConfig {
  hubUrl: string;
  account: RunnerAccount;
  served: ServedOffer[];
  limits?: RunnerLimits;
  now?: () => number;
  /** When present, an escrow order must show its funded job on chain before work starts. */
  funding?: FundingConfig;
  onJob?: (event: RunnerJobEvent) => void;
  /** Signs, never submits, the seller's release of a held payment (rail "hedera-scheduled").
   *  Called only after the output passed the offer's schema and the slip is signed. */
  countersign?: (order: JobOrder) => Promise<string>;
  /** Buyer addresses, besides this runner's account, whose purchases may be attested as children. */
  buyerAddresses?: string[];
}

export interface RunnerHandle {
  ready: Promise<void>;
  stop(): void;
}

const RECONNECT_DELAYS = [1, 2, 4, 8, 16, 30] as const;
const ATOMIC = /^(0|[1-9][0-9]*)$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The lock frame's terms, or null when they are missing or not the countersign shape. */
function readLockTerms(value: unknown): LockTerms | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const buyer = raw.buyer;
  const payee = raw.payee;
  const amount = raw.amount;
  const deadline = raw.deadline;
  const salt = raw.salt;
  const bond = raw.bond;
  const reviewWindow = raw.reviewWindow;
  if (typeof buyer !== "string" || !ADDRESS.test(buyer)) return null;
  if (typeof payee !== "string" || !ADDRESS.test(payee)) return null;
  if (typeof amount !== "string" || !ATOMIC.test(amount)) return null;
  if (typeof deadline !== "number" || !Number.isSafeInteger(deadline)) return null;
  if (typeof salt !== "string" || !ATOMIC.test(salt)) return null;
  if (typeof bond !== "string" || !ATOMIC.test(bond)) return null;
  if (typeof reviewWindow !== "number" || !Number.isSafeInteger(reviewWindow)) return null;
  return {
    buyer: buyer as LockTerms["buyer"],
    payee: payee as LockTerms["payee"],
    amount,
    deadline,
    salt,
    bond,
    reviewWindow,
  };
}

export function startRunner(cfg: RunnerConfig): RunnerHandle {
  const clock = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  const timeMs = cfg.limits?.timeMs ?? 30_000;
  const maxOutputBytes = cfg.limits?.maxOutputBytes ?? 1_000_000;
  for (const entry of cfg.served) assertRemoteCanServe(cfg.account, entry.offer);
  const served = cfg.served.map((entry) => ({ ...entry, hash: offerHash(entry.offer) }));
  const url = connectUrl(cfg.hubUrl);
  const funding =
    cfg.funding === undefined
      ? null
      : { ...cfg.funding, read: fundingReader(cfg.funding) };

  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const send = (target: WebSocket, message: RunnerToHub): void => {
    if (target.readyState === WebSocket.OPEN) target.send(JSON.stringify(message));
  };

  const notify = (order: JobOrder, title: string, ok: boolean, reason?: string): void => {
    cfg.onJob?.({ jobId: order.jobId, title, ok, reason });
  };

  const fail = (target: WebSocket, order: JobOrder, reason: string): void => {
    send(target, { t: "fail", jobId: order.jobId, reason });
  };

  const handleLock = async (
    target: WebSocket,
    frame: Extract<HubToRunner, { t: "lock" }>,
  ): Promise<void> => {
    if (typeof frame.funder !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(frame.funder)) {
      send(target, {
        t: "lock-refused",
        jobId: frame.jobId,
        reason: "bad-funder",
      });
      return;
    }

    const entry = served.find(
      (item) => item.hash.toLowerCase() === frame.offerHash.toLowerCase(),
    );
    if (!entry) {
      send(target, {
        t: "lock-refused",
        jobId: frame.jobId,
        reason: "Refused. This runner does not serve that offer.",
      });
      return;
    }

    let matches = false;
    try {
      const offered = BigInt(entry.offer.bond);
      matches = offered !== 0n && offered === BigInt(frame.bond);
    } catch {
      matches = false;
    }
    if (!matches) {
      send(target, {
        t: "lock-refused",
        jobId: frame.jobId,
        reason: "Refused. The bond does not match this offer.",
      });
      return;
    }

    const refuse = (reason: string): void => {
      send(target, { t: "lock-refused", jobId: frame.jobId, reason });
    };

    const terms = readLockTerms(frame.terms);
    if (terms === null) {
      refuse("bad-terms");
      return;
    }
    if (terms.payee.toLowerCase() !== cfg.account.address.toLowerCase()) {
      refuse("not-payee");
      return;
    }
    let bondAbove = false;
    try {
      bondAbove = BigInt(terms.bond) > 0n;
    } catch {
      bondAbove = false;
    }
    if (
      terms.amount !== entry.offer.price ||
      terms.bond !== entry.offer.bond ||
      !bondAbove ||
      terms.reviewWindow !== (entry.offer.reviewWindow ?? 0)
    ) {
      refuse("terms-mismatch");
      return;
    }
    if (terms.deadline - clock() < 60) {
      refuse("deadline-too-near");
      return;
    }
    const escrow = frame.escrow;
    const pinned =
      funding !== null &&
      typeof escrow === "string" &&
      funding.known.some(
        (pin) => pin.chainId === frame.chainId && pin.escrow.toLowerCase() === escrow.toLowerCase(),
      );
    if (!pinned) {
      refuse("unknown-escrow");
      return;
    }

    let rebuilt: string;
    try {
      rebuilt = jobIdOf({ offerHash: frame.offerHash, ...terms }, frame.chainId, frame.escrow);
    } catch {
      refuse("job-mismatch");
      return;
    }
    if (typeof frame.jobId !== "string" || rebuilt.toLowerCase() !== frame.jobId.toLowerCase()) {
      refuse("job-mismatch");
      return;
    }

    try {
      const sig = await cfg.account.signTypedData(
        lockTypedData(frame.chainId, frame.escrow, frame.jobId, frame.funder),
      );
      send(target, { t: "locked", jobId: frame.jobId, sig });
    } catch {
      send(target, {
        t: "lock-refused",
        jobId: frame.jobId,
        reason: "Refused. The runner could not sign.",
      });
    }
  };

  const handleJob = async (target: WebSocket, order: JobOrder): Promise<void> => {
    const entry = served.find(
      (item) => item.hash.toLowerCase() === order.offerHash.toLowerCase(),
    );
    if (!entry) {
      notify(order, "unknown offer", false, "Refused. This runner does not serve that offer.");
      return fail(target, order, "Refused. This runner does not serve that offer.");
    }

    if (clock() >= order.deadline) {
      notify(order, entry.offer.title, false, "Refused. The deadline has passed.");
      return fail(target, order, "Refused. The deadline has passed.");
    }

    if (order.rail === "hedera-scheduled") {
      if (!cfg.countersign || !order.schedule) {
        const reason = "Refused. This runner cannot countersign a held Hedera payment.";
        notify(order, entry.offer.title, false, reason);
        return fail(target, order, reason);
      }
      if (order.amount !== entry.offer.price || order.payTo !== entry.offer.payTo?.["hedera-scheduled"]) {
        const reason = "Refused. The held order's terms differ from the served offer.";
        notify(order, entry.offer.title, false, reason);
        return fail(target, order, reason);
      }
    }

    const inputCheck = checkSchema(entry.offer.input, order.input);
    if (!inputCheck.ok) {
      const reason = "Refused. The input does not match the offer's schema.";
      notify(order, entry.offer.title, false, reason);
      return fail(target, order, reason);
    }

    if (funding !== null) {
      const unpaid = await fundingRefusal(order, entry.offer, {
        now: clock,
        known: funding.known,
        read: funding.read,
        retries: funding.retries,
        retryMs: funding.retryMs,
      });
      if (unpaid !== null) {
        notify(order, entry.offer.title, false, unpaid);
        return fail(target, order, unpaid);
      }
    }

    let output: unknown;
    try {
      output = await runInChild(
        substituteBuyer(entry.spec, order.buyer),
        order.input,
        { timeMs, maxOutputBytes },
        [...order.lineage, order.jobId].join(","),
      );
    } catch (error) {
      const reason = messageOf(error);
      notify(order, entry.offer.title, false, reason);
      return fail(target, order, reason);
    }

    const outputCheck = checkSchema(entry.offer.output, output);
    if (!outputCheck.ok) {
      const reason = "Refused. The output does not match the offer's schema.";
      notify(order, entry.offer.title, false, reason);
      return fail(target, order, reason);
    }

    // A children lookup that fails or times out leaves the list empty. Signing still happens.
    let children: Hex[] = [];
    try {
      children = await childHashes(cfg, order.jobId);
    } catch {
      children = [];
    }

    try {
      const body = slipBodyFor(
        order,
        cfg.account.address,
        canonicalHash(order.input),
        canonicalHash(output),
        clock(),
        children,
      );
      const hash = slipHash(body);
      const sellerSig = await cfg.account.signTypedData(slipTypedData(body));
      let countersign: string | undefined;
      if (order.rail === "hedera-scheduled") {
        if (!cfg.countersign || !order.schedule) {
          throw new Error("Refused. This runner cannot countersign a held Hedera payment.");
        }
        countersign = await cfg.countersign(order);
      }
      send(target, {
        t: "result",
        jobId: order.jobId,
        output,
        slip: { body, hash, sellerSig },
        ...(countersign === undefined ? {} : { countersign }),
      });
      notify(order, entry.offer.title, true);
    } catch (error) {
      const reason = messageOf(error);
      notify(order, entry.offer.title, false, reason);
      fail(target, order, reason);
    }
  };

  const handleMessage = async (target: WebSocket, message: HubToRunner): Promise<void> => {
    switch (message.t) {
      case "challenge": {
        const sig = await cfg.account.signMessage({
          message: runnerAuthMessage(message.nonce),
        });
        send(target, {
          t: "hello",
          seller: cfg.account.address,
          offers: served.map((entry) => entry.hash),
          nonce: message.nonce,
          sig,
        });
        return;
      }
      case "ready":
        attempt = 0;
        resolveReady();
        return;
      case "ping":
        send(target, { t: "pong", ts: message.ts });
        return;
      case "job":
        await handleJob(target, message.order);
        return;
      case "lock":
        await handleLock(target, message);
        return;
      case "canary": {
        const entry = served.find(
          (item) => item.hash.toLowerCase() === message.offerHash.toLowerCase(),
        );
        if (!entry) {
          send(target, {
            t: "canary-fail",
            offerHash: message.offerHash,
            nonce: message.nonce,
            reason: "not-served",
          });
          return;
        }
        const sig = await cfg.account.signMessage({
          message: canaryMessage(entry.hash, message.nonce),
        });
        send(target, { t: "canary", offerHash: entry.hash, nonce: message.nonce, sig });
        return;
      }
      case "error":
        return;
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped || reconnectTimer !== null) return;
    const seconds = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)] ?? 30;
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, seconds * 1000);
  };

  const connect = (): void => {
    if (stopped) return;
    let target: WebSocket;
    try {
      target = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = target;
    target.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let message: HubToRunner;
      try {
        message = JSON.parse(event.data) as HubToRunner;
      } catch {
        return;
      }
      void handleMessage(target, message).catch((error: unknown) => {
        if (message.t === "job") fail(target, message.order, messageOf(error));
      });
    });
    target.addEventListener("close", () => {
      if (socket === target) socket = null;
      scheduleReconnect();
    });
    target.addEventListener("error", () => {
      // A close event follows and drives the reconnect.
    });
  };

  connect();

  return {
    ready,
    stop(): void {
      stopped = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        socket?.close();
      } catch {
        // Closing a socket that never opened is not an error here.
      }
      socket = null;
    },
  };
}

const CHILD_TIMEOUT_MS = 2_000;
const SLIP_HASH = /^0x[0-9a-fA-F]{64}$/;

/** Slip hashes of purchases this runner's own buyers made while serving `jobId`. */
async function childHashes(cfg: RunnerConfig, jobId: string): Promise<Hex[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHILD_TIMEOUT_MS);
  try {
    const base = hubHttpBase(cfg.hubUrl);
    const listed = await getJson(
      `${base}/jobs/${encodeURIComponent(jobId)}/children`,
      controller.signal,
    );
    if (!isRecord(listed) || !Array.isArray(listed.children)) {
      throw new Error("The hub's children list is malformed.");
    }
    const buyers = new Set<string>([
      cfg.account.address.toLowerCase(),
      ...(cfg.buyerAddresses ?? []).map((address) => address.toLowerCase()),
    ]);
    const hashes: string[] = [];
    for (const row of listed.children) {
      if (!isRecord(row)) throw new Error("The hub's children list is malformed.");
      const listedHash = row.slipHash;
      if (listedHash === null || listedHash === undefined) continue;
      if (typeof listedHash !== "string" || !SLIP_HASH.test(listedHash)) {
        throw new Error("The hub's children list is malformed.");
      }
      const slip = await getJson(`${base}/slips/${encodeURIComponent(listedHash)}`, controller.signal);
      const buyer = buyerOf(slip);
      if (buyer !== null && buyers.has(buyer.toLowerCase())) hashes.push(listedHash.toLowerCase());
    }
    return [...new Set(hashes)].sort() as Hex[];
  } finally {
    clearTimeout(timer);
  }
}

/** The hub's HTTP base. A websocket hub URL becomes the same host over HTTP. */
function hubHttpBase(hubUrl: string): string {
  const url = new URL(hubUrl);
  if (url.protocol === "ws:") url.protocol = "http:";
  else if (url.protocol === "wss:") url.protocol = "https:";
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`The hub answered ${response.status}.`);
  const body: unknown = await response.json();
  return body;
}

function buyerOf(slip: unknown): string | null {
  if (!isRecord(slip) || !isRecord(slip.body)) return null;
  const buyer = slip.body.buyer;
  return typeof buyer === "string" ? buyer : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function connectUrl(hubUrl: string): string {
  const url = new URL(hubUrl);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${RUNNER_PATH}`;
  return url.toString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
