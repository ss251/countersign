import {
  recoverMessageAddress,
  type Address,
  type Hex,
} from "viem";
import {
  runnerAuthMessage,
  type HubToRunner,
  type JobOrder,
  type RunnerToHub,
  type Slip,
} from "./deps.ts";
import type { WSEvents, WSContext } from "hono/ws";
import type { Store } from "./store.ts";
import { isRecord, randomNonce, sameText } from "./util.ts";

export type DeliveredSlip = Pick<Slip, "body" | "hash" | "sellerSig">;

/** `byRunner` marks a failure the runner itself reported; every other failure is the hub's own. */
export type DispatchResult = { output: unknown; slip: DeliveredSlip } | { fail: string; byRunner?: true };

interface Pending {
  finish(result: DispatchResult): void;
}

interface Connection {
  ws: WSContext;
  nonce: string;
  seller: string | null;
  offers: Set<string>;
  lastPongAt: number;
  pending: Map<string, Pending>;
}

const PING_EVERY_MS = 20_000;
const PONG_DEADLINE_MS = 45_000;

export class RunnerLink {
  private readonly store: Store;
  private readonly connections = new Map<object, Connection>();
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(store: Store) {
    this.store = store;
    this.heartbeat = setInterval(() => this.tick(), PING_EVERY_MS);
    this.heartbeat.unref?.();
  }

  /** Stop the heartbeat. Tests call it after closing their server. */
  stop(): void {
    clearInterval(this.heartbeat);
    for (const conn of this.connections.values()) {
      for (const pending of conn.pending.values()) pending.finish({ fail: "closed" });
      conn.ws.close(1001, "hub stopping");
    }
    this.connections.clear();
  }

  /** Number of runners that have completed the signed hello. */
  get count(): number {
    let n = 0;
    for (const conn of this.connections.values()) if (conn.seller !== null) n += 1;
    return n;
  }

  isOnline(offerHash: string): boolean {
    for (const conn of this.connections.values()) {
      if (conn.seller !== null && conn.offers.has(offerHash)) return true;
    }
    return false;
  }

  events(): WSEvents {
    return {
      onOpen: (_event, ws) => this.open(ws),
      onMessage: (event, ws) => {
        void this.message(ws, event.data).catch(() => undefined);
      },
      onClose: (_event, ws) => this.close(ws),
      onError: (_event, ws) => this.close(ws),
    };
  }

