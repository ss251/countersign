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

const { app, websocket } = createHub({ store, rails, now, publicUrl, relayUrl: process.env.WC_RELAY_URL });

const server = Bun.serve({ port, fetch: app.fetch, websocket });
setInterval(() => {
  void runJanitor({ store, rails, now });
}, 30_000);

console.log(`[hub] listening on ${server.url} rails: ${rails.map((r) => r.declaration.id).join(", ") || "none"}`);
