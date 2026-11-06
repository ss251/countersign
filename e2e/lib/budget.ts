/**
 * The budget guard. Before anything is spent, every paying wallet is read once. Flows run in
 * order, so each flow is checked against the balance the earlier flows will have left. A flow
 * that would take a wallet below its floor is SKIPPED (funds) and the run asks for a top-up.
 */

import type { Address } from "viem";
import { ARC, explorerAddress, gasBalance, HEDERA, tokenBalance, WHITECHAIN, type NetworkKey } from "./chains.ts";
import type { Flow, RunEnv, Spend } from "./flow.ts";
import type { Secrets } from "./secrets.ts";

export interface Wallet {
  /** Stable id, e.g. "arc.buyer.usdc". */
  id: string;
  label: string;
  network: NetworkKey;
  asset: "USDC" | "USDT" | "USDC gas" | "WBT" | "HBAR" | "pathUSD";
  address: string;
  decimals: number;
  /** One RUN-STATE line asking for a top-up, without its timestamp and session. */
  topUp(amount: string): string;
  read(): Promise<bigint>;
}

const CIRCLE_FAUCET = "https://faucet.circle.com";
const HEDERA_FAUCET = "https://portal.hedera.com/faucet";

export function wallets(s: Secrets) {
  const arc = (id: string, label: string, name: string, asset: "USDC" | "USDC gas"): Wallet => {
    const address = s.address(name);
    return {
      id,
      label,
      network: "arc",
      asset,
      address,
      decimals: asset === "USDC" ? 6 : 18,
      topUp: (amount) =>
        `NEEDS-BROWSER ${CIRCLE_FAUCET} | send Arc testnet USDC to the e2e ${label} | ${address} on Arc Testnet, ${amount} USDC | reply with the faucet tx`,
      read: () => (asset === "USDC" ? tokenBalance(ARC, address) : gasBalance(ARC, address)),
    };
  };
  const wc = (id: string, label: string, name: string, asset: "USDT" | "WBT"): Wallet => {
    const address = s.address(name);
    return {
      id,
      label,
      network: "whitechain",
      asset,
      address,
      decimals: asset === "USDT" ? 6 : 18,
      topUp: (amount) =>
        `WAITING cs-wc top up the e2e ${label}: ${amount} ${asset} to ${address} on Whitechain Sepolia (no faucet: a transfer or a WBT swap)`,
      read: () => (asset === "USDT" ? tokenBalance(WHITECHAIN, address) : gasBalance(WHITECHAIN, address)),
    };
  };
  const hd = (id: string, label: string, asset: "USDC" | "HBAR"): Wallet => {
    const account = s.get("HD_AGENT_ID");
    return {
      id,
      label,
      network: "hedera",
      asset,
      address: account,
      decimals: asset === "USDC" ? 6 : 8,
      topUp: (amount) =>
        asset === "USDC"
          ? `NEEDS-BROWSER ${CIRCLE_FAUCET} | send Hedera testnet USDC to the e2e ${label} | ${account} (${s.get("HD_AGENT_EVM")}) on Hedera Testnet, ${amount} USDC | reply with the faucet tx`
          : `NEEDS-BROWSER ${HEDERA_FAUCET} | send testnet HBAR to the e2e ${label} | ${account} on Hedera Testnet, ${amount} HBAR | reply when sent`,
      read: () => hederaBalance(account, asset),
    };
  };
  return {
    arcBuyer: () => arc("arc.buyer.usdc", "Arc buyer", "CS_BUYER_ADDRESS", "USDC"),
    arcSubmitter: () => arc("arc.submitter.gas", "Arc hub gas wallet", "E2E_ARC_SUBMITTER_ADDRESS", "USDC gas"),
    arcStranger: () => arc("arc.stranger.gas", "Arc stranger", "E2E_STRANGER_ADDRESS", "USDC gas"),
    wcBuyer: () => wc("wc.buyer.usdt", "Whitechain buyer", "WC_BUYER_ADDRESS", "USDT"),
    wcRelayer: () => wc("wc.relayer.wbt", "Whitechain relayer", "E2E_WC_RELAYER_ADDRESS", "WBT"),
    wcMerchant: () => wc("wc.merchant.usdt", "Whitechain merchant", "WC_MERCHANT_ADDRESS", "USDT"),
    hdAgentUsdc: () => hd("hd.agent.usdc", "Hedera agent", "USDC"),
    hdAgentHbar: () => hd("hd.agent.hbar", "Hedera agent", "HBAR"),
  };
}

