import type { Offer, RailDeclaration, Slip } from "./types.ts";

/**
 * The hub, when one is chosen. Choosing is explicit: "?hub=<url>" after any route
 * remembers that hub, "?hub=local" means the /hub proxy of this server, and
 * "?hub=off" goes back to fixtures. With no hub chosen the screens read fixtures and
 * say so. A chosen hub that does not answer is shown as down, never papered over.
 */

const KEY = "countersign.hub";

export class HubError extends Error {
  override name = "HubError";
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function hubBase(): string | null {
  try {
    const hash = window.location.hash;
    const q = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : window.location.search);
    const asked = q.get("hub");
    if (asked !== null) {
      if (asked === "" || asked === "off") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, asked === "local" ? "/hub" : asked.replace(/\/+$/, ""));
    }
    return window.localStorage.getItem(KEY) ?? import.meta.env.VITE_HUB_URL ?? null;
  } catch {
    return import.meta.env.VITE_HUB_URL ?? null;
  }
}

export async function hubGet<T>(path: string, timeoutMs = 5000): Promise<T> {
  const base = hubBase();
  if (!base) throw new HubError(0, "No hub is chosen.");
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { signal: controller.signal, headers: { accept: "application/json" } });
  } catch {
    throw new HubError(0, "The hub did not answer.");
  } finally {
    window.clearTimeout(timer);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new HubError(res.status, body?.message ?? `The hub answered ${res.status}.`, body?.code);
  }
  return (await res.json()) as T;
}

/* Wire shapes, as apps/hub serves them. */

export interface HubListing {
  offerHash: `0x${string}`;
  offer: Offer;
  online: boolean;
  status: "listed" | "delisted";
}

export interface HubJob {
  jobId: `0x${string}`;
  offerHash: `0x${string}`;
  rail: string;
  status: string;
  deadline: number;
  settleTx?: string | null;
  closeTx?: string | null;
  slipHash?: `0x${string}` | null;
}

let railsCache: Promise<RailDeclaration[]> | null = null;

/** Rail declarations change only when the hub restarts, so one read per page load. */
export function hubRails(): Promise<RailDeclaration[]> {
  railsCache ??= hubGet<{ rails: RailDeclaration[] }>("/rails").then(
    (r) => r.rails,
    (e: unknown) => {
      railsCache = null;
      throw e;
    },
  );
  return railsCache;
}

/** The buyer agent the phone follows: ?agent=0x… remembers one; otherwise the hub's latest buyer. */
const AGENT_KEY = "countersign.agent";
export function chosenAgent(): string | null {
  try {
    const hash = window.location.hash;
    const q = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");
    const asked = q.get("agent");
    if (asked && /^0x[0-9a-fA-F]{40}$/.test(asked)) window.localStorage.setItem(AGENT_KEY, asked);
    return window.localStorage.getItem(AGENT_KEY);
  } catch {
    return null;
  }
}

/** The human's approval token, kept on this device only and sent only to this hub. */
const TOKEN_KEY = "countersign.approval-token";
export function approvalToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function rememberApprovalToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the token lives for this page only.
  }
}

export async function hubPost<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const base = hubBase();
  if (!base) throw new HubError(0, "No hub is chosen.");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...headers },
      body: JSON.stringify(body),
    });
  } catch {
    throw new HubError(0, "The hub did not answer.");
  }
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new HubError(res.status, b?.message ?? `The hub answered ${res.status}.`, b?.code);
  }
  return (await res.json()) as T;
}

export const hubOffers = () => hubGet<{ offers: HubListing[] }>("/offers").then((r) => r.offers);
export const hubOffer = (hash: string) => hubGet<HubListing>(`/offers/${hash}`);
export const hubSlip = (hash: string) => hubGet<Slip>(`/slips/${hash}`);
export const hubJob = (jobId: string) => hubGet<HubJob>(`/jobs/${jobId}`);
