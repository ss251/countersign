// Audit the agent's HCS spend log against the chain: every spend backed by its transfer, every
// outgoing USDC transfer named. Prints ids only; exits 1 when the log and the chain disagree.
//   bun scripts/hedera/audit.ts [--json]
import { USDC_TESTNET } from "../../packages/rail/src/hedera/constants.ts";
import { hashscanTx } from "../../packages/rail/src/hedera/txid.ts";
import { readEntries, reconcile } from "../../packages/buyer/src/hedera/spendlog.ts";
import { need, readEnv } from "./env.ts";

const json = process.argv.slice(2).includes("--json");
function say(...line: unknown[]): void {
  if (json) console.error(...line);
  else console.log(...line);
}

const env = readEnv();
const topicId = need(env, "HD_TOPIC_ID");
const agent = need(env, "HD_AGENT_ID");

const entries = await readEntries(topicId);
const result = await reconcile(entries, agent, USDC_TESTNET);

say(`topic    ${topicId}`);
say(`agent    ${agent}`);
say(`asset    ${USDC_TESTNET}`);
say(`counts   matched ${result.matched.length}  unbacked ${result.unbacked.length}  unlogged ${result.unlogged.length}`);
for (const { logged, why } of result.unbacked) {
  say(`unbacked sequence ${logged.sequence}  ${logged.entry.tx ?? "(no tx)"}  ${why}`);
}
for (const tx of result.unlogged) say(`unlogged ${tx}  ${hashscanTx(tx)}`);

if (json) {
  const evidence: { label: string; value: string | number; url?: string }[] = [
    { label: "matched", value: result.matched.length },
    { label: "unbacked", value: result.unbacked.length },
    { label: "unlogged", value: result.unlogged.length },
  ];
  for (const tx of result.unlogged) {
    evidence.push({ label: "unlogged tx", value: tx, url: hashscanTx(tx) });
  }
  for (const { logged, why } of result.unbacked) {
    evidence.push({ label: "unbacked", value: `#${logged.sequence} ${why}` });
  }
  console.log(
    JSON.stringify({
      beat: "hedera-audit",
      ok: result.unbacked.length === 0 && result.unlogged.length === 0,
      evidence,
    }),
  );
}

if (result.unbacked.length > 0 || result.unlogged.length > 0) process.exit(1);
