/**
 * Register a seller in ERC-8004 and, when asked, approve the hub as an operator.
 *
 *   CS_SELLER_KEY=0x... bun scripts/erc8004/register-seller.ts \
 *     --hub https://hub.example [--operator 0x...] [--name ...] [--description ...] \
 *     [--offer 0x...] ... [--rpc ...] [--chain-id ...]
 *
 * The agent URI is a data URI built from the registration file. Prints the agentId and
 * the transaction hashes. Keys come from the environment only and are never printed.
 */

import { toDataUri, registrationFile, registerAgent, grantOperator } from "../../packages/identity/src/index.ts";
import type { Hex } from "../../packages/identity/src/clients.ts";
import {
  accountOf,
  addressFlag,
  allFlags,
  chainChoice,
  flag,
  keyFromEnv,
  parseArgs,
  requiredFlag,
} from "./common.ts";

try {
  const args = parseArgs(process.argv.slice(2));
  const hubUrl = requiredFlag(args, "hub").replace(/\/+$/, "");
  const operator = addressFlag(args, "operator");
  const choice = chainChoice(args);
  const wallet = keyFromEnv("CS_SELLER_KEY", choice.chain, choice.rpcUrl);
  const seller = accountOf(wallet);

  const offers = allFlags(args, "offer").map((value) => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`--offer is not a bytes32 hash: ${value}`);
    return value.toLowerCase() as Hex;
  });
  const name = flag(args, "name") ?? "Countersign seller";
  const description = flag(args, "description") ?? `Paid capabilities sold by ${seller} through Countersign.`;

  const agentURI = toDataUri(registrationFile({ name, description, hubUrl, seller, offers, chainId: choice.chain.id }));
  const registered = await registerAgent(wallet, choice.publicClient, choice.registries.identity, agentURI);
  console.log(`agentId: ${registered.agentId}`);
  console.log(`registerTx: ${registered.tx}`);

  if (operator !== undefined) {
    const tx = await grantOperator(wallet, choice.publicClient, choice.registries.identity, operator);
    const receipt = await choice.publicClient.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") throw new Error(`operator grant reverted: ${tx}`);
    console.log(`operatorTx: ${tx}`);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
