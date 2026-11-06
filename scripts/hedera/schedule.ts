// The scheduled checkout, live: the agent creates a USDC schedule, the seller checks and signs it,
// and the transfer executes on the second key. `--expiry-demo` creates one schedule and never signs
// it, then shows it expire with no money moved. Prints ids and links only, never a key.
//   bun scripts/hedera/schedule.ts [--expiry-demo] [--json]
import { formatUnits, offerHash, type Envelope, type Offer } from "../../packages/core/src/index.ts";
import { createHederaAgent, spentFromLog } from "../../packages/buyer/src/hedera/agent.ts";
import { readEntries, reconcile } from "../../packages/buyer/src/hedera/spendlog.ts";
import {
  countersignSchedule,
  getSchedule,
  hashscanAccount,
  hashscanTopic,
  hashscanTx,
  scheduleStatus,
  USDC_TESTNET,
  waitForScheduledExecution,
} from "../../packages/rail/src/hedera/index.ts";
import {
  HBAR_DECIMALS,
  HASHSCAN_TESTNET,
  MIRROR_TESTNET,
  USDC_DECIMALS,
} from "../../packages/rail/src/hedera/constants.ts";
import { hbarBalance, netFor, tokenBalance } from "../../packages/rail/src/hedera/mirror.ts";
import { key, need, readEnv, testnetClient } from "./env.ts";

const USDC_FLOOR = 1_000_000n; // 1.00 USDC, six decimals
const HBAR_FLOOR = 50_000_000n; // 0.50 HBAR, eight decimals
const PRICE = 10_000n; // 0.01 USDC, the same price the x402 beat uses
const usdc = (atomic: bigint | string) => formatUnits(BigInt(atomic), USDC_DECIMALS);
const hbar = (atomic: bigint) => formatUnits(atomic, HBAR_DECIMALS);
const nowSeconds = () => Math.floor(Date.now() / 1000);
const scheduleLink = (id: string) => `${HASHSCAN_TESTNET}/schedule/${id}`;
const mirrorMessage = (topicId: string, sequence: number) =>
  `${MIRROR_TESTNET}/api/v1/topics/${topicId}/messages/${sequence}`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
let expiryDemo = false;
let json = false;
for (const arg of args) {
  if (arg === "--expiry-demo") expiryDemo = true;
  else if (arg === "--json") json = true;
  else fail(`unknown argument ${arg}`);
}

function say(...line: unknown[]): void {
  if (json) console.error(...line);
  else console.log(...line);
}

interface Evidence {
  agent: { id: string; url: string };
  offer: { title: string; hash: string; price: string };
  create?: { tx: string; url: string };
  schedule?: { id: string; url: string; expiresAt: number };
  sign?: { tx: string; url: string };
  executed?: { consensusTimestamp: string; credit: string };
  log: { sequence: number; kind: string; url: string }[];
  balance?: { before: string; after: string };
  audit?: { matched: number; unbacked: number; unlogged: number; pending: number; released: number };
}

/** The same funds gate as the recorded beat: no script spends below either floor. */
async function budgetGate(agentId: string, agentEvm: string): Promise<void> {
  let agentUsdc: bigint | null;
  let agentHbar: bigint;
  try {
    [agentUsdc, agentHbar] = await Promise.all([tokenBalance(agentId, USDC_TESTNET), hbarBalance(agentId)]);
  } catch (error) {
    say(`error    ${error instanceof Error ? error.message : String(error)}`);
    say(`agent    ${agentId}  ${hashscanAccount(agentId)}`);
    process.exit(1);
  }
  const shortUsdc = (agentUsdc ?? 0n) < USDC_FLOOR;
  const shortHbar = agentHbar < HBAR_FLOOR;
  if (!shortUsdc && !shortHbar) return;
  if (shortUsdc) {
    say(`funds    agent ${agentId} has ${agentUsdc === null ? "no USDC association" : `${usdc(agentUsdc)} USDC`}; the floor is 1.00 USDC`);
    say("faucet   https://faucet.circle.com/ - USDC on Hedera Testnet");
  }
  if (shortHbar) {
    say(`funds    agent ${agentId} has ${hbar(agentHbar)} HBAR; the floor is 0.50 HBAR`);
    say(`faucet   https://portal.hedera.com/faucet - HBAR to ${agentEvm}`);
  }
  process.exit(2);
}

async function waitForSchedule(id: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const schedule = await getSchedule(id).catch(() => null);
    if (schedule) return schedule;
    if (Date.now() > deadline) throw new Error(`schedule ${id} did not appear on the mirror node`);
    await new Promise((r) => setTimeout(r, 1_500));
  }
}

