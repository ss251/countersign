/**
 * Read ERC-8004 feedback for one agent, one line per entry.
 *
 *   bun scripts/erc8004/read.ts --agent 1 [--from 0] [--rpc ...] [--chain-id ...]
 */

import { readFeedback } from "../../packages/identity/src/index.ts";
import { bigintFlag, chainChoice, parseArgs } from "./common.ts";

try {
  const args = parseArgs(process.argv.slice(2));
  const agentId = bigintFlag(args, "agent");
  const fromBlock = bigintFlag(args, "from", 0n);
  const choice = chainChoice(args);

  const feedback = await readFeedback(choice.publicClient, choice.registries.reputation, agentId, fromBlock);
  for (const entry of feedback) {
    const line = [
      entry.blockNumber,
      entry.tx,
      entry.client,
      entry.index,
      entry.value,
      entry.decimals,
      entry.tag1,
      entry.tag2,
      entry.endpoint,
      entry.feedbackURI,
      entry.feedbackHash,
    ];
    console.log(line.join("\t"));
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
