/**
 * Leave ERC-8004 feedback for a released slip.
 *
 *   CS_BUYER_KEY=0x... bun scripts/erc8004/feedback.ts slip.json \
 *     --agent 1 --hub https://hub.example [--rpc ...] [--chain-id ...]
 *
 * The buyer key comes from the environment only. Prints the feedback transaction hash.
 */

import { readFileSync } from "node:fs";
import { slipHash, type Slip } from "../../packages/core/src/index.ts";
import { feedbackFromSlip, giveFeedback } from "../../packages/identity/src/index.ts";
import { bigintFlag, chainChoice, keyFromEnv, parseArgs, requiredFlag } from "./common.ts";

function readSlip(path: string): Slip {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null) throw new Error(`${path} is not a JSON object`);
  const slip = parsed as Partial<Slip>;
  if (slip.body === undefined || typeof slip.hash !== "string") throw new Error(`${path} is not a slip`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(slip.hash)) throw new Error(`${path} has no bytes32 hash`);
  if (slipHash(slip.body) !== slip.hash.toLowerCase()) throw new Error(`${path} hash does not match its body`);
  return slip as Slip;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const path = args.positionals[0];
  if (path === undefined) throw new Error("a slip JSON path is required");
  const agentId = bigintFlag(args, "agent");
  const hubUrl = requiredFlag(args, "hub").replace(/\/+$/, "");
  const choice = chainChoice(args);
  const wallet = keyFromEnv("CS_BUYER_KEY", choice.chain, choice.rpcUrl);

  const slip = readSlip(path);
  const feedback = feedbackFromSlip(slip, hubUrl);
  const tx = await giveFeedback(wallet, choice.publicClient, choice.registries.reputation, agentId, feedback);
  const receipt = await choice.publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error(`feedback reverted: ${tx}`);
  console.log(`feedbackTx: ${tx}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
