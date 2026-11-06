/**
 * The phone runner as one object the screen subscribes to: the seller key, the two skills and
 * what the person has turned on, the link to the hub, the photo requests waiting for a tap, and
 * the jobs this phone has served with what the hub did with each.
 */

import type { Address, Hex } from "viem";
import type { Offer } from "@countersign/core";
import { KNOWN_ESCROWS } from "@countersign/verify";
import { kvGet, kvSet, sellerKey, stableIssuedAt } from "../device/vault.ts";
import { fundingRefusal, rpcJobReader } from "../runner/funding.ts";
import { locationSupported, readFix } from "../device/location.ts";
import { shrinkPhoto } from "../device/photo.ts";
import { publishOffer, readJob, readSlip } from "../runner/hub.ts";
import {
  JobRefusal,
  RunnerLink,
  type JobUpdate,
  type LinkStatus,
  type PhoneJob,
  type PhoneSigner,
  type ServedSkill,
} from "../runner/link.ts";
import { signerFromKey } from "../runner/signer.ts";
import {
  locationOutput,
  offerFor,
  photoOutput,
  SKILL_IDS,
  termsKey,
  type LocationOutput,
  type SkillId,
} from "../runner/skills.ts";

export interface SkillState {
  id: SkillId;
  on: boolean;
  /** What the phone is doing for this switch right now. */
  step: "asking" | "publishing" | null;
  /** The offer hash on this hub, once published. */
  hash: Hex | null;
  /** A plain line after turning it on, like the accuracy the phone found. */
  note: string | null;
  /** Why it could not be turned on, in the browser's or the hub's words. */
  refusal: string | null;
}

export type JobOutcome = "working" | "delivered" | "refused";

export interface JobRecord {
  jobId: Hex;
  skill: SkillId;
  /** Atomic USDC. */
  amount: string;
  /** Unix seconds when the job reached the phone. */
  at: number;
  outcome: JobOutcome;
  reason?: string;
  ask?: string;
  slipHash?: Hex;
  outputHash?: Hex;
  location?: LocationOutput;
  photo?: { sha256: string; bytes: number; width: number; height: number; thumb?: string };
  /** What the hub reports after delivery: released, failed, refunded. */
  hub?: { status: string; closeTx: string | null; url?: string };
}

export interface PhotoAsk {
  jobId: Hex;
  prompt: string | null;
  amount: string;
  waitUntil: number;
  stage: "asking" | "preparing";
  problem: string | null;
}

export interface PhoneState {
  phase: "loading" | "ready" | "broken";
  problem: string | null;
  seller: Address | null;
  madeAt: number | null;
  hubUrl: string;
  consoleUrl: string;
  link: LinkStatus;
  skills: Record<SkillId, SkillState>;
  asks: PhotoAsk[];
  jobs: JobRecord[];
  awake: "on" | "off" | "unsupported";
}

const JOBS_KEY = "jobs";
const KEEP_JOBS = 12;

export const DECLINED = "Refused. The phone's owner declined.";
export const NOBODY = "Refused. Nobody took the photo before the hub stopped waiting.";

function seconds(): number {
  return Math.floor(Date.now() / 1000);
}

export class Phone {
  private state: PhoneState;
  private readonly listeners = new Set<() => void>();
  private signer: PhoneSigner | null = null;
  private link: RunnerLink | null = null;
  private readonly offers = new Map<SkillId, { offer: Offer; hash: Hex }>();
  private readonly waiting = new Map<Hex, { resolve(output: unknown): void; reject(error: Error): void }>();
  private readonly thumbs = new Map<Hex, string>();
  private lock: WakeLockSentinel | null = null;

