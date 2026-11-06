// One run of the paying agent against a hub. Prints ids and links only, never a key.
//   bun scripts/hedera/agent-run.ts [hub-url] [--cap <atomic>] [--per-merchant <atomic>] [--times <n>]
import { formatUnits, type Envelope } from "../../packages/core/src/index.ts";
import { createHederaAgent, spentFromLog } from "../../packages/buyer/src/hedera/agent.ts";
import { readEntries } from "../../packages/buyer/src/hedera/spendlog.ts";
import { hashscanTopic, hashscanTx } from "../../packages/rail/src/hedera/txid.ts";
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
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--cap") cap = args[++i] ?? die("--cap needs an atomic amount");
  else if (arg === "--per-merchant") perMerchant = args[++i] ?? die("--per-merchant needs an atomic amount");
  else if (arg === "--times") {
    const value = args[++i] ?? die("--times needs a count");
    times = Number(value);
    if (!Number.isSafeInteger(times) || times < 1) die("--times needs a positive integer");
  } else if (arg.startsWith("-")) die(`unknown flag ${arg}`);
  else hub = arg;
}

const env = readEnv();
const agentId = need(env, "HD_AGENT_ID");
const topicId = need(env, "HD_TOPIC_ID");
const agentKey = key(env, "HD_AGENT_KEY");
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
const agent = createHederaAgent({
  hub,
  payer: { accountId: agentId, key: agentKey },
  envelope,
  topicId,
  logClient,
  spent,
});

console.log(`hub      ${hub}`);
console.log(`agent    ${agentId}`);
console.log(`topic    ${topicId}  ${topicLink}`);
console.log(`envelope cap ${usdc(cap)} USDC, per merchant ${usdc(perMerchant)} USDC, spent ${usdc(spent.total)} USDC`);

try {
  const listings = await agent.discover();
  if (listings.length === 0) {
    console.log("no listed, online hedera offers");
    process.exitCode = 1;
  } else {
    const listing = listings[0]!;
    console.log(`listing  ${listing.offerHash}`);
    console.log(`offer    ${listing.offer.title}  price ${usdc(listing.offer.price)} USDC  payTo ${listing.offer.payTo?.hedera}`);
    for (let n = 1; n <= times && process.exitCode !== 1; n++) {
      const outcome = await agent.buy(listing, {});
      if (outcome.kind === "paid") {
        console.log(`call ${n}   allow: the envelope covers ${usdc(listing.offer.price)} USDC`);
        console.log(`signed   ${outcome.transactionId}`);
        console.log(`settled  ${JSON.stringify(outcome.settlement)}`);
        console.log(`tx       ${hashscanTx(outcome.transactionId)}`);
        console.log(`hcs      sequence ${outcome.logSequence}  ${topicLink}`);
        console.log(`spent    ${usdc(agent.spent.total)} USDC`);
      } else if (outcome.kind === "refused") {
        console.log(`call ${n}   refuse: ${outcome.reason}`);
        console.log(`message  ${outcome.message}`);
        if (outcome.logSequence !== undefined) console.log(`hcs      sequence ${outcome.logSequence}  ${topicLink}`);
      } else {
        console.log(`call ${n}   failed: HTTP ${outcome.status}, charged ${outcome.charged}`);
        console.log(`message  ${outcome.message}`);
        if (outcome.transactionId) {
          console.log(`signed   ${outcome.transactionId}`);
          console.log(`tx       ${hashscanTx(outcome.transactionId)}`);
        }
        if (outcome.logSequence !== undefined) console.log(`hcs      sequence ${outcome.logSequence}  ${topicLink}`);
        process.exitCode = 1;
      }
    }
  }
} finally {
  logClient.close();
}
