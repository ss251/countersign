import { useCallback, useEffect, useRef, useState } from "react";
import * as fx from "../fixtures/index.ts";
import type { Approval, Envelope, Money, Offer, Purchase, Slip, TreeNode } from "./types.ts";

/**
 * Every read the screens make goes through here. Until a hub endpoint exists the
 * answer comes from src/fixtures and says so (source: "fixtures"), so a screen
 * can never pass stand-in numbers off as live ones.
 */

export type Source = "hub" | "fixtures";

export interface Loaded<T> {
  data: T;
  source: Source;
}

const settle = <T,>(data: T, ms = 120): Promise<Loaded<T>> =>
  new Promise((resolve) => window.setTimeout(() => resolve({ data, source: "fixtures" }), ms));

export const api = {
  offers: () => settle(fx.offers),
  offer: (id: string) => settle<Offer | undefined>(fx.offerById(id)),
  envelope: () => settle<Envelope>(structuredClone(fx.envelope)),
  approvals: () => settle<Approval[]>(fx.approvals),
  history: () => settle<Purchase[]>(fx.history),
  slip: (id: string) => settle<Slip | undefined>(fx.slipById(id)),
  tree: (_root: string) => settle<TreeNode>(fx.tree),
};

/* A job as the phone sees it after the hold. */

export type JobStep = "countersigned" | "funding" | "held" | "delivered" | "released" | "refused" | "refunded";

export interface JobView {
  step: JobStep;
  times: Partial<Record<JobStep, string>>;
  fundTx?: string;
  slipId?: string;
  /** For a refusal: what the seller tried to settle at. */
  asked?: Money;
  deadline?: string;
}

export type Scenario = "release" | "moved" | "deadline";

/**
 * Plays a job forward with fixture timings. The hub replaces this with the job's
 * real events; the screens only ever see JobView.
 */
export function playJob(approval: Approval, scenario: Scenario, onChange: (job: JobView) => void): () => void {
  const timers: number[] = [];
  const now = () => new Date().toISOString();
  let job: JobView = { step: "countersigned", times: { countersigned: now() } };
  const push = (patch: Partial<JobView>, step: JobStep) => {
    job = { ...job, ...patch, step, times: { ...job.times, [step]: now() } };
    onChange(job);
  };
  onChange(job);
  const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
  const deadline = new Date(Date.now() + approval.offer.deadlineSeconds * 1000).toISOString();

  if (scenario === "moved") {
    const asked = { ...approval.amount, amount: ((BigInt(approval.amount.amount) * 6n) / 5n).toString() };
    at(700, () => push({}, "funding"));
    at(1900, () => push({ asked }, "refused"));
  } else {
    at(700, () => push({}, "funding"));
    at(1700, () => push({ fundTx: fx.fakeHex(`fund:${approval.id}`), deadline }, "held"));
    if (scenario === "release") {
      at(3300, () => push({}, "delivered"));
      at(4300, () => push({ slipId: "slip-4" }, "released"));
    } else {
      at(4300, () => push({}, "refunded"));
    }
  }
  return () => timers.forEach((t) => window.clearTimeout(t));
}

/* Loading state for one read. */

export interface Resource<T> {
  data: T | undefined;
  source: Source | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
  set: (next: T) => void;
}

export function useResource<T>(load: () => Promise<Loaded<T>>, deps: unknown[]): Resource<T> {
  const [state, setState] = useState<{ data?: T; source?: Source; error?: Error; loading: boolean }>({ loading: true });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    loadRef.current().then(
      (r) => live && setState({ data: r.data, source: r.source, loading: false }),
      (e: unknown) => live && setState({ loading: false, error: e instanceof Error ? e : new Error(String(e)) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const set = useCallback((next: T) => setState((s) => ({ ...s, data: next })), []);
  return { ...state, data: state.data, source: state.source, error: state.error, loading: state.loading, reload, set };
}
