import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Address } from "viem";
import { createHub } from "./app.ts";
import { runCanary } from "./canary.ts";
import { CliAuthStore } from "./cli-auth/store.ts";
import { rpcUrlsFrom, sepoliaEnsResolver } from "./deps.ts";
import { erc8004IdentityLookup } from "./identity.ts";
import { createPrivyVerifier } from "./privy.ts";
import { privyWalletApi } from "./wallets/privy-wallets.ts";

/** The official ERC-8004 IdentityRegistry on Arc testnet. */
const ARC_ERC8004_IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
import { runJanitor } from "./janitor.ts";
import { assertBootable, BootRefused } from "./network.ts";
import { railsFromEnv } from "./rails.ts";
import { Store } from "./store.ts";

// Fail closed before anything else: an unknown network, or a mainnet with anything pending, stops here.
try {
  assertBootable(process.env);
} catch (error) {
  if (!(error instanceof BootRefused)) throw error;
  console.error("[hub] refused to boot:");
  for (const problem of error.problems) console.error(`[hub]   - ${problem}`);
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.HUB_DB ?? "data/hub.sqlite";
if (dbPath !== ":memory:") mkdirSync(dirname(resolve(dbPath)), { recursive: true });

const store = new Store(dbPath);
const rails = await railsFromEnv(process.env);
const publicUrl = process.env.HUB_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const now = (): number => Math.floor(Date.now() / 1000);

// Forward ENS lookups on Sepolia. Every endpoint in HUB_ENS_RPC_URLS (comma-separated; HUB_ENS_RPC_URL
// for one) must agree, or the lookup fails and a named offer is refused. Unset: two public endpoints.
const ensRpcUrls = rpcUrlsFrom(process.env.HUB_ENS_RPC_URLS ?? process.env.HUB_ENS_RPC_URL);
const ens = sepoliaEnsResolver(ensRpcUrls ? { rpcUrls: ensRpcUrls } : {});

// The human's approver token guards approval decisions and the envelope and approval reads. Unset, the
// decision route answers 503 no-approver: a held call can then be approved only on the agent's machine.
const humanApprovalToken = process.env.HUMAN_APPROVAL_TOKEN?.trim() || undefined;

// Privy checks the signed-in person on the routes that act for them. Unset, the Privy header is ignored.
const privyAppId = process.env.PRIVY_APP_ID?.trim() ?? "";
const privySecret = process.env.PRIVY_APP_SECRET?.trim() ?? "";
const privy = privyAppId !== "" && privySecret !== "" ? createPrivyVerifier(privyAppId, privySecret) : undefined;

// The CLI signs through the hub's Privy server wallets when the same app credentials are set.
const cliAuth =
  privyAppId !== "" && privySecret !== ""
    ? {
        store: new CliAuthStore(
          process.env.HUB_CLI_DB ??
            (dbPath === ":memory:" ? ":memory:" : join(dirname(resolve(dbPath)), "cli-auth.sqlite")),
        ),
        wallets: privyWalletApi(privyAppId, privySecret, {
          policyId: process.env.PRIVY_WALLET_POLICY_ID,
        }),
        consoleUrl: process.env.CONSOLE_URL ?? "https://web-production-a58de.up.railway.app",
      }
    : undefined;

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
        persist: {
          get: (seller) => store.getIdentity(seller),
          put: (seller, value) => store.putIdentity(seller, value, now()),
        },
      })
    : undefined;

// The full commit this image was built from: deploy-hub.sh writes COMMIT into the stage.
const commitFromFile = ((): string | undefined => {
  try {
    return readFileSync(resolve(process.cwd(), "COMMIT"), "utf8").trim();
  } catch {
    return undefined;
  }
})();
const commitCandidate = process.env.HUB_COMMIT?.trim() || commitFromFile;
const commit =
  commitCandidate !== undefined && /^[0-9a-f]{40}$/.test(commitCandidate) ? commitCandidate : undefined;
console.log(`[hub] commit ${commit ? commit.slice(0, 7) : "unknown"}`);

const { app, websocket, runners } = createHub({
  store,
  rails,
  now,
  publicUrl,
  ens,
  ...(humanApprovalToken !== undefined ? { humanApprovalToken } : {}),
  ...(privy ? { privy } : {}),
  ...(cliAuth ? { cliAuth } : {}),
  ...(relayUrl !== undefined ? { relayUrl } : {}),
  ...(identity !== undefined ? { identity } : {}),
  ...(commit ? { commit } : {}),
});

const server = Bun.serve({ port, fetch: app.fetch, websocket });
setInterval(() => {
  void runJanitor({ store, rails, now });
}, 30_000);

const canaryMode = process.env.CANARY === "1" ? "delist" : process.env.CANARY === "report" ? "report" : "off";
console.log(`[hub] canary: ${canaryMode}`);
if (canaryMode !== "off") {
  const everyMs = Number(process.env.CANARY_INTERVAL_S ?? 300) * 1000;
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void runCanary({ store, runners, now, report: canaryMode === "report", log: (line) => console.log(line) }).finally(() => {
      running = false;
    });
  }, everyMs);
}

console.log(`[hub] listening on ${server.url} rails: ${rails.map((r) => r.declaration.id).join(", ") || "none"}`);
console.log(`[hub] privy sign-in: ${privy === undefined ? "off" : "on"}`);