  async dispatch(order: JobOrder, timeoutMs: number): Promise<DispatchResult> {
    const conn = this.find(order.offerHash);
    if (!conn) return { fail: "offline" };

    return new Promise<DispatchResult>((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: DispatchResult): void => {
        if (done) return;
        done = true;
        if (timer !== undefined) clearTimeout(timer);
        conn.pending.delete(order.jobId);
        resolve(result);
      };

      conn.pending.set(order.jobId, { finish });
      timer = setTimeout(() => finish({ fail: "timeout" }), Math.max(0, timeoutMs));

      const frame: HubToRunner = { t: "job", order };
      try {
        conn.ws.send(JSON.stringify(frame));
      } catch {
        finish({ fail: "closed" });
      }
    });
  }

  private key(ws: WSContext): object {
    return (ws.raw ?? ws) as object;
  }

  private open(ws: WSContext): void {
    const conn: Connection = {
      ws,
      nonce: randomNonce(),
      seller: null,
      offers: new Set(),
      lastPongAt: Date.now(),
      pending: new Map(),
    };
    this.connections.set(this.key(ws), conn);
    const challenge: HubToRunner = { t: "challenge", nonce: conn.nonce };
    ws.send(JSON.stringify(challenge));
  }

  private close(ws: WSContext): void {
    const key = this.key(ws);
    const conn = this.connections.get(key);
    if (!conn) return;
    this.connections.delete(key);
    for (const pending of conn.pending.values()) pending.finish({ fail: "closed" });
  }

  private async message(ws: WSContext, data: unknown): Promise<void> {
    const conn = this.connections.get(this.key(ws));
    if (!conn) return;

    let text: string;
    if (typeof data === "string") text = data;
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else if (ArrayBuffer.isView(data)) text = new TextDecoder().decode(data);
    else return;

    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(frame) || typeof frame.t !== "string") return;

    if (frame.t === "hello") {
      await this.hello(conn, frame as unknown as RunnerToHub);
      return;
    }
    if (frame.t === "pong") {
      conn.lastPongAt = Date.now();
      return;
    }
    if (frame.t === "result") {
      this.result(conn, frame as unknown as RunnerToHub);
      return;
    }
    if (frame.t === "fail") {
      this.fail(conn, frame as unknown as RunnerToHub);
    }
  }

  private async hello(conn: Connection, frame: RunnerToHub): Promise<void> {
    if (conn.seller !== null) return;
    if (frame.t !== "hello") return;

    const seller = frame.seller;
    const nonce = frame.nonce;
    const sig = frame.sig;
    if (
      typeof seller !== "string" ||
      typeof nonce !== "string" ||
      typeof sig !== "string" ||
      nonce !== conn.nonce
    ) {
      this.reject(conn, "Refused. The runner hello is malformed.");
      return;
    }

    let signer: Address;
    try {
      signer = await recoverMessageAddress({ message: runnerAuthMessage(nonce), signature: sig as Hex });
    } catch {
      this.reject(conn, "Refused. The runner signature does not parse.");
      return;
    }
    if (!sameText(signer, seller)) {
      this.reject(conn, "Refused. The runner signature is not the seller's.");
      return;
    }

    const claimed: string[] = Array.isArray(frame.offers)
      ? frame.offers.filter((hash) => typeof hash === "string")
      : [];
    const accepted: Hex[] = [];
    const seen = new Set<string>();
    for (const hash of claimed) {
      if (seen.has(hash)) continue;
      const stored = this.store.getOffer(hash);
      if (!stored || stored.delistedAt !== null) continue;
      if (!sameText(stored.seller, seller)) continue;
      seen.add(hash);
      accepted.push(stored.offerHash);
    }

    conn.seller = seller;
    conn.offers = new Set(accepted);
    conn.lastPongAt = Date.now();
    const ready: HubToRunner = { t: "ready", seller: seller as Address, offers: accepted };
    conn.ws.send(JSON.stringify(ready));
  }

  private result(conn: Connection, frame: RunnerToHub): void {
    if (frame.t !== "result" || typeof frame.jobId !== "string") return;
    const pending = conn.pending.get(frame.jobId);
    if (!pending) return;
    pending.finish({ output: frame.output, slip: frame.slip });
  }

  private fail(conn: Connection, frame: RunnerToHub): void {
    if (frame.t !== "fail" || typeof frame.jobId !== "string") return;
    const pending = conn.pending.get(frame.jobId);
    if (!pending) return;
    const reason = typeof frame.reason === "string" ? frame.reason : "fail";
    pending.finish({ fail: reason, byRunner: true });
  }

  private reject(conn: Connection, message: string): void {
    const frame: HubToRunner = { t: "error", message };
    try {
      conn.ws.send(JSON.stringify(frame));
    } finally {
      conn.ws.close(1008, "bad-hello");
      this.connections.delete(this.key(conn.ws));
    }
  }

  private find(offerHash: string): Connection | null {
    for (const conn of this.connections.values()) {
      if (conn.seller !== null && conn.offers.has(offerHash)) return conn;
    }
    return null;
  }

  private tick(): void {
    const now = Date.now();
    for (const [key, conn] of this.connections) {
      if (now - conn.lastPongAt > PONG_DEADLINE_MS) {
        this.connections.delete(key);
        for (const pending of conn.pending.values()) pending.finish({ fail: "pong-timeout" });
        conn.ws.close(4000, "pong timeout");
        continue;
      }
      const ping: HubToRunner = { t: "ping", ts: now };
      try {
        conn.ws.send(JSON.stringify(ping));
      } catch {
        this.connections.delete(key);
        for (const pending of conn.pending.values()) pending.finish({ fail: "closed" });
      }
    }
  }
}
