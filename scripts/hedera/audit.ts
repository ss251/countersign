// Audit the agent's HCS spend log against the chain: every spend backed by its transfer, every
// outgoing USDC transfer named. Prints ids only; exits 1 when the log and the chain disagree.
//   bun scripts/hedera/audit.ts
import { USDC_TESTNET } from "../../packages/rail/src/hedera/constants.ts";
import { hashscanTx } from "../../packages/rail/src/hedera/txid.ts";
import { readEntries, reconcile } from "../../packages/buyer/src/hedera/spendlog.ts";
import { need, readEnv } from "./env.ts";

const env = readEnv();
const topicId = need(env, "HD_TOPIC_ID");
const agent = need(env, "HD_AGENT_ID");

const entries = await readEntries(topicId);
const result = await reconcile(entries, agent, USDC_TESTNET);

console.log(`topic    ${topicId}`);
console.log(`agent    ${agent}`);
console.log(`asset    ${USDC_TESTNET}`);
console.log(`counts   matched ${result.matched.length}  unbacked ${result.unbacked.length}  unlogged ${result.unlogged.length}`);
for (const { logged, why } of result.unbacked) {
  console.log(`unbacked sequence ${logged.sequence}  ${logged.entry.tx ?? "(no tx)"}  ${why}`);
}
for (const tx of result.unlogged) console.log(`unlogged ${tx}  ${hashscanTx(tx)}`);

if (result.unbacked.length > 0 || result.unlogged.length > 0) process.exit(1);
