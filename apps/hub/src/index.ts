import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHub } from "./app.ts";
import { runJanitor } from "./janitor.ts";
import { railsFromEnv } from "./rails.ts";
import { Store } from "./store.ts";

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.HUB_DB ?? "data/hub.sqlite";
if (dbPath !== ":memory:") mkdirSync(dirname(resolve(dbPath)), { recursive: true });

const store = new Store(dbPath);
const rails = await railsFromEnv(process.env);
const publicUrl = process.env.HUB_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const now = (): number => Math.floor(Date.now() / 1000);

// The human's approver token guards approval decisions and the envelope and approval reads. Unset, the
// decision route answers 503 no-approver: a held call can then be approved only on the agent's machine.
const humanApprovalToken = process.env.HUMAN_APPROVAL_TOKEN?.trim() || undefined;

// The Whitechain relay's public order records, read by /orders for refunds after release.
const relayUrl = process.env.WC_RELAY_URL?.trim() || undefined;

const { app, websocket } = createHub({
  store,
  rails,
  now,
  publicUrl,
  ...(humanApprovalToken !== undefined ? { humanApprovalToken } : {}),
  ...(relayUrl !== undefined ? { relayUrl } : {}),
});

const server = Bun.serve({ port, fetch: app.fetch, websocket });
setInterval(() => {
  void runJanitor({ store, rails, now });
}, 30_000);

console.log(`[hub] listening on ${server.url} rails: ${rails.map((r) => r.declaration.id).join(", ") || "none"}`);
