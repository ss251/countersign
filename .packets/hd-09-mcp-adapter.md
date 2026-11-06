# hd-09-mcp-adapter: the runner serves an MCP tool as a paid offer, and the Hedera Agent Kit is the first one

## Goal

Issue #42: the Hedera Agent Kit MCP server as a metered listing.

Part A teaches the runner a second adapter, `mcp`, beside `skill`. The runner:

1. spawns an MCP server as a child;
2. connects to it as a stdio client;
3. calls one tool with the job input;
4. returns the tool result.

Part B adds the pieces for one real offer: a stdio launcher for `@hashgraph/hedera-agent-kit-mcp` in RETURN_BYTES mode, a seller script that publishes and serves it, and a buyer flag that targets it. No key is held for the buyer: in RETURN_BYTES mode the tool returns unsigned transaction bytes for the buyer's own account.

You build and test offline. The lane runs the live loop after review.

## Lease

The runner lease transfers to cs-hd for this packet only.

- **Part A, runner:**
  - `packages/runner/src/mcp.ts` (new);
  - `packages/runner/src/child-entry.ts`: the adapter switch only;
  - `packages/runner/src/child.ts`: the `ChildSpec` type only;
  - `packages/runner/src/daemon.ts`: only the one `runInChild(...)` call, as described below;
  - `packages/runner/package.json`: one new dependency;
  - `packages/runner/test/mcp*` (new tests, and a fixture server named `mcp-…`).
- **Part B, Hedera:**
  - `packages/rail/src/hedera/agent-kit-mcp.ts` (new);
  - `packages/rail/package.json`: the dependencies named below;
  - `packages/rail/src/hedera/test/agent-kit-mcp.test.ts` (new);
  - `scripts/hedera/mcp-seller.ts` (new);
  - `scripts/hedera/agent-run.ts`: two flags and two evidence lines.
- **Report:** `$M/reports/hd-09-mcp-adapter.md`.

Touch nothing else. Never stage `bun.lock`.

## Context

Read first:

- **Runner:** `packages/runner/src/skill.ts`, `child.ts`, `child-entry.ts`, `daemon.ts`, `publish.ts`, `cli.ts`, `account.ts`, and `packages/runner/test/child.test.ts`, `daemon.test.ts`.
- **Hedera scripts:** `scripts/hedera/agent-run.ts`, `scripts/hedera/env.ts`, `scripts/hedera/beat.ts`.
- **Core:** `packages/core/src/types.ts` (`Offer`, `SlipBody`; the slip already commits `inputHash` and `outputHash`), and `checkSchema` and `canonicalHash` in `packages/core`.

MCP facts:

- **Client.** `@modelcontextprotocol/sdk` 1.32.2: `Client` from `@modelcontextprotocol/sdk/client/index.js`, `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio.js`.
  - `StdioClientTransport` takes `{ command, args, env, stderr }`. Pass `env` explicitly, because its default environment is not ours.
  - `client.getServerVersion()` returns the server's `{ name, version }` after `connect`.
  - `client.listTools()` and `client.callTool({ name, arguments })` do what their names say. A tool result has `content` (text items), an optional `structuredContent`, and an optional `isError`.
- **Agent Kit.** `@hashgraph/hedera-agent-kit-mcp` 1.2.0 (Apache-2.0) exports `HederaMCPToolkit`, an `McpServer` subclass: `new HederaMCPToolkit({ client, configuration })`.
  - `configuration` is `{ tools?: string[], plugins, context: { mode, accountId } }`. `AgentMode` and `coreAccountPlugin` come from `@hashgraph/hedera-agent-kit` 4.2.0 and `@hashgraph/hedera-agent-kit/plugins`. Its peer dependency is `@hiero-ledger/sdk` ^2.90.1, which we already pin.
  - In `AgentMode.RETURN_BYTES` the kit needs only `context.accountId`. It builds `TransactionId.generate(accountId)`, freezes with the client's node list and returns the bytes, so **no operator is set and no key is read**.
  - The upstream example parses `HEDERA_OPERATOR_KEY` unconditionally. Do not copy that.
  - Tool `transfer_hbar_tool` takes `{ transfers: [{ accountId, amount }], sourceAccountId?, transactionMemo? }`. `amount` is in HBAR, and the source defaults to `context.accountId`.

## Part A: the runner's `mcp` adapter

1. **`mcp.ts` exports `McpSpec`:** `{ adapter: "mcp"; command: string; args: string[]; tool: string; server?: { package: string; version: string } }`.
   - `command` must be a bare name or an absolute path.
   - `server` names the npm package and version for the record.
