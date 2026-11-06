/**
 * A stdio MCP server for the Hedera Agent Kit in RETURN_BYTES mode.
 *
 * It holds no operator and reads no key: the transfer tool freezes an unsigned
 * HBAR transfer for the account named on the command line, and the caller
 * signs and submits the bytes.
 *
 *   bun packages/rail/src/hedera/agent-kit-mcp.ts --account-id 0.0.1234
 */

// The SDK logs to stdout on occasion; stdout belongs to JSON-RPC here.
const realStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;

import { AgentMode } from "@hashgraph/hedera-agent-kit";
import { coreAccountPlugin } from "@hashgraph/hedera-agent-kit/plugins";
import { HederaMCPToolkit } from "@hashgraph/hedera-agent-kit-mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "./sdk.ts";

const ACCOUNT_ID = /^0\.0\.\d+$/;

function accountIdFrom(args: string[]): string {
  const index = args.indexOf("--account-id");
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || !ACCOUNT_ID.test(value)) {
    console.error("usage: agent-kit-mcp.ts --account-id <0.0.N>");
    process.exit(2);
  }
  return value;
}

const accountId = accountIdFrom(process.argv.slice(2));
const client = Client.forTestnet();
const server = new HederaMCPToolkit({
  client,
  configuration: {
    tools: ["transfer_hbar_tool"],
    plugins: [coreAccountPlugin],
    context: { mode: AgentMode.RETURN_BYTES, accountId },
  },
});

let closed = false;
const close = (): void => {
  if (closed) return;
  closed = true;
  client.close();
};
process.stdin.once("end", close);
process.stdin.once("close", close);

process.stdout.write = realStdoutWrite as typeof process.stdout.write;
await server.connect(new StdioServerTransport());
