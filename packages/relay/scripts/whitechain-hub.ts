/**
 * Runs the countersign hub with the Whitechain rail, on its own port and database.
 * It is the same hub code as apps/hub. Only the rail list differs: whitechainRail wraps the
 * shared escrow rail and settles through the relay, the x402 facilitator on chain 1874,
 * so the relay pays the gas and enforces its guards.
 *
 *   RELAY_URL=http://127.0.0.1:8402 PORT=8788 HUB_DB=<path> bun run packages/relay/scripts/whitechain-hub.ts
 *
 * Holds no key: settlement and release are submitted by the relay.
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { whitechainRail } from "../../rail/src/whitechain/index.ts";
import { createHub } from "../../../apps/hub/src/app.ts";
import { runJanitor } from "../../../apps/hub/src/janitor.ts";
import { Store } from "../../../apps/hub/src/store.ts";

const port = Number(process.env.PORT ?? 8788);
const relayUrl = process.env.RELAY_URL ?? "http://127.0.0.1:8402";
const dbPath = process.env.HUB_DB ?? "data/hub-whitechain.sqlite";
if (dbPath !== ":memory:") mkdirSync(dirname(resolve(dbPath)), { recursive: true });

const store = new Store(dbPath);
const rails = [whitechainRail({ relayUrl })];
const publicUrl = process.env.HUB_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const now = (): number => Math.floor(Date.now() / 1000);

const { app, websocket } = createHub({ store, rails, now, publicUrl });
const server = Bun.serve({ port, fetch: app.fetch, websocket });
setInterval(() => {
  void runJanitor({ store, rails, now });
}, 30_000);

console.log(`[hub] listening on ${server.url} rails: whitechain (relay ${relayUrl})`);
