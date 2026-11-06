import type { Address, Hex } from "viem";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  fromBase64Json,
  toBase64Json,
  type CallResult,
  type Offer,
  type PaymentPayload,
  type PaymentRequired,
  type RailId,
  type SettleResult,
  type Slip,
} from "@countersign/core";

export interface Listing {
  offerHash: Hex;
  offer: Offer;
  online: boolean;
  status: string;
}

export interface JobStatus {
  jobId: Hex;
  offerHash: Hex;
  rail: RailId;
  status: string;
  deadline: number;
  settleTx?: string | null;
  closeTx?: string | null;
  slipHash?: Hex | null;
}

export type CallOutcome =
  | { kind: "required"; required: PaymentRequired }
  | { kind: "paid"; result: CallResult; settle: SettleResult | null }
  | { kind: "error"; status: number; code: string; message: string };

export class HubClient {
  private readonly base: string;
  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? `Hub answered ${res.status} for ${path}.`);
    }
    return (await res.json()) as T;
  }

  async listOffers(): Promise<Listing[]> {
    return (await this.getJson<{ offers: Listing[] }>("/offers")).offers;
  }

  getOffer(hash: string): Promise<Listing> {
    return this.getJson<Listing>(`/offers/${hash}`);
  }

  job(jobId: string): Promise<JobStatus> {
    return this.getJson<JobStatus>(`/jobs/${jobId}`);
  }

  slip(hash: string): Promise<Slip> {
    return this.getJson<Slip>(`/slips/${hash}`);
  }

  async call(hash: string, input: unknown, payment?: PaymentPayload, lineage?: Hex[]): Promise<CallOutcome> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (payment) headers[PAYMENT_SIGNATURE_HEADER] = toBase64Json(payment);
    const res = await this.fetchImpl(`${this.base}/offers/${hash}/call`, {
      method: "POST",
      headers,
      body: JSON.stringify(lineage ? { input, lineage } : { input }),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (res.status === 402) {
      const b = body as (Partial<PaymentRequired> & { error?: string }) | null;
      if (b && typeof b.error === "string") return { kind: "error", status: 402, code: "refused", message: b.error };
      let required = b as PaymentRequired | null;
      const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
      if ((!required || !Array.isArray(required.accepts)) && header) required = fromBase64Json<PaymentRequired>(header);
      if (!required || !Array.isArray(required.accepts)) {
        return { kind: "error", status: 402, code: "bad-402", message: "The hub's 402 carried no payment terms." };
      }
      return { kind: "required", required };
    }
    if (res.ok) {
      const result = body as CallResult;
      const h = res.headers.get(PAYMENT_RESPONSE_HEADER);
      return { kind: "paid", result, settle: h ? fromBase64Json<SettleResult>(h) : null };
    }
    const e = (body ?? {}) as { code?: string; message?: string };
    return { kind: "error", status: res.status, code: e.code ?? "error", message: e.message ?? `Hub answered ${res.status}.` };
  }
}

export type { Address };
