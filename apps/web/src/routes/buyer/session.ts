import { HubError } from "../../lib/hub.ts";

export type SessionPost = (path: string, body: unknown, headers: Record<string, string>) => Promise<unknown>;

export type SessionOutcome =
  | { kind: "created"; agent: string }
  | { kind: "signed-out" }
  | { kind: "error"; message: string };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A hub answer with both the token and the agent the envelope belongs to. */
function answerOf(value: unknown): { token: string; agent: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const answer = value as { token?: unknown; agent?: unknown };
  if (typeof answer.token !== "string" || answer.token.length === 0) return null;
  if (typeof answer.agent !== "string" || !ADDRESS.test(answer.agent)) return null;
  return { token: answer.token, agent: answer.agent };
}

/**
 * Ask the hub for this person's envelope session. Every call issues a fresh token, which replaces
 * the one on this phone; the token is only ever handed to rememberToken, never to a message.
 */
export async function createSessionEnvelope(deps: {
  post: SessionPost;
  privyToken: string;
  agent: string;
  rememberToken: (t: string) => void;
  rememberAgent: (a: string) => void;
}): Promise<SessionOutcome> {
  let value: unknown;
  try {
    value = await deps.post("/envelopes/session", { agent: deps.agent }, { "x-privy-token": deps.privyToken });
  } catch (e) {
    if (e instanceof HubError) {
      if (e.status === 401) return { kind: "signed-out" };
      if (e.status === 0) return { kind: "error", message: "The hub did not answer. Try again in a moment." };
    }
    return { kind: "error", message: "The hub could not create the envelope." };
  }

  const answer = answerOf(value);
  if (!answer) return { kind: "error", message: "The hub's answer had no token, so nothing was saved." };

  deps.rememberToken(answer.token);
  deps.rememberAgent(answer.agent);
  return { kind: "created", agent: answer.agent };
}