async function hederaBalance(account: string, asset: "USDC" | "HBAR"): Promise<bigint> {
  const res = await fetch(`${HEDERA.mirror}/api/v1/accounts/${account}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`mirror answered ${res.status} for ${account}`);
  const body = (await res.json()) as { balance?: { balance?: number; tokens?: { token_id: string; balance: number }[] } };
  if (asset === "HBAR") return BigInt(body.balance?.balance ?? 0);
  const token = body.balance?.tokens?.find((t) => t.token_id === HEDERA.usdc);
  return BigInt(token?.balance ?? 0);
}

export interface Plan {
  /** Flow name -> the spends it cannot cover. Absent: covered. */
  short: Map<string, Spend[]>;
  /** Wallet id -> balance read, or the error reading it. */
  balances: Map<string, bigint | Error>;
  /** One line per wallet that runs short, for RUN-STATE. */
  requests: string[];
}

/**
 * Read every wallet the flows may spend from, then walk the flows in order. A flow is covered
 * when every wallet it spends from keeps its floor after the flows before it.
 */
export async function planBudget(flows: Flow[], env: RunEnv): Promise<Plan> {
  const spendsByFlow = new Map<string, Spend[]>();
  const walletsById = new Map<string, Wallet>();
  for (const flow of flows) {
    if (flow.notRun?.(env)) continue;
    let spends: Spend[] = [];
    try {
      spends = flow.spends?.(env) ?? [];
    } catch (e) {
      // A wallet the flow needs is not configured: it fails in its own run, not here.
      env.log(`  budget: ${flow.name} spends unknown: ${(e as Error).message}`);
    }
    spendsByFlow.set(flow.name, spends);
    for (const s of spends) walletsById.set(s.wallet.id, s.wallet);
  }

  const balances = new Map<string, bigint | Error>();
  await Promise.all(
    [...walletsById.values()].map(async (w) => {
      try {
        balances.set(w.id, await w.read());
      } catch (e) {
        balances.set(w.id, e instanceof Error ? e : new Error(String(e)));
      }
    }),
  );

  const projected = new Map<string, bigint>();
  for (const [id, b] of balances) if (typeof b === "bigint") projected.set(id, b);

  const short = new Map<string, Spend[]>();
  const wanted = new Map<string, { wallet: Wallet; need: bigint }>();
  for (const flow of flows) {
    const spends = spendsByFlow.get(flow.name);
    if (!spends) continue;
    const missing = spends.filter((s) => {
      const have = projected.get(s.wallet.id);
      // A balance that could not be read does not stop a flow; the flow meets the chain itself.
      if (have === undefined) return false;
      return have - s.amount < s.floor;
    });
    if (missing.length > 0) {
      short.set(flow.name, missing);
      for (const s of missing) {
        const have = projected.get(s.wallet.id) ?? 0n;
        const need = s.floor + s.amount - have;
        const prev = wanted.get(s.wallet.id);
        if (!prev || prev.need < need) wanted.set(s.wallet.id, { wallet: s.wallet, need });
      }
      continue;
    }
    for (const s of spends) projected.set(s.wallet.id, (projected.get(s.wallet.id) ?? 0n) - s.amount);
  }

  const requests = [...wanted.values()].map(({ wallet, need }) => {
    // Ask for five times the shortfall, so one top-up lasts several runs.
    const ask = formatAmount(need * 5n, wallet.decimals);
    return wallet.topUp(ask);
  });
  return { short, balances, requests };
}

export function formatAmount(atomic: bigint, decimals: number, maxFraction = 6): string {
  const neg = atomic < 0n;
  const abs = neg ? -atomic : atomic;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  if (frac === "" && abs % base !== 0n) frac = "0".repeat(Math.max(0, maxFraction - 1)) + "1";
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Atomic units from a decimal string, for floors written by hand. */
export function units(decimal: string, decimals: number): bigint {
  const [w, f = ""] = decimal.split(".");
  return BigInt(w ?? "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function walletLink(w: Wallet): string {
  return explorerAddress(w.network, w.address);
}

export type { Address };
