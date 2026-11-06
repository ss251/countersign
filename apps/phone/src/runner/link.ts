/**
 * The phone's runner link: the protocol packages/runner speaks, written for a browser tab.
 *
 * It dials out to the hub, so the phone opens no port and needs no tunnel. It proves the seller
 * key with a personal_sign over the hub's nonce, registers the offers the person has turned on,
 * and answers each job with the output and a slip signed by the same key:
 *
 *   hub: challenge -> phone: hello (signed) -> hub: ready
 *   hub: job       -> phone: result | fail
 *   hub: ping      -> phone: pong
 *
 * Nothing here touches the DOM, so the tests run this exact code against the real hub.
 */

import {
  canonicalHash,
  checkSchema,
  RUNNER_PATH,
  runnerAuthMessage,
  slipBodyFor,
  slipHash,
  slipTypedData,
  type HubToRunner,
  type JobOrder,
  type Offer,
  type RunnerToHub,
  type Slip,
} from "@countersign/core";
import type { Address, Hex } from "viem";

/** The part of a viem LocalAccount the link uses. The key itself never reaches this module. */
export interface PhoneSigner {
  address: Address;
  signMessage(args: { message: string }): Promise<Hex>;
  signTypedData(args: ReturnType<typeof slipTypedData>): Promise<Hex>;
}

export interface PhoneJob {
  order: JobOrder;
  offer: Offer;
  /** Unix seconds after which the hub has stopped waiting for this job. */
  waitUntil: number;
  /** Aborts when the hub stops waiting or the link drops. */
  signal: AbortSignal;
}

export interface ServedSkill {
  /** The exact offer published on the hub. */
  offer: Offer;
  hash: Hex;
  /** Produce the output for one paid job. Throw a JobRefusal to refuse it in plain words. */
  serve(job: PhoneJob): Promise<unknown>;
}

/** A refusal the person or the device chose, sent to the hub as the fail reason. */
export class JobRefusal extends Error {
  override name = "JobRefusal";
}

export type LinkPhase =
  /** No skill is on, so the phone does not dial. */
  | "off"
  /** The socket is opening. */
  | "dialing"
  /** The socket is open and the signed hello is out. */
  | "proving"
  /** The hub accepted the hello. */
  | "registered"
  /** The link dropped; the next dial is scheduled. */
  | "waiting";

export interface LinkStatus {
  phase: LinkPhase;
  /** The offers the hub accepted in its ready frame. */
  accepted: Hex[];
  /** Unix ms of the next dial, while waiting. */
  retryAt?: number;
  /** The hub's own sentence when it refused the hello. */
  refusal?: string;
}

export type DeliveredSlip = Pick<Slip, "body" | "hash" | "sellerSig">;

export type JobUpdate =
  | { kind: "started"; job: PhoneJob }
  | { kind: "delivered"; order: JobOrder; output: unknown; slip: DeliveredSlip }
  | { kind: "refused"; order: JobOrder; reason: string };

export interface LinkConfig {
  hubUrl: string;
  signer: PhoneSigner;
  /** Read on every dial: only the skills the person has turned on. */
  skills: () => ServedSkill[];
  /** Unix seconds. */
  now?: () => number;
  onStatus?: (status: LinkStatus) => void;
  onJob?: (update: JobUpdate) => void;
  /** Injected in tests; the browser's own WebSocket otherwise. */
  WebSocketImpl?: typeof WebSocket;
  /** How long the hub waits for a runner by default (apps/hub `jobTimeoutMs`, 120 s). */
  hubWaitSeconds?: number;
}

/** Mirrors packages/runner: back off 1, 2, 4, 8, 16, then every 30 s. */
const RETRY_SECONDS = [1, 2, 4, 8, 16, 30] as const;
/** The hub pings every 20 s. Silence past this means the socket is dead even if it looks open. */
const SILENCE_MS = 50_000;
/** packages/runner's default ceiling on one output. The hub's WebSocket itself takes 16 MB. */
export const MAX_RESULT_BYTES = 1_000_000;

export const REFUSED = {
  unknownOffer: "Refused. This phone does not serve that offer.",
  deadline: "Refused. The deadline has passed.",
  input: "Refused. The input does not match the offer's schema.",
  output: "Refused. The output does not match the offer's schema.",
  tooLarge: "Refused. The output is larger than this phone sends.",
  late: "Refused. The hub stopped waiting before the phone finished.",
} as const;

