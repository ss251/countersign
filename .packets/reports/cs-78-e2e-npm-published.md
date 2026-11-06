# cs-78 · the published npm packages, end to end

Flow 22, `npm-published`: run the published `@countersign-hub/cli` through `npx` from a clean
temporary directory, buy the live `use-arc` offer on Arc, verify the slip, then drive the CLI's MCP
server with the MCP SDK client and buy and verify again.

## Changes

- `e2e/flows/npm-published.flow.ts` (new, lines 1-406)
  - version, spend and tool-name constants: 22-32;
  - the pure parsing helpers `useArcDiscoverLine`, `parseMcpBuy` and `mcpVerdict`: 96-155;
  - clean-directory child env and `npx`/`npm view` runners: 157-216;
  - MCP result reading and the on-chain release check: 218-234;
  - flow registration (`owner: cs-truth`, `network: arc`, on-demand reason, 0.02 USDC spend): 236-247;
  - the six hard steps: 249-404.
- `e2e/flows/index.ts` (lines 13 and 50): imports the flow and registers matrix number `22`.
- `e2e/lib/flow.ts` (line 13): adds `cs-truth` to the `Owner` union.
- `e2e/test/npm-published.test.ts` (new, lines 1-87): offline fixtures with made-up hashes for the
  discover line, the MCP buy JSON, and the MCP verify verdict.
- `docs/e2e.md` (line 40, and section at lines 269-280): the flow 22 row and a short section covering
  what it runs, `E2E_NPM_VERSION`, why it is on demand, and the expected red at "help answers" on
  0.1.0.

## Notes on the implementation

- `envelope set` also receives `CS_BUYER_KEY`. The buyer CLI derives the envelope's `agent` from that
  key (`packages/buyer/src/cli.ts` lines 132-134, and `agentAccount()` before it), so the command
  exits 1 when the key is absent. The spec's "only the buy and mcp children" cannot also run
  `envelope set`; the envelope child is the one necessary exception. `npm view`, both `--help`
  children, `discover` and `verify` get no key; `buy` and `mcp` do.
- The MCP `verify_slip` tool returns the verifier's JSON (`{"valid": true, ...}`), not the CLI's
  `VALID` line. `mcpVerdict` reads the boolean as `VALID`/`INVALID`, and also accepts a CLI-style
  last line, so the step asserts a VALID verdict without inventing output.
- `e2e/run.ts` has no separate flow-number list: it reads `NUMBERS` from `e2e/flows/index.ts`. The
  matrix entry is the numbering it prints.
- No flow was run. The gate used `--list` only, per the constraint.

## Gate

### 1 · hoisted install and typecheck

```
$ bun install --linker hoisted
bun install v1.3.14 (0d9b296a)

Checked 1031 installs across 774 packages (no changes) [588.00ms]
```

```
$ bun run typecheck
$ tsc -p tsconfig.json
```

### 2 · offline tests

```
$ bun test e2e/test
bun test v1.3.14 (0d9b296a)

 50 pass
 0 fail
 132 expect() calls
Ran 50 tests across 3 files. [9.16s]
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

e2e/human/test/report.test.ts:
leak: /var/folders/.../artifacts/20260101-000000-abcd/privy/planted.json
leak: /var/folders/.../test-results/buy-retry/error-context.md
leak: /var/folders/.../artifacts/20260101-000000-abcd/privy/planted.json

 66 pass
 0 fail
 187 expect() calls
Ran 66 tests across 10 files. [2.05s]
```

The `leak:` lines are the report test's expected probe output; its assertions pass.

### 3 · flow list

```
$ bun run e2e -- --list
...
21b hedera-held-undelivered  cs-hd    hedera     NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered)  Hedera agent 0.05 USDC, Hedera agent 0.17 HBAR
22  npm-published            cs-truth arc        NOT RUN (on demand: it installs the published packages from npm; run it with --flow npm-published)  Arc buyer 0.02 USDC
14a production-console       cs-ui    none
...
```

Flow 22 is registered, owned by `cs-truth`, on Arc, and NOT RUN for the on-demand reason.

## State

Only `e2e/**`, `docs/e2e.md` and this report changed. `package.json` and `bun.lock` are untouched.
The pre-existing mode change to `packages/cli/src/bin.ts` was left alone and is not part of these
commits.
