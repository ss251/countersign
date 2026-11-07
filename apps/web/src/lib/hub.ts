import type { Offer, RailDeclaration, Slip } from "./types.ts";

/**
 * The hub. Live is the default: the build names the production hub in VITE_HUB_URL. "?hub=<url>"
 * after any route remembers another hub, "?hub=local" means this server's /hub proxy, "?hub=off"
 * is the one way to the labelled fixtures, and "?hub=default" forgets any choice. A hub that does
 * not answer, or does not serve a read yet, is shown as exactly that, never papered over.
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

export const FOREIGN_HUB = "Sign-in works only with this console's own hub; paste a token for another hub.";

export function hubBase(): string | null {
  try {
    const hash = window.location.hash;
    const q = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : window.location.search);
    const asked = q.get("hub");
    if (asked !== null) {
      if (asked === "" || asked === "default") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, asked === "local" ? "/hub" : asked === "off" ? "off" : asked.replace(/\/+$/, ""));
    }
    const chosen = window.localStorage.getItem(KEY) ?? import.meta.env.VITE_HUB_URL ?? null;
    return chosen === "off" ? null : chosen;
  } catch {
    return import.meta.env.VITE_HUB_URL ?? null;
  }
}

/** True only when this page talks to the hub the console was built for, not one a link chose. */
export function isOwnHub(): boolean {
  const own = import.meta.env.VITE_HUB_URL;
  if (typeof own !== "string" || own.length === 0) return false;
  const base = hubBase();
  return base !== null && base.replace(/\/+$/, "") === own.replace(/\/+$/, "");
}

/** The Privy access token may not leave for a hub this console was not built for. */
function carriesPrivyToken(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === "x-privy-token");
}

export async function hubGet<T>(path: string, timeoutMs = 5000, headers: Record<string, string> = {}): Promise<T> {
  if (carriesPrivyToken(headers) && !isOwnHub()) throw new HubError(403, FOREIGN_HUB, "foreign-hub");
  const base = hubBase();
  if (!base) throw new HubError(0, "No hub is chosen.");
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { signal: controller.signal, headers: { accept: "application/json", ...headers } });
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

/** The wallet the person signed in with on this page, not one this device remembered. */
let signedIn: string | null = null;

/** Follow the wallet the person signed in with; anything that is not an address signs it out. */
export function setSignedInAgent(address: string | null): void {
  signedIn = address && /^0x[0-9a-fA-F]{40}$/.test(address) ? address : null;
}

export function signedInAgent(): string | null {
  return signedIn;
}

/** The agent named in this page's own URL (?agent=), never the one this device remembered. */
export function linkAgent(): string | null {
  try {
    const hash = window.location.hash;
    const fromHash = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");
    const asked = fromHash.get("agent") ?? new URLSearchParams(window.location.search).get("agent");
    return asked && /^0x[0-9a-fA-F]{40}$/.test(asked) ? asked : null;
  } catch {
    return null;
  }
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

/** Follow this agent from now on, as ?agent= does: the envelope the person just created. */
export function rememberAgent(agent: string): void {
  try {
    if (/^0x[0-9a-fA-F]{40}$/.test(agent)) window.localStorage.setItem(AGENT_KEY, agent);
  } catch {
    // Private mode: nothing was kept.
  }
}

/** The hub a link chose on this device; null when none was stored and the build's default applies. */
export function chosenHub(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Forget the agent and hub links chose, so the console follows this hub's defaults again. */
export function forgetChoices(): void {
  try {
    window.localStorage.removeItem(AGENT_KEY);
    window.localStorage.removeItem(KEY);
  } catch {
    // Private mode: nothing was kept.
  }
}

/**
 * The human's approval token, kept on this device only, with the hub it was saved on (cs-audit 01:14:58Z).
 * It is handed out only while this page talks to that hub, so a link that chose another hub (?hub=) never
 * carries it there: not on a read, and not with a decision. A token saved before the hub was recorded
 * belongs to the hub this console was built for.
 */
const TOKEN_KEY = "countersign.approval-token";
const TOKEN_HUB_KEY = "countersign.approval-token-hub";

function sameHub(a: string | null | undefined, b: string | null): boolean {
  if (typeof a !== "string" || a.length === 0 || b === null) return false;
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

export function approvalToken(): string | null {
  try {
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (token === null) return null;
    const savedOn = window.localStorage.getItem(TOKEN_HUB_KEY) ?? import.meta.env.VITE_HUB_URL;
    return sameHub(savedOn, hubBase()) ? token : null;
  } catch {
    return null;
  }
}
export function rememberApprovalToken(token: string | null): void {
  try {
    const base = hubBase();
    if (token && base) {
      window.localStorage.setItem(TOKEN_KEY, token);
      window.localStorage.setItem(TOKEN_HUB_KEY, base);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(TOKEN_HUB_KEY);
    }
  } catch {
    // Private mode: the token lives for this page only.
  }
}

export async function hubPost<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  if (carriesPrivyToken(headers) && !isOwnHub()) throw new HubError(403, FOREIGN_HUB, "foreign-hub");
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
