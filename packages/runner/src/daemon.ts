/**
 * The runner daemon: dial out to the hub, prove the seller key, serve the
 * seller's offers, and answer every job with a result and a signed slip.
 */

import {
  canonicalHash,
  checkSchema,
  offerHash,
  RUNNER_PATH,
  runnerAuthMessage,
  slipBodyFor,
  slipHash,
  slipTypedData,
  type HubToRunner,
  type JobOrder,
  type Offer,
  type RunnerToHub,
} from "@countersign/core";
import type { RunnerAccount } from "./account.ts";
import { runInChild, type ChildSpec } from "./child.ts";
import { fundingReader, fundingRefusal, type FundingConfig } from "./funding.ts";
import { substituteBuyer } from "./mcp.ts";

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
}

export interface RunnerHandle {
  ready: Promise<void>;
  stop(): void;
}

const RECONNECT_DELAYS = [1, 2, 4, 8, 16, 30] as const;

export function startRunner(cfg: RunnerConfig): RunnerHandle {
  const clock = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  const timeMs = cfg.limits?.timeMs ?? 30_000;
  const maxOutputBytes = cfg.limits?.maxOutputBytes ?? 1_000_000;
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

    try {
      const body = slipBodyFor(
        order,
        cfg.account.address,
        canonicalHash(order.input),
        canonicalHash(output),
        clock(),
      );
      const hash = slipHash(body);
      const sellerSig = await cfg.account.signTypedData(slipTypedData(body));
      send(target, { t: "result", jobId: order.jobId, output, slip: { body, hash, sellerSig } });
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

function connectUrl(hubUrl: string): string {
  const url = new URL(hubUrl);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${RUNNER_PATH}`;
  return url.toString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
