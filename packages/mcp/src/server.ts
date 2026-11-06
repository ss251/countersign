import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Hex } from "viem";
import type { LocalAccount } from "viem/accounts";
import {
  canonicalHash,
  formatUnits,
  RAIL_IDS,
  type Offer,
  type RailId,
  type Slip,
} from "@countersign/core";
import {
  KNOWN_RAILS,
  buy,
  countersignPayer,
  eip3009Payer,
  gatewayPayer,
  type HubClient,
  type Journal,
  type State,
} from "@countersign/buyer";
import { verifySlip } from "@countersign/verify";

export interface McpDeps {
  hub: HubClient;
  state: State;
  journal: Journal;
  account?: LocalAccount;
  /** Unix seconds. Defaults to the wall clock. */
  now?: () => number;
  /** The RPC verify_slip reads the chain from. Without it, the on-chain check is skipped. */
  rpcUrl?: string;
  verify?: typeof verifySlip;
  /** The hub's base URL, used to fetch /slips/<hash>. */
  hubUrl: string;
}

const HASH_MISMATCH = "Refused. The hub served an offer that does not match the hash asked for.";
const NO_KEY = "Set CS_BUYER_KEY to the agent's private key.";
const HASH = /^0x[0-9a-fA-F]{64}$/;

function assertHash(value: string, what: string): void {
  if (!HASH.test(value)) throw new Error(`Refused. ${what} must be 0x followed by 64 hex characters.`);
}

/** JSON text for the protocol. Bigints travel as decimal strings. */
function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString(10) : item), 2);
}

function text(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: json(value) }] };
}

function failure(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: message }] };
}

function searchText(offer: Offer): string {
  const description = (offer as { description?: unknown }).description;
  return [
    offer.title,
    offer.summary,
    typeof description === "string" ? description : "",
    offer.adapter,
    offer.rails.join(" "),
  ]
    .join("\n")
    .toLowerCase();
}

export function createCountersignMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "countersign", version: "0.1.0" });
  const clock = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const verify = deps.verify ?? verifySlip;

  const loadSlip = async (hash: string): Promise<Slip> => {
    if (existsSync(deps.state.slipPath(hash))) return deps.state.loadSlip(hash);
    const base = deps.hubUrl.replace(/\/+$/, "");
    const response = await fetch(`${base}/slips/${hash}`);
    if (!response.ok) throw new Error(`The hub answered ${response.status} for /slips/${hash}.`);
    return (await response.json()) as Slip;
  };

  server.registerTool(
    "search_offers",
    {
      title: "Search offers",
      description:
        "List countersign offers for sale. A query filters on title, description, adapter and rails, case-insensitively.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().optional(),
      },
    },
    async ({ query, limit }) => {
      try {
        const listings = await deps.hub.listOffers();
        const needle = query?.toLowerCase();
        const matching =
          needle === undefined ? listings : listings.filter((entry) => searchText(entry.offer).includes(needle));
        const count = Math.min(Math.max(limit ?? 20, 0), 100);
        return text(
          matching.slice(0, count).map((entry) => {
            let priceUsdc: string | null;
            try {
              priceUsdc = formatUnits(BigInt(entry.offer.price), 6);
            } catch {
              priceUsdc = null;
            }
            return {
              offerHash: entry.offerHash,
              title: entry.offer.title,
              price: entry.offer.price,
              priceUsdc,
              rails: entry.offer.rails,
              online: entry.online,
              status: entry.status,
              seller: entry.offer.seller,
            };
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_offer",
    {
      title: "Get an offer",
      description: "Read one signed offer by its hash: terms, schemas, rails and payee.",
      inputSchema: {
        offerHash: z.string(),
      },
    },
    async ({ offerHash }) => {
      try {
        assertHash(offerHash, "offerHash");
        const listing = await deps.hub.getOffer(offerHash);
        if (canonicalHash(listing.offer).toLowerCase() !== offerHash.toLowerCase()) throw new Error(HASH_MISMATCH);
        return text({
          offerHash,
          online: listing.online,
          status: listing.status,
          offer: listing.offer,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "buy",
    {
      title: "Buy an offer",
      description:
        "Buy an offer under the agent's envelope and return the seller's output and slip. Requires CS_BUYER_KEY.",
      inputSchema: {
        offerHash: z.string(),
        input: z.unknown(),
        rail: z.string().optional(),
      },
    },
    async ({ offerHash, input, rail }) => {
      const account = deps.account;
      if (account === undefined) return failure(new Error(NO_KEY));
      if (rail !== undefined && !RAIL_IDS.includes(rail as RailId)) {
        return failure(new Error(`Unknown rail ${rail}.`));
      }
      try {
        assertHash(offerHash, "offerHash");
        const result = await buy({
          hub: deps.hub,
          offerHash: offerHash as Hex,
          input,
          payers: [countersignPayer(account), gatewayPayer(account), eip3009Payer(account)],
          envelope: deps.state.loadEnvelope(),
          journal: deps.journal,
          state: deps.state,
          now: clock(),
          approve: false,
          known: [...KNOWN_RAILS, ...deps.state.loadRails()],
          account,
          mirror: false,
          ...(rail !== undefined ? { rail: rail as RailId } : {}),
        });
        const slip = result.slip;
        return text({
          output: result.output,
          slipHash: slip.hash,
          releaseTx: slip.settlement.transaction,
          explorer: slip.settlement.url ?? null,
          slip,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "verify_slip",
    {
      title: "Verify a slip",
      description: "Verify a slip object, or a slip hash read from local state or the hub.",
      inputSchema: {
        slip: z.record(z.string(), z.unknown()).optional(),
        slipHash: z.string().optional(),
      },
    },
    async ({ slip, slipHash }) => {
      if ((slip === undefined) === (slipHash === undefined)) {
        return failure(new Error("Pass exactly one of slip or slipHash."));
      }
      try {
        if (slipHash !== undefined) assertHash(slipHash, "slipHash");
        const value = slip !== undefined ? (slip as unknown as Slip) : await loadSlip(slipHash as string);
        return text(await verify(value, { rpcUrl: deps.rpcUrl }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "envelope_show",
    {
      title: "Show the envelope",
      description: "Read the agent's envelope and what the journal says it has spent.",
      inputSchema: {},
    },
    async () => {
      try {
        return text({ envelope: deps.state.loadEnvelope(), spent: deps.journal.spend() });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "journal",
    {
      title: "Read the journal",
      description: "Read the most recent journal entries, newest last.",
      inputSchema: {
        limit: z.number().int().optional(),
      },
    },
    async ({ limit }) => {
      try {
        const entries = deps.journal.entries();
        const count = limit ?? 20;
        return text(count <= 0 ? [] : entries.slice(-count));
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
