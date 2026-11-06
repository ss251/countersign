> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Steer for cs-hd, 17:45 IST: the Hedera Agent Kit MCP beat (project lead approved, build it now)

Issue #42, "Hedera Agent Kit MCP server as a metered listing", is open and unassigned, so it is yours. Run the code as a DeepSeek packet in the extra slot that hd-06c freed; I log that. Wait only if load is above 24.

## 1. Code: packet `hd-09-mcp-adapter`

orch-cs owns `packages/runner`, and for this packet the lease below transfers to you. I am telling orch-cs.

The runner has one adapter today, `skill` (`packages/runner/src/skill.ts`; `child-entry.ts` validates `spec.adapter`). Add a second, `mcp`:

1. **Spec:** `{ adapter: "mcp", command, args, tool }`.
2. **Behaviour:** the runner spawns `command args…` as a child, connects as an MCP **stdio client**, calls `tool` with the job input as its arguments, and returns the parsed text content as the job output.
3. **The child stays scrubbed** exactly as the skill child is today: same environment allowlist, no keys, no inherited secrets.
4. **`{buyer}` substitution:** a literal `{buyer}` in `args` is replaced with the paying account, so a tool can act for the buyer without the runner holding a key.
5. **The client:** pin `@modelcontextprotocol/sdk` (Client plus StdioClientTransport) in `packages/runner`. Never stage `bun.lock`.
6. **Offline tests** against a tiny fake MCP stdio server under the test directory:
   - the tool is called with the job input;
   - text content is parsed into the output;
   - `{buyer}` is substituted;
   - the environment is scrubbed (the child cannot see a planted secret variable);
   - a tool error fails the job cleanly;
   - an unknown adapter is refused.
7. **Lease:**
   - `packages/runner/src/mcp.ts` (new);
   - the adapter switch in `child-entry.ts` and the spec type only;
   - `packages/runner/package.json` (that one dependency);
   - `packages/runner/test/mcp*` (new).

## 2. Live acceptance, run by you: the whole loop and nothing less

- **The server:** `@hashgraph/hedera-agent-kit-mcp@1.2.0`, pinned, on testnet, in **RETURN_BYTES** mode, so it builds an unsigned transfer for the buyer's account instead of needing an operator key.
  - If it insists on an operator key for that mode, say so in one line on issue #42 and in RUN-STATE. Keep RETURN_BYTES with no key. **Never invent credentials.**
- **Publish one real offer on the hedera rail:**
  - adapter `mcp`, with the Agent Kit as `command` and `args`, including `{buyer}` where the tool needs the buyer's account;
  - tool `transfer_hbar_tool`;
  - priced at a few cents;
  - `payTo` the seller account.

  Publish it on the production hub, which already declares hedera, so the proof is public.
- **The loop:**
  1. the buyer CLI discovers the offer;
  2. it pays over x402 on `hedera:testnet`;
  3. the runner spawns the MCP server;
  4. the tool returns its result (the unsigned transfer bytes);
  5. the slip records the MCP tool call (server package and version, the tool name, an input hash) and the settlement;
  6. the HCS spend log carries the entry, with a HashScan link.
- **Publish the proof:**
  - put the offer hash, the tx id and the HCS topic sequence in `docs/hedera.md` and on issue #42 (public text only);
  - send a REVIEW-REQ to cs-w1 for the runner change, since it spawns third-party code;
  - open the PR titled `#42 <what changed and why it matters>`;
  - raise NEEDS-BROWSER for the HashScan links.
- **The e2e flow:** hand cs-e2e the exact commands, so `hedera-mcp` becomes a flow in the suite and stays proven.
