# cs-78-e2e-npm-published: the published npm packages, run from a clean directory the way a stranger would

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-78`. URGENT: the firstmate's 21:00:02Z steer (project lead
02:30 IST) asks for an e2e flow that runs the PUBLISHED packages from a clean directory through npx.
It covers CLI discover, a buy on Arc with its release tx, verify VALID, and the MCP server driven by the
SDK client: list the tools, buy.

## What exists (read it; do not guess)

- **The published CLI.** It is `@countersign-hub/cli`. Its usage, in `packages/cli/src/cli.ts`, is
  `countersign discover|buy|envelope|journal [--hub <url>] [--state <dir>] ...`, then
  `countersign verify <slip.json> [--rpc <url>]` and `countersign mcp [--hub <url>] [--state <dir>] [--rpc <url>]`.
  - The buyer key comes from `CS_BUYER_KEY`.
  - From 0.1.1, `--hub` defaults to production `https://hub-production-e85e.up.railway.app`.
  - From 0.1.1, every subcommand answers `--help` with exit 0. 0.1.0 has neither, and this flow is meant
    to show that.
- **How the suite already buys use-arc on production.** That is `e2e/flows/public-spine.flow.ts`:
  - it finds the use-arc listing on the public hub's `/offers`;
  - it sets the envelope with the buyer CLI;
  - it calls `buy <offerHash> --input {}`;
  - it reads the journal for the slip hash and the release tx;
  - it checks the release on chain;
  - it verifies the slip.

  Copy those exact arguments and checks.
- **The MCP server** (`packages/mcp/src/server.ts`) registers six tools: `search_offers`, `get_offer`,
  `buy` (`{ offerHash, input, rail? }`), `verify_slip` (`{ slip? | slipHash? }`), `envelope_show` and
  `journal`.
  - `buy` answers one text content item: JSON `{ output, slipHash, releaseTx, explorer, slip }`.
  - It buys under the envelope in its `--state` directory.
- **The MCP SDK client.** The e2e package does not declare `@modelcontextprotocol/sdk`, and the
  lockfile is held, so add no dependency. `packages/mcp` declares it (1.32.2). Resolve it from there, so
  it works under both the hoisted and the isolated install:
  `Bun.resolveSync("@modelcontextprotocol/sdk/client/index.js", join(ROOT, "packages/mcp"))`, and the
  same for `@modelcontextprotocol/sdk/client/stdio.js`. Then `await import(...)` each path and use
  `Client` and `StdioClientTransport`.

## The flow: `e2e/flows/npm-published.flow.ts`

- **Registration.** Name `npm-published`, number `22`, owner `cs-truth`, network `arc`. Register it
  wherever the other flows are registered, and in `run.ts`'s numbering.
- **On demand,** with the reason "it installs the published packages from npm; run it with
  --flow npm-published". It spends the Arc buyer's 0.02 USDC (two buys).
- **The version** is `process.env.E2E_NPM_VERSION ?? "latest"`, written `V` below.

Steps, all hard:

1. **"a clean directory".**
   - `dir = mkdtempSync(join(tmpdir(), "cs-npm-"))`, with `home` and `state` inside it. Check that
     `dir` is not inside `ROOT`.
   - Every child runs with `cwd: dir` and an env of exactly `PATH`, `HOME=home`,
     `npm_config_cache=join(dir, "npm-cache")` and `NO_COLOR=1`.
   - Only the `buy` and `mcp` children also get `CS_BUYER_KEY`, through env and never argv.
   - Run `npm view @countersign-hub/cli@V version`, and note
     `published @countersign-hub/cli <version>` (and the same for `@countersign-hub/mcp` if it exists).
2. **"help answers".**
   - `npx -y @countersign-hub/cli@V --help` exits 0, and its stdout contains `countersign`.
   - `npx -y @countersign-hub/cli@V buy --help` exits 0, and its stdout contains `buy`. 0.1.0 fails here.
3. **"discover with the default hub".**
   - `npx -y @countersign-hub/cli@V discover --state <state>`, with no `--hub` and no `CS_HUB`, exits 0.
   - Its stdout has a line with `use-arc` and `online`.
   - Read the full use-arc offer hash and seller from the public hub's `/offers`, the same way
     public-spine does. The discover line must start with that hash's first 10 characters.
4. **"buy on Arc".** Run `envelope set` and `buy` through `npx -y @countersign-hub/cli@V ... --state <state>`
   with public-spine's exact arguments.
   - Both exit 0, and `buy` prints `Released. Slip minted.`
   - Read the slip hash and the release tx from the journal in `<state>`, as public-spine does.
   - The release tx has status 1 on Arc, with a `Released` event for that slip from the Arc escrow, the
     one the hub's `/rails` names.
   - Note the tx link.
5. **"verify VALID".** `npx -y @countersign-hub/cli@V verify <the slip file in state>` exits 0, and its
   last line is `VALID`. The slip file path follows public-spine's convention.
6. **"the MCP server through the SDK client".**
   - Spawn `npx -y @countersign-hub/cli@V mcp --state <state>` with `StdioClientTransport` (`command`
     `npx`, `args`, `env` as above plus `CS_BUYER_KEY`, `cwd: dir`). Connect a `Client`, named
     `countersign-e2e`.
   - `listTools()` names all six tools.
   - `callTool("search_offers", { query: "use-arc" })` returns the use-arc offer hash.
   - `callTool("buy", { offerHash, input: {} })` returns JSON with `releaseTx` and `slipHash`. The
     release tx has status 1 with `Released` for that slip.
   - `callTool("verify_slip", { slipHash })` returns text that contains `VALID`.
   - Close the client in a `ctx.defer`.
   - Never print `CS_BUYER_KEY`. The SDK's stderr from the child goes to a log file through
     `stderr: "pipe"`, and that log is redacted with `ctx.env.secrets.redact` as the other children's
     logs are.

## Tests (`bun test e2e/test`)

The flow's parsing is pure helpers:

- the discover line that names use-arc;
- the MCP `buy` JSON result.

Unit-test each with fixtures copied from the formats above, with made-up hashes.

## Docs

In `docs/e2e.md`, add a row for flow 22 and a short section: what it runs, `E2E_NPM_VERSION`, why it is
on demand, and that 0.1.0 is expected red at "help answers".

## Gate (paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/test` and `bun test e2e/human/test` all pass.
3. `bun run e2e -- --list` shows flow 22 as NOT RUN (on demand).

## Constraints

- No browser of any kind on this machine. Do not run any flow (`--list` only).
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/**` and `docs/e2e.md`; no `package.json` or `bun.lock` changes. Never read or print a
  key.
- Never push, merge or deploy. Make small present-tense commits on `cs/cs-78`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-78-e2e-npm-published.md`: the changes with line ranges, and the gate outputs.