async function waitForExpiry(id: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await scheduleStatus(id, { now: nowSeconds });
    if (status === "expired") return;
    if (status !== "pending") throw new Error(`schedule ${id} is ${status}, not pending`);
    if (Date.now() > deadline) throw new Error(`schedule ${id} did not expire within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

async function waitForEntry(
  topicId: string,
  predicate: (entry: { sequence: number; entry: { kind: string; schedule?: string } }) => boolean,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const entries = await readEntries(topicId);
    const found = entries.find(predicate);
    if (found || Date.now() > deadline) return { entries, found };
    await new Promise((r) => setTimeout(r, 1_500));
  }
}

const env = readEnv();
const agentId = need(env, "HD_AGENT_ID");
const agentEvm = need(env, "HD_AGENT_EVM");
const agentKey = key(env, "HD_AGENT_KEY");
const topicId = need(env, "HD_TOPIC_ID");
const sellerEvm = need(env, "HD_SELLER_SIGN_EVM");
const sellerSignId = need(env, "HD_SELLER_SIGN_ID");
const sellerSignKey = key(env, "HD_SELLER_SIGN_KEY");

const offer: Offer = {
  v: 1,
  seller: sellerEvm as Offer["seller"],
  title: "hedera scheduled checkout",
  summary: "One scheduled USDC transfer, executed only when the seller's key lands.",
  adapter: "mcp",
  input: { type: "object" },
  output: { type: "object" },
  price: PRICE.toString(10),
  deadline: 300,
  bond: "0",
  rails: ["hedera"],
  payTo: { hedera: sellerSignId },
  issuedAt: nowSeconds(),
};
const offerHashHex = offerHash(offer);

if (!expiryDemo) await budgetGate(agentId, agentEvm);

const topicLink = hashscanTopic(topicId);
const evidence: Evidence = {
  agent: { id: agentId, url: hashscanAccount(agentId) },
  offer: { title: offer.title, hash: offerHashHex, price: usdc(offer.price) },
  log: [],
};

const agentClient = testnetClient(agentId, agentKey);
let sellerClient: ReturnType<typeof testnetClient> | null = null;
let ok = false;
const mode: "main" | "expiry" = expiryDemo ? "expiry" : "main";

try {
  const prior = await readEntries(topicId);
  const spent = spentFromLog(prior);
  const cap = (BigInt(spent.total) + PRICE + PRICE / 2n).toString(10);
  const envelope: Envelope = {
    v: 1,
    agent: agentEvm as Envelope["agent"],
    cap,
    perMerchant: cap,
    allowlist: [],
    revoked: false,
  };
  const agent = createHederaAgent({
    // schedule never calls the hub; the agent still takes a URL.
    hub: "http://127.0.0.1:0",
    payer: { accountId: agentId, key: agentKey },
    envelope,
    topicId,
    logClient: agentClient,
    spent,
  });

  say(`agent    ${agentId}  ${hashscanAccount(agentId)}`);
  say(`offer    ${offer.title}  ${usdc(PRICE)} USDC  payTo ${sellerSignId}  ${offerHashHex}`);
  say(`envelope cap ${usdc(cap)} USDC  spent ${usdc(spent.total)} USDC`);

  // The run's window starts before anything is signed, in consensus-style time.
  const since = `${nowSeconds()}.000000000`;
  const sinceSeconds = Number(since.split(".")[0]);

  const outcome = await agent.schedule(
    { offer, offerHash: offerHashHex },
    { client: agentClient, expiresInSeconds: expiryDemo ? 60 : 300 },
  );
  if (outcome.kind === "refused") throw new Error(outcome.message);
  evidence.create = { tx: outcome.createTxId, url: hashscanTx(outcome.createTxId) };
  evidence.schedule = { id: outcome.scheduleId, url: scheduleLink(outcome.scheduleId), expiresAt: outcome.expiresAt };
  evidence.log.push({ sequence: outcome.logSequence, kind: "schedule", url: mirrorMessage(topicId, outcome.logSequence) });
  say(`created  ${outcome.createTxId}  ${hashscanTx(outcome.createTxId)}`);
  say(`schedule ${outcome.scheduleId}  ${scheduleLink(outcome.scheduleId)}`);
  say(`hcs      sequence ${outcome.logSequence}  ${topicLink}  ${mirrorMessage(topicId, outcome.logSequence)}`);

  if (expiryDemo) {
    const before = (await tokenBalance(agentId, USDC_TESTNET)) ?? 0n;
    const schedule = await waitForSchedule(outcome.scheduleId);
    say(`expires  ${schedule.expirationTime ?? "unknown"}`);
    await waitForExpiry(outcome.scheduleId);

    const release = await agent.releaseExpired(outcome.hold);
    say(`release  ${release}`);

    const { entries, found } = await waitForEntry(
      topicId,
      (e) => e.entry.kind === "expired" && e.entry.schedule === outcome.scheduleId,
    );
    if (found) {
      evidence.log.push({ sequence: found.sequence, kind: "expired", url: mirrorMessage(topicId, found.sequence) });
      say(`hcs      sequence ${found.sequence}  ${topicLink}  ${mirrorMessage(topicId, found.sequence)}`);
    }

    const final = await getSchedule(outcome.scheduleId);
    const after = (await tokenBalance(agentId, USDC_TESTNET)) ?? 0n;
    const status = final ? await scheduleStatus(outcome.scheduleId, { now: nowSeconds }) : "missing";
    say(`status   ${status}`);
    say(`executed ${final?.executedTimestamp ?? "none"}`);
    say(`balance  ${usdc(before)} -> ${usdc(after)} USDC ${before === after ? "(unchanged)" : "(CHANGED)"}`);
    evidence.balance = { before: usdc(before), after: usdc(after) };

    const mine = entries.filter(
      (e) =>
        Number(e.consensusAt.split(".")[0]) >= sinceSeconds ||
        e.sequence === outcome.logSequence ||
        e.sequence === found?.sequence,
    );
    const audit = await reconcile(mine, agentId, USDC_TESTNET, { since });
    say(
      `audit    matched ${audit.matched.length}, unbacked ${audit.unbacked.length}, unlogged ${audit.unlogged.length}, pending ${audit.pending.length}, released ${audit.released.length}`,
    );
    for (const { logged, why } of audit.unbacked) {
      say(`unbacked sequence ${logged.sequence}  ${logged.entry.tx ?? "(no tx)"}  ${why}`);
    }
    evidence.audit = {
      matched: audit.matched.length,
      unbacked: audit.unbacked.length,
      unlogged: audit.unlogged.length,
      pending: audit.pending.length,
      released: audit.released.length,
    };

    ok =
      status === "expired" &&
      !final?.executedTimestamp &&
      before === after &&
      release === "released" &&
      found !== undefined &&
      audit.released.length === 1 &&
      audit.unbacked.length === 0;
    if (ok) say("Expired. Nothing moved.");
  } else {
    await waitForSchedule(outcome.scheduleId);
    say(`status   ${await scheduleStatus(outcome.scheduleId, { now: nowSeconds })}`);

    sellerClient = testnetClient(sellerSignId, sellerSignKey);
    const signTxId = await countersignSchedule(sellerClient, outcome.scheduleId, {
      asset: USDC_TESTNET,
      amount: PRICE,
      payTo: sellerSignId,
      offerHash: offerHashHex,
      payer: agentId,
    });
    evidence.sign = { tx: signTxId, url: hashscanTx(signTxId) };
    say(`signed   ${signTxId}  ${hashscanTx(signTxId)}`);

    const executed = await waitForScheduledExecution(outcome.createTxId, { timeoutMs: 90_000 });
    const credit = netFor(executed.tokens[USDC_TESTNET] ?? [], sellerSignId);
    evidence.executed = { consensusTimestamp: executed.consensusTimestamp, credit: usdc(credit) };
    say(`Executed when the second key landed  consensus ${executed.consensusTimestamp}`);
    say(`seller   credit ${usdc(credit)} USDC  result ${executed.result}`);

    // The schedule entry already covers the spend; do not append a second entry.
    const { entries } = await waitForEntry(topicId, (e) => e.sequence === outcome.logSequence);
    const mine = entries.filter(
      (e) => Number(e.consensusAt.split(".")[0]) >= sinceSeconds || e.sequence === outcome.logSequence,
    );
    const audit = await reconcile(mine, agentId, USDC_TESTNET, { since });
    say(
      `audit    matched ${audit.matched.length}, unbacked ${audit.unbacked.length}, unlogged ${audit.unlogged.length}, pending ${audit.pending.length}, released ${audit.released.length}`,
    );
    for (const { logged, why } of audit.unbacked) {
      say(`unbacked sequence ${logged.sequence}  ${logged.entry.tx ?? "(no tx)"}  ${why}`);
    }
    for (const tx of audit.unlogged) say(`unlogged ${tx}  ${hashscanTx(tx)}`);
    evidence.audit = {
      matched: audit.matched.length,
      unbacked: audit.unbacked.length,
      unlogged: audit.unlogged.length,
      pending: audit.pending.length,
      released: audit.released.length,
    };

    ok =
      executed.result === "SUCCESS" &&
      credit === PRICE &&
      audit.matched.length === 1 &&
      audit.unbacked.length === 0 &&
      audit.unlogged.length === 0;
  }
} catch (error) {
  say(`error    ${error instanceof Error ? error.message : String(error)}`);
  ok = false;
} finally {
  sellerClient?.close();
  agentClient.close();
}

if (json) console.log(JSON.stringify({ beat: "hedera-schedule", mode, ok, evidence }));
process.exitCode = ok ? 0 : 1;
