/**
 * The Whitechain side of the product, run as the merchant runs it: the gas relay with the suite's
 * own relayer wallet, the merchant server with the merchant's key and token, a hub settling on
 * chain 1874 through that relay, and the merchant's runner selling a catalogue skill.
 */

import { join } from "node:path";
import type { Address, Hex } from "viem";
import { startHub, startSkillSeller, WHITECHAIN_DEV, type HubHandle, type SellerHandle } from "./actors.ts";
import { sameAddress, WHITECHAIN } from "./chains.ts";
import { check, equal, sameHex, type FlowCtx } from "./flow.ts";
import { freePort } from "./http.ts";
import { spawnProc, type Proc } from "./procs.ts";

export interface WhitechainStack {
  relay: { url: string; proc: Proc; address: Address };
  merchant: { url: string; proc: Proc; address: Address; token: string };
  hub: HubHandle;
  seller: SellerHandle;
}

/** The relay keeps this much WBT for itself; the budget guard keeps a margin above it. */
export const RELAY_MIN_BALANCE_WEI = 5_000_000_000_000_000n; // 0.005 WBT

export async function startWhitechainStack(ctx: FlowCtx, price: bigint): Promise<WhitechainStack> {
  const s = ctx.env.secrets;
  const redact = (t: string) => s.redact(t);
  const relayer = s.account("E2E_WC_RELAYER_KEY").address;
  const merchantAddress = s.address("WC_MERCHANT_ADDRESS");

  const relay = await ctx.step("relay up with the suite's gas wallet", async () => {
    const port = freePort();
    const proc = spawnProc({
      name: "relay",
      cmd: ["bun", "packages/relay/src/server.ts"],
      env: {
        WC_RELAYER_PRIVATE_KEY: s.key("E2E_WC_RELAYER_KEY"),
        WHITECHAIN_RPC_URL: WHITECHAIN.rpc,
        RELAY_DB: join(ctx.dir, "relay.sqlite"),
        RELAY_PORT: String(port),
        RELAY_PAYEES: merchantAddress,
        RELAY_MIN_BALANCE_WEI: RELAY_MIN_BALANCE_WEI.toString(),
      },
      log: join(ctx.dir, "relay.log"),
      redact,
    });
    ctx.defer(() => proc.stop());
    await proc.waitFor(/relay listening on \d+ as (0x[0-9a-fA-F]{40})/, 45_000);
    const url = `http://127.0.0.1:${port}`;
    const res = await ctx.http("relay status", `${url}/status`);
    equal(res.status, 200, "relay status code");
    const st = res.json as { address: string; chainId: number; payees: string[]; escrow: string; token: string };
    equal(st.chainId, WHITECHAIN.chainId, "relay chain id");
    check(sameAddress(st.address, relayer), "the relay signs with the suite's relayer wallet");
    check(st.payees.some((p) => sameAddress(p, merchantAddress)), "the relay accepts the merchant as payee");
    sameHex(st.escrow, WHITECHAIN.escrow, "relay escrow");
    sameHex(st.token, WHITECHAIN.token, "relay token");
    return { url, proc, address: relayer };
  });

  const merchant = await ctx.step("merchant server up", async () => {
    const port = freePort();
    const token = s.get("MERCHANT_TOKEN");
    const proc = spawnProc({
      name: "merchant",
      cmd: ["bun", "packages/relay/src/merchant-server.ts"],
      env: {
        WC_MERCHANT_PRIVATE_KEY: s.key("WC_MERCHANT_PRIVATE_KEY"),
        MERCHANT_TOKEN: token,
        RELAY_URL: relay.url,
        MERCHANT_PORT: String(port),
      },
      log: join(ctx.dir, "merchant.log"),
      redact,
    });
    ctx.defer(() => proc.stop());
    await proc.waitFor(/merchant listening on \d+ as (0x[0-9a-fA-F]{40})/, 30_000);
    const url = `http://127.0.0.1:${port}`;
    const me = await ctx.http("merchant me", `${url}/me`);
    equal(me.status, 200, "merchant /me status");
    check(sameAddress((me.json as { address?: string }).address, merchantAddress), "the merchant server holds the merchant's key");
    return { url, proc, address: merchantAddress, token };
  });

  const hub = await ctx.step("hub up on the Whitechain rail", async () => {
    const h = await startHub(ctx, { env: { WC_RELAY_URL: relay.url } });
    const rail = h.rails.find((r) => r.id === "whitechain");
    check(rail, `the hub declares the whitechain rail (rails: ${h.rails.map((r) => r.id).join(", ") || "none"})`);
    equal(rail.network, `eip155:${WHITECHAIN.chainId}`, "whitechain rail network");
    sameHex(rail.escrow, WHITECHAIN.escrow, "whitechain rail escrow");
    return h;
  });

  const seller = await ctx.step("merchant publishes whitechain-dev", () =>
    startSkillSeller(ctx, hub, { item: WHITECHAIN_DEV, price, deadline: 120, rails: ["whitechain"], key: "WC_MERCHANT_PRIVATE_KEY" }),
  );
  check(sameAddress(seller.seller, merchantAddress), "the seller is the merchant");
  return { relay, merchant, hub, seller };
}

export interface Order {
  id: Hex;
  kind: "exact" | "escrow";
  customer: string;
  merchant: string;
  amount: string;
  fee: string;
  refunded: string;
  refundable: string;
  status: string;
  closeKind: string | null;
  settleTx: string;
  closeTx: string | null;
  refundTxs: string[];
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function merchantOrders(ctx: FlowCtx, m: WhitechainStack["merchant"], label: string): Promise<Order[]> {
  const res = await ctx.http(label, `${m.url}/orders`, { headers: bearer(m.token) });
  equal(res.status, 200, `${label} status`);
  const orders = (res.json as { orders?: Order[] }).orders;
  check(Array.isArray(orders), `${label} lists orders`);
  return orders;
}

/** RFC 4180 rows: quoted fields may hold commas, quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}
