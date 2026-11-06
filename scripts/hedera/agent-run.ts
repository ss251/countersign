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
import { createHederaAgent, spentFromLog } from "../../packages/buyer/src/hedera/agent.ts";
import { readEntries } from "../../packages/buyer/src/hedera/spendlog.ts";
import { FACILITATORS, HEDERA_TESTNET, httpFacilitator } from "../../packages/rail/src/hedera/index.ts";
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
  } else if (arg === "--json") json = true;
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
});

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
    return { label: "decoded", value: describeTransaction(Transaction.fromBytes(Buffer.from(bytes))) };
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
        process.exitCode = 1;
      }
    }
  }
} finally {
  logClient.close();
}

if (json) console.log(JSON.stringify({ beat: "hedera", ok, evidence }));