export class RunnerLink {
  private readonly cfg: LinkConfig;
  private readonly clock: () => number;
  private readonly Socket: typeof WebSocket;
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;
  private running = false;
  private lastFrameAt = 0;
  private redialWhenIdle = false;
  private readonly inFlight = new Map<string, AbortController>();
  private current: LinkStatus = { phase: "off", accepted: [] };

  constructor(cfg: LinkConfig) {
    this.cfg = cfg;
    this.clock = cfg.now ?? (() => Math.floor(Date.now() / 1000));
    this.Socket = cfg.WebSocketImpl ?? WebSocket;
  }

  get status(): LinkStatus {
    return this.current;
  }

  /** Dial if any skill is on. Safe to call repeatedly. */
  start(): void {
    this.running = true;
    if (this.cfg.skills().length === 0) {
      this.closeSocket();
      this.setStatus({ phase: "off", accepted: [] });
      return;
    }
    if (this.socket === null && this.retryTimer === null) this.dial();
  }

  /** Stop dialing and drop the socket. Jobs in flight are aborted and fail at the hub. */
  stop(): void {
    this.running = false;
    this.clearRetry();
    this.closeSocket();
    this.setStatus({ phase: "off", accepted: [] });
  }

  /**
   * The set of skills changed. The hub binds offers to a connection at its hello, so the link
   * says hello again on a fresh socket, but only once no job is mid-flight on the old one.
   */
  refresh(): void {
    if (!this.running) return;
    if (this.inFlight.size > 0) {
      this.redialWhenIdle = true;
      return;
    }
    this.redialWhenIdle = false;
    this.clearRetry();
    this.closeSocket();
    this.attempt = 0;
    this.start();
  }

  /** The tab came back to the foreground or the network returned: dial now instead of waiting. */
  wake(): void {
    if (!this.running) return;
    if (this.socket !== null) {
      if (Date.now() - this.lastFrameAt > SILENCE_MS) this.refresh();
      return;
    }
    this.clearRetry();
    this.attempt = 0;
    this.start();
  }