2. **`mcp.ts` exports `substituteBuyer(spec, buyer)`.**
   - For an mcp spec, every arg that is exactly `{buyer}` becomes `buyer`, after `buyer` matches `^0\.0\.\d+$` or `^0x[0-9a-fA-F]{40}$`. Otherwise it throws `Error("Refused. The buyer id cannot be passed to the tool.")`.
   - Never substitute inside a longer string.
   - Any other spec is returned unchanged.
3. **`mcp.ts` exports `runMcp(spec, input)`, used in the child:**
   - **Spawn and connect.** Spawn with `StdioClientTransport`, with `env` set to the child's own environment: the child is already scrubbed to `PATH` and a temporary `HOME`. Set `stderr: "ignore"` and connect a `Client` named `countersign-runner`.
   - **Call.** `callTool` with `spec.tool` and the input, which must be a JSON object.
   - **Map the result.** `structuredContent` when present; else, when the text content is exactly one item that parses as JSON, that value; else `{ text: <text items joined by newlines> }`.
   - **Failure.** `isError: true`, or any client error, throws an `Error` carrying the tool's text, cut to 500 characters.
   - **Output.** Return `{ tool: spec.tool, server: { name, version } from getServerVersion(), package: spec.server ?? null, inputHash: canonicalHash(input), result }`. The slip's `outputHash` then commits the server, the tool and the input hash along with the result.
   - **Cleanup.** Always `close()` the client, which ends the server process, before returning or throwing.
4. **`child.ts`:** `ChildSpec` becomes `SkillSpec | McpSpec`.
5. **`child-entry.ts`:** `"skill"` behaves as today, `"mcp"` calls `runMcp`, and any other adapter is refused with `Error("Refused. Unknown adapter.")`. Keep the request validation strict for both shapes.
6. **`daemon.ts`, exactly one change.** The call `runInChild(entry.spec, order.input, …)` becomes `runInChild(substituteBuyer(entry.spec, order.buyer), order.input, …)`. It stays inside the existing `try`, so a refused buyer fails the job with its message.
7. **`packages/runner/package.json`:** add `"@modelcontextprotocol/sdk": "1.32.2"`.

**Part A tests (offline).** `packages/runner/test/mcp-fixture-server.ts` is a tiny stdio server built with `McpServer` and `StdioServerTransport`, with four tools:

- `echo` returns its arguments, plus `argv` (its own process arguments);
- `env` returns `{ planted: process.env.CS_PLANTED_SECRET ?? null }`;
- `fail` returns `isError: true` with a text message;
- `text` returns plain non-JSON text.

`packages/runner/test/mcp.test.ts`, through the real `runInChild` path where it matters:

- **Call:** the tool is called with the job input, and the output carries `tool`, `server.name`, `inputHash` equal to `canonicalHash(input)`, and the `result`.
- **Parsing:** JSON text is parsed into `result`, and plain text becomes `{ text }`.
- **`{buyer}`:**
  - it is substituted for a `0.0.N` buyer and for a `0x…` buyer;
  - a malformed buyer, for example `0.0.1;rm -rf /`, is refused before any spawn;
  - `{buyer}` inside a longer string stays literal.
- **Scrubbing:** with `process.env.CS_PLANTED_SECRET = "planted"` set in the test process, the `env` tool reports `null`. Restore the variable afterwards.
- **Errors:** `fail` makes the job throw cleanly, with the tool's message and no hung process.
- **Refusal:** an unknown adapter is refused by the child entry.
- Every existing runner test passes unedited.

## Part B: the Hedera Agent Kit listing, offline-ready

1. **`packages/rail/src/hedera/agent-kit-mcp.ts`, an executable stdio MCP server.**
   - Before any other import, redirect `process.stdout.write` to stderr, as the upstream example does, and restore it right before connecting the transport. That keeps SDK logging off the JSON-RPC channel.
   - Parse `--account-id <id>`. It is required and must match `^0\.0\.\d+$`; on any other input, exit 2 with a message.
   - Build `Client.forTestnet()` with **no operator**.
   - Build `new HederaMCPToolkit({ client, configuration: { tools: ["transfer_hbar_tool"], plugins: [coreAccountPlugin], context: { mode: AgentMode.RETURN_BYTES, accountId } } })` and connect a `StdioServerTransport`.
   - Read no environment variable and no file. Close the client when stdin closes.
