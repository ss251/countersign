import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Address } from "viem";
import { createHub } from "./app.ts";
import { sepoliaEnsResolver } from "./deps.ts";
import { erc8004IdentityLookup } from "./identity.ts";

/** The official ERC-8004 IdentityRegistry on Arc testnet. */
const ARC_ERC8004_IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
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

// Forward ENS lookups on Sepolia; HUB_ENS_RPC_URL overrides viem's public Sepolia endpoint.
const ens = sepoliaEnsResolver(process.env.HUB_ENS_RPC_URL ? { rpcUrl: process.env.HUB_ENS_RPC_URL } : {});

// The human's approver token guards approval decisions and the envelope and approval reads. Unset, the
// decision route answers 503 no-approver: a held call can then be approved only on the agent's machine.
const humanApprovalToken = process.env.HUMAN_APPROVAL_TOKEN?.trim() || undefined;

// The Whitechain relay's public order records, read by /orders for refunds after release.
const relayUrl = process.env.WC_RELAY_URL?.trim() || undefined;

// ERC-8004 identities on Arc testnet, shown on /sellers. The registry is shared and large, so the hub
// reads its Registered logs only from ERC8004_FROM_BLOCK on; unset, /sellers reports erc8004 as null.
const erc8004From = process.env.ERC8004_FROM_BLOCK?.trim() ?? "";
const arcRpcUrl = process.env.ARC_RPC_URL?.trim() ?? "";
const identity =
  /^\d+$/.test(erc8004From) && arcRpcUrl !== ""
    ? erc8004IdentityLookup({
        rpcUrl: arcRpcUrl,
        registry: (process.env.ERC8004_IDENTITY?.trim() || ARC_ERC8004_IDENTITY) as Address,
        fromBlock: BigInt(erc8004From),
      })
    : undefined;

const { app, websocket } = createHub({
  store,
  rails,
  now,
  publicUrl,
  ens,
  ...(humanApprovalToken !== undefined ? { humanApprovalToken } : {}),
  ...(relayUrl !== undefined ? { relayUrl } : {}),
  ...(identity !== undefined ? { identity } : {}),
});

const server = Bun.serve({ port, fetch: app.fetch, websocket });
setInterval(() => {
  void runJanitor({ store, rails, now });
}, 30_000);

console.log(`[hub] listening on ${server.url} rails: ${rails.map((r) => r.declaration.id).join(", ") || "none"}`);