  private dial(): void {
    const skills = this.cfg.skills();
    if (!this.running || skills.length === 0) return;
    let target: WebSocket;
    try {
      target = new this.Socket(runnerUrl(this.cfg.hubUrl));
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = target;
    this.lastFrameAt = Date.now();
    this.setStatus({ phase: "dialing", accepted: [] });

    target.addEventListener("message", (event: MessageEvent) => {
      if (this.socket !== target) return;
      this.lastFrameAt = Date.now();
      if (typeof event.data !== "string") return;
      let frame: HubToRunner;
      try {
        frame = JSON.parse(event.data) as HubToRunner;
      } catch {
        return;
      }
      void this.onFrame(target, frame);
    });
    target.addEventListener("close", () => {
      if (this.socket !== target) return;
      this.socket = null;
      this.stopWatchdog();
      this.abortAll();
      this.scheduleRetry();
    });
    target.addEventListener("error", () => {
      // A close event follows and schedules the next dial.
    });
    this.startWatchdog(target);
  }

  private async onFrame(target: WebSocket, frame: HubToRunner): Promise<void> {
    switch (frame.t) {
      case "challenge": {
        // Offers are read at hello time, so a refresh that raced the dial is still honoured.
        const offers = this.cfg.skills().map((skill) => skill.hash);
        const sig = await this.cfg.signer.signMessage({ message: runnerAuthMessage(frame.nonce) });
        this.send(target, { t: "hello", seller: this.cfg.signer.address, offers, nonce: frame.nonce, sig });
        this.setStatus({ phase: "proving", accepted: [] });
        return;
      }
      case "ready":
        this.attempt = 0;
        this.setStatus({ phase: "registered", accepted: frame.offers });
        return;
      case "ping":
        this.send(target, { t: "pong", ts: frame.ts });
        return;
      case "job":
        await this.onJob(target, frame.order);
        return;
      case "error":
        // The hub closes the socket right after; keep its sentence for the person to read.
        this.setStatus({ ...this.current, refusal: frame.message });
        return;
    }
  }

  private async onJob(target: WebSocket, order: JobOrder): Promise<void> {
    const refuse = (reason: string): void => {
      this.send(target, { t: "fail", jobId: order.jobId, reason });
      this.cfg.onJob?.({ kind: "refused", order, reason });
    };

    const skill = this.cfg.skills().find((s) => s.hash.toLowerCase() === order.offerHash.toLowerCase());
    if (!skill) return refuse(REFUSED.unknownOffer);
    const now = this.clock();
    if (now >= order.deadline) return refuse(REFUSED.deadline);
    // Nothing is captured for a job the offer would not accept.
    if (!checkSchema(skill.offer.input, order.input).ok) return refuse(REFUSED.input);

    const hubWait = this.cfg.hubWaitSeconds ?? 120;
    const waitUntil = Math.min(order.deadline - 5, now + hubWait);
    const controller = new AbortController();
    this.inFlight.set(order.jobId, controller);
    const timer = setTimeout(() => controller.abort(), Math.max(0, (waitUntil - now) * 1000));
    const job: PhoneJob = { order, offer: skill.offer, waitUntil, signal: controller.signal };

    try {
      this.cfg.onJob?.({ kind: "started", job });
      let output: unknown;
      try {
        output = await skill.serve(job);
      } catch (error) {
        return refuse(error instanceof JobRefusal ? error.message : plainReason(error));
      }
      if (controller.signal.aborted) return refuse(REFUSED.late);
      if (!checkSchema(skill.offer.output, output).ok) return refuse(REFUSED.output);

      const body = slipBodyFor(
        order,
        this.cfg.signer.address,
        canonicalHash(order.input),
        canonicalHash(output),
        this.clock(),
      );
      const hash = slipHash(body);
      const sellerSig = await this.cfg.signer.signTypedData(slipTypedData(body));
      const result: RunnerToHub = { t: "result", jobId: order.jobId, output, slip: { body, hash, sellerSig } };
      const text = JSON.stringify(result);
      if (new TextEncoder().encode(text).byteLength > MAX_RESULT_BYTES) return refuse(REFUSED.tooLarge);
      if (target.readyState !== this.Socket.OPEN) return refuse(REFUSED.late);
      target.send(text);
      this.cfg.onJob?.({ kind: "delivered", order, output, slip: { body, hash, sellerSig } });
    } finally {
      clearTimeout(timer);
      this.inFlight.delete(order.jobId);
      if (this.redialWhenIdle && this.inFlight.size === 0) this.refresh();
    }
  }

  private send(target: WebSocket, frame: RunnerToHub): void {
    if (target.readyState === this.Socket.OPEN) target.send(JSON.stringify(frame));
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer !== null) return;
    if (this.cfg.skills().length === 0) {
      this.setStatus({ phase: "off", accepted: [] });
      return;
    }
    const seconds = RETRY_SECONDS[Math.min(this.attempt, RETRY_SECONDS.length - 1)] ?? 30;
    this.attempt += 1;
    const retryAt = Date.now() + seconds * 1000;
    const next: LinkStatus = { phase: "waiting", accepted: [], retryAt };
    if (this.current.refusal !== undefined) next.refusal = this.current.refusal;
    this.setStatus(next);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.dial();
    }, seconds * 1000);
  }

  private startWatchdog(target: WebSocket): void {
    this.stopWatchdog();
    this.watchdog = setInterval(() => {
      if (this.socket !== target) return;
      if (Date.now() - this.lastFrameAt > SILENCE_MS) {
        try {
          target.close(4000, "silent hub");
        } catch {
          // A socket that never opened cannot be closed; the close handler still runs.
        }
      }
    }, 10_000);
  }

  private stopWatchdog(): void {
    if (this.watchdog !== null) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private closeSocket(): void {
    const target = this.socket;
    this.socket = null;
    this.stopWatchdog();
    this.abortAll();
    if (target === null) return;
    try {
      target.close(1000, "phone");
    } catch {
      // Closing a socket that never opened is not an error here.
    }
  }

  private abortAll(): void {
    for (const controller of this.inFlight.values()) controller.abort();
  }

  private setStatus(next: LinkStatus): void {
    this.current = next;
    this.cfg.onStatus?.(next);
  }
}

/** ws(s)://<hub>/runner/connect. A relative hub URL resolves against the page. */
export function runnerUrl(hubUrl: string): string {
  const base = typeof location === "undefined" ? undefined : location.href;
  const url = new URL(hubUrl, base);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${RUNNER_PATH}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function plainReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.startsWith("Refused.") ? text : `Refused. ${text}`;
}