2. **`packages/rail/package.json` dependencies:** `"@hashgraph/hedera-agent-kit-mcp": "1.2.0"`, `"@hashgraph/hedera-agent-kit": "4.2.0"`, `"@modelcontextprotocol/sdk": "1.32.2"`. List them in the report.
3. **`scripts/hedera/mcp-seller.ts --hub <url> [--price <atomic, default 30000>] [--state <dir>]`** publishes and serves one offer through the runner library (`publishOffer`, `startRunner`).
   - **Key.** The runner account comes from the seller key in the lane's key file, through `scripts/hedera/env.ts`: `HD_SELLER_KEY`, the key behind seller `0.0.11337065`. **Never print the key, and never accept it as an argument.** Build the account exactly this way:
     1. Read the key: `const env = readEnv(); const raw = key(env, "HD_SELLER_KEY").toStringRaw();`. That is 64 hex characters without `0x`.
     2. Load viem's accounts module the way `packages/runner/src/cli.ts` `loadAccounts()` does, anchored at core, which depends on viem:

        ```ts
        const require = createRequire(new URL("../../packages/core/package.json", import.meta.url));
        const { privateKeyToAccount } = await import(pathToFileURL(require.resolve("viem/accounts")).href);
        ```
     3. `const account = privateKeyToAccount(\`0x${raw}\`)`.
     4. If `account.address.toLowerCase()` is not `need(env, "HD_SELLER_EVM").toLowerCase()`, exit 1 with "seller key does not match HD_SELLER_EVM", printing no key material.
   - **Spec:**
     - `{ adapter: "mcp", command: process.execPath, args: [<absolute path of agent-kit-mcp.ts>, "--account-id", "{buyer}"], tool: "transfer_hbar_tool", server: { package: "@hashgraph/hedera-agent-kit-mcp", version: "1.2.0" } }`.
   - **Offer:**
     - title "Hedera Agent Kit: an HBAR transfer, built for you to sign";
     - a summary that says the result is unsigned RETURN_BYTES transaction bytes for the paying account;
     - `adapter: "mcp"`;
     - `input`: the tool's `inputSchema` from `listTools()`, gathered by spawning the launcher once at startup with `--account-id 0.0.11337065`. Strip `$schema`. Check that `checkSchema` from core accepts a valid input against it; if it cannot compile the schema, stop with a clear error;
     - `output`: `{ type: "object", required: ["tool", "server", "inputHash", "result"] }`;
     - price from `--price`, `deadline: 120`, `rails: ["hedera"]`, `payTo: { hedera: "0.0.11337065" }`;
     - `upstream: { url: "https://github.com/hashgraph/hedera-agent-kit-js", licence: "Apache-2.0" }`.
   - **Stability.** Call `publishOffer(hub, account, offer, { stateDir, skillSha256 })`. `stateDir` is `--state`, defaulting to `~/.countersign/runner-hedera-mcp`. `skillSha256` is `createHash("sha256").update(canonicalJson(spec)).digest("hex")`, with `canonicalJson` from core. A restart then republishes the same hash. Serve the offer that `publishOffer` returns.
   - **Output.** Print the offer hash and `runner online`, and print one line per job from `onJob`. Keep running until SIGTERM.
4. **`scripts/hedera/agent-run.ts`:**
   - `--offer <hash>` buys only the listed hedera offer with that hash, and dies if it is not listed;
   - `--input <json>` is the call input, default `{}`;
   - on a paid call, the evidence adds `{ label: "slip", value: <slip hash> }` and `{ label: "output", value: <canonical JSON of the output, cut to 400 characters> }`;
   - everything else stays the same.

**Part B tests (offline).** `packages/rail/src/hedera/test/agent-kit-mcp.test.ts` spawns the launcher with `--account-id 0.0.1234` through the MCP client and calls `listTools()` only. It expects exactly one tool, `transfer_hbar_tool`, with an object `inputSchema` that has `transfers`. A bad `--account-id` exits 2. **No tool call and no network.**

## Constraints

- **No browser** of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **No live runs.** Never run `mcp-seller.ts`, `agent-run.ts`, `beat` or any script that reads the key file or touches a hub or Hedera; the lane runs them. No network in tests.
- **No keys.** Never read or print a key, and never open an env file. The launcher sets no operator.
- **Scope.** TypeScript strict, no `any`. Change nothing outside the lease. Never stage `bun.lock`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/runner packages/rail/src/hedera && bun test && forge test
```

Every command passes, with no new skips. Commit on `cs/hd-09` with short present-tense messages ending `refs #42`, and no trailers. Write the report, including the full test counts and the exact `inputSchema` the launcher lists. Do not push, merge or deploy.

## Stop conditions

- `HederaMCPToolkit` will not start, or will not list `transfer_hbar_tool` in RETURN_BYTES mode without an operator: stop and paste the exact error in the report. Never work around it with a key.
- A change outside the lease looks necessary: stop and explain in the report.
- One problem has blocked you for more than 20 minutes: commit what passes and write the report.