  constructor(hubUrl: string, consoleUrl: string) {
    const skills = Object.fromEntries(
      SKILL_IDS.map((id) => [id, { id, on: false, step: null, hash: null, note: null, refusal: null }]),
    ) as Record<SkillId, SkillState>;
    this.state = {
      phase: "loading",
      problem: null,
      seller: null,
      madeAt: null,
      hubUrl,
      consoleUrl,
      link: { phase: "off", accepted: [] },
      skills,
      asks: [],
      jobs: [],
      awake: typeof navigator !== "undefined" && "wakeLock" in navigator ? "off" : "unsupported",
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PhoneState => this.state;

  private set(patch: Partial<PhoneState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private setSkill(id: SkillId, patch: Partial<SkillState>): void {
    this.set({ skills: { ...this.state.skills, [id]: { ...this.state.skills[id], ...patch } } });
  }

  async boot(): Promise<void> {
    if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
      this.set({
        phase: "broken",
        problem: "Open this page over https. Browsers keep location, the camera and signing keys away from plain http pages.",
      });
      return;
    }
    try {
      const record = await sellerKey();
      this.signer = signerFromKey(record.key);
      const jobs = (await kvGet<JobRecord[]>(JOBS_KEY)) ?? [];
      this.set({ phase: "ready", seller: this.signer.address, madeAt: record.madeAt, jobs });
    } catch (error) {
      this.set({ phase: "broken", problem: messageOf(error, "This browser would not keep a key for this page.") });
      return;
    }

    const seller = this.signer.address;
    const readJob = rpcJobReader();
    this.link = new RunnerLink({
      hubUrl: this.state.hubUrl,
      signer: this.signer,
      // Read the escrow on Arc before anything is captured: a hub cannot get work for a job nobody paid.
      checkOrder: (order, offer) => fundingRefusal(order, offer, { seller, now: seconds(), known: KNOWN_ESCROWS, read: readJob }),
      skills: () => this.served(),
      onStatus: (link) => this.set({ link }),
      onJob: (update) => this.onJob(update),
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      this.link?.wake();
      void this.keepAwake();
    });
    window.addEventListener("online", () => this.link?.wake());
  }

  /** The person flipped a switch. Turning on asks the browser first, then publishes the offer. */
  async toggle(id: SkillId): Promise<void> {
    const skill = this.state.skills[id];
    if (skill.step !== null || this.signer === null) return;
    if (skill.on) {
      this.setSkill(id, { on: false, note: null });
      if (id === "phone-photo") for (const ask of this.state.asks) this.decline(ask.jobId, DECLINED);
      this.link?.refresh();
      void this.keepAwake();
      return;
    }

    // Ask for the wake lock while the tap still counts as a user gesture.
    void this.keepAwake(true);
    this.setSkill(id, { refusal: null, note: null });
    try {
      if (id === "phone-location") {
        if (!locationSupported()) throw new Error("This browser has no location.");
        this.setSkill(id, { step: "asking" });
        const fix = await readFix();
        this.setSkill(id, { note: `Found this phone to within ${Math.ceil(fix.accuracy)} m.` });
      }
      this.setSkill(id, { step: "publishing" });
      const published = await this.publish(id);
      this.setSkill(id, { on: true, step: null, hash: published.hash });
      this.link?.refresh();
      this.link?.start();
    } catch (error) {
      this.setSkill(id, { on: false, step: null, refusal: messageOf(error, "It could not be turned on.") });
      void this.keepAwake();
    }
  }

  private async publish(id: SkillId): Promise<{ offer: Offer; hash: Hex }> {
    if (this.signer === null) throw new Error("No seller key yet.");
    const known = this.offers.get(id);
    if (known) {
      // Publishing again is free, and it brings the offer back on a hub that restarted empty.
      await publishOffer(this.state.hubUrl, this.signer, known.offer);
      return known;
    }
    const issuedAt = await stableIssuedAt(termsKey(id, this.signer.address), seconds());
    const offer = offerFor(id, this.signer.address, issuedAt);
    const hash = await publishOffer(this.state.hubUrl, this.signer, offer);
    const entry = { offer, hash };
    this.offers.set(id, entry);
    return entry;
  }

  private served(): ServedSkill[] {
    const out: ServedSkill[] = [];
    for (const id of SKILL_IDS) {
      const entry = this.offers.get(id);
      if (!this.state.skills[id].on || !entry) continue;
      out.push({
        offer: entry.offer,
        hash: entry.hash,
        serve: id === "phone-location" ? (job) => this.serveLocation(job) : (job) => this.servePhoto(job),
      });
    }
    return out;
  }

  private async serveLocation(job: PhoneJob): Promise<LocationOutput> {
    try {
      return locationOutput(await readFix(job.signal, 12_000));
    } catch (error) {
      throw new JobRefusal(`Refused. ${messageOf(error, "This phone could not find its position.")}`);
    }
  }

  private servePhoto(job: PhoneJob): Promise<unknown> {
    const input = (job.order.input ?? {}) as { prompt?: unknown };
    const ask: PhotoAsk = {
      jobId: job.order.jobId,
      prompt: typeof input.prompt === "string" && input.prompt.trim() ? input.prompt.trim() : null,
      amount: job.order.amount,
      waitUntil: job.waitUntil,
      stage: "asking",
      problem: null,
    };
    this.set({ asks: [...this.state.asks, ask] });
    try {
      navigator.vibrate?.([60, 40, 60]);
    } catch {
      // Vibration is a courtesy; some browsers refuse it without a recent tap.
    }
    return new Promise((resolve, reject) => {
      const done = (): void => {
        this.waiting.delete(job.order.jobId);
        this.set({ asks: this.state.asks.filter((a) => a.jobId !== job.order.jobId) });
      };
      this.waiting.set(job.order.jobId, {
        resolve: (output) => {
          done();
          resolve(output);
        },
        reject: (error) => {
          done();
          reject(error);
        },
      });
      job.signal.addEventListener("abort", () => this.decline(job.order.jobId, NOBODY), { once: true });
    });
  }

  /** The person picked a picture for this request. */
  async takePhoto(jobId: Hex, file: File): Promise<void> {
    const waiting = this.waiting.get(jobId);
    if (!waiting) return;
    this.updateAsk(jobId, { stage: "preparing", problem: null });
    try {
      const shrunk = await shrinkPhoto(file);
      this.thumbs.set(jobId, shrunk.thumb);
      waiting.resolve(await photoOutput(shrunk.bytes, shrunk.width, shrunk.height, seconds()));
    } catch (error) {
      // Let the person try another picture while the hub still waits.
      this.updateAsk(jobId, { stage: "asking", problem: messageOf(error, "That picture could not be used.") });
    }
  }

  decline(jobId: Hex, reason: string = DECLINED): void {
    this.waiting.get(jobId)?.reject(new JobRefusal(reason));
  }

  private updateAsk(jobId: Hex, patch: Partial<PhotoAsk>): void {
    this.set({ asks: this.state.asks.map((a) => (a.jobId === jobId ? { ...a, ...patch } : a)) });
  }

  private onJob(update: JobUpdate): void {
    if (update.kind === "started") {
      const order = update.job.order;
      const skill = this.skillOf(order.offerHash);
      if (!skill) return;
      const input = (order.input ?? {}) as { reason?: unknown; prompt?: unknown };
      const ask = typeof input.prompt === "string" ? input.prompt : typeof input.reason === "string" ? input.reason : undefined;
      const record: JobRecord = { jobId: order.jobId, skill, amount: order.amount, at: seconds(), outcome: "working" };
      if (ask) record.ask = ask;
      this.upsert(record);
      return;
    }
    if (update.kind === "refused") {
      const existing = this.state.jobs.find((j) => j.jobId === update.order.jobId);
      const skill = existing?.skill ?? this.skillOf(update.order.offerHash);
      if (!skill) return;
      this.upsert({
        ...(existing ?? { jobId: update.order.jobId, skill, amount: update.order.amount, at: seconds() }),
        outcome: "refused",
        reason: update.reason,
      });
      return;
    }
    const existing = this.state.jobs.find((j) => j.jobId === update.order.jobId);
    const skill = existing?.skill ?? this.skillOf(update.order.offerHash);
    if (!skill) return;
    const record: JobRecord = {
      ...(existing ?? { jobId: update.order.jobId, skill, amount: update.order.amount, at: seconds() }),
      outcome: "delivered",
      slipHash: update.slip.hash,
      outputHash: update.slip.body.outputHash,
    };
    const output = update.output as Record<string, unknown>;
    if (skill === "phone-location") record.location = output as unknown as LocationOutput;
    if (skill === "phone-photo") {
      const photo: NonNullable<JobRecord["photo"]> = {
        sha256: String(output.sha256),
        bytes: Number(output.bytes),
        width: Number(output.width),
        height: Number(output.height),
      };
      const thumb = this.thumbs.get(update.order.jobId);
      if (thumb) photo.thumb = thumb;
      this.thumbs.delete(update.order.jobId);
      record.photo = photo;
    }
    this.upsert(record);
    void this.follow(update.order.jobId, update.slip.hash);
  }

  /** Read the hub until it closes the job: released with its tx, or failed. */
  private async follow(jobId: Hex, slipHash: Hex): Promise<void> {
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 800 : 2_000));
      let job;
      try {
        job = await readJob(this.state.hubUrl, jobId);
      } catch {
        continue;
      }
      if (!job || job.status === "funded" || job.status === "paid") continue;
      const hub: NonNullable<JobRecord["hub"]> = { status: job.status, closeTx: job.closeTx };
      if (job.slipHash) {
        const slip = await readSlip(this.state.hubUrl, job.slipHash ?? slipHash).catch(() => null);
        if (slip?.settlement.url) hub.url = slip.settlement.url;
      }
      const existing = this.state.jobs.find((j) => j.jobId === jobId);
      if (existing) this.upsert({ ...existing, hub });
      return;
    }
  }

  private skillOf(offerHash: Hex): SkillId | null {
    for (const [id, entry] of this.offers) if (entry.hash.toLowerCase() === offerHash.toLowerCase()) return id;
    return null;
  }

  private upsert(record: JobRecord): void {
    const rest = this.state.jobs.filter((j) => j.jobId !== record.jobId);
    const jobs = [record, ...rest].sort((a, b) => b.at - a.at).slice(0, KEEP_JOBS);
    this.set({ jobs });
    void kvSet(JOBS_KEY, jobs).catch(() => undefined);
  }

  /** Keep the screen on while any skill is on: a sleeping phone drops the link. */
  private async keepAwake(gesture = false): Promise<void> {
    if (this.state.awake === "unsupported") return;
    const wanted = gesture || SKILL_IDS.some((id) => this.state.skills[id].on);
    if (!wanted) {
      await this.lock?.release().catch(() => undefined);
      this.lock = null;
      this.set({ awake: "off" });
      return;
    }
    if (this.lock && !this.lock.released) return;
    try {
      this.lock = await navigator.wakeLock.request("screen");
      this.lock.addEventListener("release", () => {
        if (this.state.awake === "on") this.set({ awake: "off" });
      });
      this.set({ awake: "on" });
    } catch {
      this.set({ awake: "off" });
    }
  }
}

function messageOf(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : "";
  return text.trim() ? text : fallback;
}
