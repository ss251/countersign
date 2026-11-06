// One run of the paying agent against a hub. Prints ids and links only, never a key.
//   bun scripts/hedera/agent-run.ts [hub-url] [--cap <atomic>] [--per-merchant <atomic>] [--times <n>] [--json]
import {
  canonicalJson,
  formatUnits,
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  type Envelope,
  type PaymentRequired,
} from "../../packages/core/src/index.ts";
import {
  createHederaAgent,
  RELEASE_MARGIN_SECONDS,
  spentFromLog,
  type Listing,
  type ReleaseOutcome,
  type ScheduleHold,
} from "../../packages/buyer/src/hedera/agent.ts";
import { readEntries } from "../../packages/buyer/src/hedera/spendlog.ts";
import {
  FACILITATORS,
  getSchedule,
  HASHSCAN_TESTNET,
  HEDERA_TESTNET,
  httpFacilitator,
  netFor,
  tokenBalance,
  USDC_TESTNET,
  waitForScheduledExecution,
} from "../../packages/rail/src/hedera/index.ts";
import { Transaction, TransferTransaction } from "../../packages/rail/src/hedera/sdk.ts";
import { hashscanAccount, hashscanTopic, hashscanTx, parseTxId } from "../../packages/rail/src/hedera/txid.ts";
import { key, need, readEnv, testnetClient } from "./env.ts";

const USDC_DECIMALS = 6;
const usdc = (atomic: string) => formatUnits(BigInt(atomic), USDC_DECIMALS);

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

const args = process.argv.slice(2);
let hub = "http://127.0.0.1:8787";
let cap = "1000000";
let perMerchant = "500000";
let times = 1;
let json = false;
let exact = false;
let proveUndelivered = false;
let offerFlag: string | undefined;
let input: unknown = {};
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--cap") cap = args[++i] ?? die("--cap needs an atomic amount");
  else if (arg === "--per-merchant") perMerchant = args[++i] ?? die("--per-merchant needs an atomic amount");
  else if (arg === "--times") {
    const value = args[++i] ?? die("--times needs a count");
    times = Number(value);
    if (!Number.isSafeInteger(times) || times < 1) die("--times needs a positive integer");
  } else if (arg === "--offer") offerFlag = args[++i] ?? die("--offer needs an offer hash");
  else if (arg === "--input") {
    const value = args[++i] ?? die("--input needs JSON");
    try {
      input = JSON.parse(value) as unknown;
    } catch {
      die("--input needs JSON");
    }
  } else if (arg === "--exact") exact = true;
  else if (arg === "--prove-undelivered") proveUndelivered = true;
  else if (arg === "--json") json = true;
  else if (arg.startsWith("-")) die(`unknown flag ${arg}`);
  else hub = arg;
}

function say(...line: unknown[]): void {
  if (json) console.error(...line);
  else console.log(...line);
}

interface Evidence {
  label: string;
  value: string | number;
  url?: string;
}
const evidence: Evidence[] = [];

const env = readEnv();
const agentId = need(env, "HD_AGENT_ID");
const topicId = need(env, "HD_TOPIC_ID");
const agentKey = key(env, "HD_AGENT_KEY");
const operatorId = need(env, "HD_OPERATOR_ID");
const logClient = testnetClient(agentId, agentKey);
const envelope: Envelope = {
  v: 1,
  agent: need(env, "HD_AGENT_EVM") as Envelope["agent"],
  cap,
  perMerchant,
  allowlist: [],
  revoked: false,
};

const topicLink = hashscanTopic(topicId);
const prior = await readEntries(topicId);
const spent = spentFromLog(prior);
const trustedFeePayers = new Set<string>([operatorId]);
const facilitatorNames = new Map<string, string>();
await Promise.all(
  FACILITATORS.map(async ({ name, url }) => {
    try {
      const feePayer = await httpFacilitator(name, url).feePayer();
      if (feePayer) {
        trustedFeePayers.add(feePayer);
        facilitatorNames.set(feePayer, name);
      }
    } catch {
      // A facilitator that cannot answer is not trusted for this run.
    }
  }),
);
facilitatorNames.set(operatorId, "local");

// Watch the agent's own challenges: the fee payer in one names the facilitator behind it.
let challengeFeePayer: string | null = null;
const watchChallenges = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await fetch(input, init);
  if (response.status === 402) {
    const header = response.headers.get(PAYMENT_REQUIRED_HEADER);
    try {
      const required = header
        ? fromBase64Json<PaymentRequired>(header)
        : ((await response.clone().json()) as PaymentRequired);
      const req = required.accepts?.find((a) => a.network === HEDERA_TESTNET && a.scheme === "exact");
      if (typeof req?.extra?.feePayer === "string") challengeFeePayer = req.extra.feePayer;
    } catch {
      // A 402 without a readable challenge is not evidence.
    }
  }
  return response;
}) as typeof fetch;

const agent = createHederaAgent({
  hub,
  payer: { accountId: agentId, key: agentKey },
  envelope,
  topicId,
  logClient,
  spent,
  trustedFeePayers: [...trustedFeePayers],
  fetch: watchChallenges,
  preferHeld: !exact,
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function usdcBalance(accountId: string): Promise<bigint> {
  return (await tokenBalance(accountId, USDC_TESTNET)) ?? 0n;
}

function heldEvidence(hold: ScheduleHold, logSequence: number): void {
  evidence.push({
    label: "schedule",
    value: hold.scheduleId,
    url: `${HASHSCAN_TESTNET}/schedule/${hold.scheduleId}`,
  });
  evidence.push({ label: "schedule create", value: hold.createTxId, url: hashscanTx(hold.createTxId) });
  evidence.push({ label: "hold log", value: `#${logSequence}`, url: topicLink });
}

async function proveUndeliveredCall(listing: Listing): Promise<boolean> {
  const before = await usdcBalance(agentId);
  const outcome = await agent.buy(listing, input);
  if (outcome.kind === "paid") {
    say(`call     unexpected: the held call was paid`);
    evidence.push({ label: "hub answer", value: "HTTP 200: the call was delivered" });
    return false;
  }
  if (outcome.kind === "refused") {
    say(`call     unexpected: ${outcome.reason}`);
    evidence.push({ label: "hub answer", value: `refused: ${outcome.message}` });
    return false;
  }
  evidence.push({ label: "hub answer", value: `HTTP ${outcome.status}: ${outcome.message}` });
  say(`call     failed: HTTP ${outcome.status}, charged ${outcome.charged}`);
  say(`message  ${outcome.message}`);
  if (!outcome.hold || outcome.logSequence === undefined) {
    say("call     unexpected: the failure carries no hold");
    return false;
  }
  const hold = outcome.hold;
  if (hold.expiresAt === undefined) {
    say("call     unexpected: the hold carries no expiry");
    return false;
  }
  heldEvidence(hold, outcome.logSequence);

  const waitMs = Math.max(0, (hold.expiresAt + RELEASE_MARGIN_SECONDS) * 1000 - Date.now());
  if (waitMs > 0) await sleep(waitMs);

  let release: ReleaseOutcome = "pending";
  const releaseDeadline = Date.now() + 60_000;
  while (release === "pending" && Date.now() <= releaseDeadline) {
    release = await agent.releaseExpired(hold);
    if (release !== "pending") break;
    await sleep(3_000);
  }

  const record = await getSchedule(hold.scheduleId).catch(() => null);
  const executed = record?.executedTimestamp != null;
  const after = await usdcBalance(agentId);
  let expired = [...(await readEntries(topicId))].reverse().find(
    (entry) => entry.entry.kind === "expired" && entry.entry.schedule === hold.scheduleId,
  );
  const expiredDeadline = Date.now() + 60_000;
  while (expired === undefined && Date.now() < expiredDeadline) {
    await sleep(3_000);
    expired = [...(await readEntries(topicId))].reverse().find(
      (entry) => entry.entry.kind === "expired" && entry.entry.schedule === hold.scheduleId,
    );
  }

  evidence.push({ label: "executed", value: executed ? (record?.executedTimestamp ?? "yes") : "none" });
  evidence.push({ label: "release", value: release });
  evidence.push({ label: "balance", value: `${usdc(before.toString())} -> ${usdc(after.toString())} USDC` });
  if (expired) {
    evidence.push({ label: "expired log", value: `#${expired.sequence}`, url: topicLink });
  }
  say(`release  ${release}`);
  say(`balance  ${usdc(before.toString())} -> ${usdc(after.toString())} USDC`);

  return (
    outcome.status !== 200 &&
    !outcome.charged &&
    release === "released" &&
    !executed &&
    before === after &&
    expired !== undefined
  );
}

function facilitatorName(feePayer: string): string {
  return facilitatorNames.get(feePayer) ?? feePayer;
}

evidence.push({ label: "agent", value: agentId, url: hashscanAccount(agentId) });

function feePayerFromTx(id: string): string | null {
  try {
    return parseTxId(id).payer;
  } catch {
    return null;
  }
}

/** The output as canonical JSON, whole. */
function canonicalOutput(output: unknown): string {
  try {
    return canonicalJson(output);
  } catch {
    return String(output);
  }
}

/** The unsigned transaction the buyer paid for, decoded from the tool's bytes. */
function decodedOutput(output: unknown): Evidence | null {
  const bytes = bufferBytes(output);
  if (bytes === null) return null;
  try {
    return {
      label: "decoded",
      value: describeTransaction(Transaction.fromBytes(new Uint8Array(Buffer.from(bytes)))),
    };
  } catch (error) {
    return { label: "decoded", value: `not decodable: ${messageOf(error)}` };
  }
}

function bufferBytes(output: unknown): number[] | null {
  if (!isRecord(output)) return null;
  const result = output.result;
  if (!isRecord(result)) return null;
  const bytes = result.bytes;
  if (!isRecord(bytes)) return null;
  if (bytes.type !== "Buffer" || !Array.isArray(bytes.data)) return null;
  const data: number[] = [];
  for (const byte of bytes.data) {
    if (typeof byte !== "number") return null;
    data.push(byte);
  }
  return data;
}

function describeTransaction(tx: Transaction): string {
  const type = tx instanceof TransferTransaction ? "TransferTransaction" : tx.constructor.name;
  const payer = tx.transactionId?.accountId?.toString() ?? "unknown";
  const hbar =
    tx instanceof TransferTransaction
      ? [...tx.hbarTransfers]
          .map(([account, amount]) => `${account.toString()} ${amount.toBigNumber().toString()}`)
          .join(", ")
      : "";
  return `${type} payer ${payer} hbar ${hbar} memo ${tx.transactionMemo}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

say(`hub      ${hub}`);
say(`agent    ${agentId}`);
say(`topic    ${topicId}  ${topicLink}`);
say(`envelope cap ${usdc(cap)} USDC, per merchant ${usdc(perMerchant)} USDC, spent ${usdc(spent.total)} USDC`);

let ok = true;
let facilitatorReported = false;
try {
  const listings = await agent.discover();
  const listing =
    offerFlag === undefined
      ? listings[0]
      : listings.find((candidate) => candidate.offerHash.toLowerCase() === offerFlag.toLowerCase());
  if (listings.length === 0) {
    say("no listed, online hedera offers");
    ok = false;
    process.exitCode = 1;
  } else if (listing === undefined) {
    say(`offer    ${offerFlag} is not listed`);
    ok = false;
    process.exitCode = 1;
  } else {
    say(`listing  ${listing.offerHash}`);
    say(`offer    ${listing.offer.title}  price ${usdc(listing.offer.price)} USDC  payTo ${listing.offer.payTo?.hedera}`);
    evidence.push({ label: "offer", value: listing.offerHash });
    if (proveUndelivered) {
      ok = await proveUndeliveredCall(listing);
      if (!ok) process.exitCode = 1;
    } else {
      for (let n = 1; n <= times && process.exitCode !== 1; n++) {
        challengeFeePayer = null;
        const outcome = await agent.buy(listing, input);
        const feePayer = challengeFeePayer ?? (outcome.kind === "paid" ? feePayerFromTx(outcome.transactionId) : null);
        if (!facilitatorReported && feePayer) {
          evidence.push({ label: "facilitator", value: facilitatorName(feePayer) });
          facilitatorReported = true;
        }
        if (outcome.kind === "paid") {
          say(`call ${n}   allow: the envelope covers ${usdc(listing.offer.price)} USDC`);
          say(`signed   ${outcome.transactionId}`);
          say(`settled  ${JSON.stringify(outcome.settlement)}`);
          say(`tx       ${hashscanTx(outcome.transactionId)}`);
          say(`hcs      sequence ${outcome.logSequence}  ${topicLink}`);
          say(`spent    ${usdc(agent.spent.total)} USDC`);
          evidence.push({ label: "payment", value: outcome.transactionId, url: hashscanTx(outcome.transactionId) });
          evidence.push({ label: "spend log", value: `#${outcome.logSequence}`, url: topicLink });
          evidence.push({ label: "slip", value: outcome.slip.hash });
          evidence.push({ label: "output", value: canonicalOutput(outcome.output) });
          const decoded = decodedOutput(outcome.output);
          if (decoded !== null) evidence.push(decoded);
          if (outcome.hold) {
            say(`schedule ${outcome.hold.scheduleId}`);
            heldEvidence(outcome.hold, outcome.logSequence);
            const execution = await waitForScheduledExecution(outcome.hold.createTxId, { timeoutMs: 60_000 });
            const credit = netFor(execution.tokens[outcome.hold.asset] ?? [], outcome.hold.payTo);
            const report = `${execution.result} at ${execution.consensusTimestamp}, +${usdc(credit.toString())} to ${outcome.hold.payTo}`;
            say(`execution ${report}`);
            evidence.push({ label: "execution", value: report });
          }
        } else if (outcome.kind === "refused") {
          say(`call ${n}   refuse: ${outcome.reason}`);
          say(`message  ${outcome.message}`);
          if (outcome.logSequence !== undefined) say(`hcs      sequence ${outcome.logSequence}  ${topicLink}`);
          evidence.push({ label: "refusal", value: outcome.message });
          if (outcome.logSequence !== undefined) {
            evidence.push({ label: "refusal log", value: `#${outcome.logSequence}`, url: topicLink });
          } else {
            ok = false;
          }
        } else {
          ok = false;
          say(`call ${n}   failed: HTTP ${outcome.status}, charged ${outcome.charged}`);
          say(`message  ${outcome.message}`);
          if (outcome.transactionId) {
            say(`signed   ${outcome.transactionId}`);
            say(`tx       ${hashscanTx(outcome.transactionId)}`);
          }
          if (outcome.logSequence !== undefined) say(`hcs      sequence ${outcome.logSequence}  ${topicLink}`);
          if (outcome.hold && outcome.logSequence !== undefined) {
            heldEvidence(outcome.hold, outcome.logSequence);
          }
          process.exitCode = 1;
        }
      }
    }
  }
} finally {
  logClient.close();
}

if (json) console.log(JSON.stringify({ beat: "hedera", ok, evidence }));
