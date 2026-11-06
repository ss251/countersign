# tr-09: `countersign`, one CLI that delegates to the runner, the buyer, the verifier and the MCP server, and runs on Node 22+ (refs #246)

**Design: decided.** cs-truth wrote this on Opus for STEER-0110 item K2 and `docs/decisions.md` D22, which is already committed on this branch. Implement exactly what follows. Nothing here is left for you to choose.

## Goal

- A new package `packages/cli` provides one command, `countersign`, with no logic of its own: every subcommand runs an existing CLI.
- The runner stops calling Bun-only APIs, so the whole thing runs on Node 22 or later, bundled with `bun build --target node`.

## Decisions

### 1. `packages/cli/package.json` (new), exactly

```json
{
  "name": "countersign",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "bun build ./src/bin.ts --target node --outfile dist/cli.js && bun build ../runner/src/child-entry.ts --target node --outfile dist/child-entry.js"
  }
}
```

There is no `bin`, `files` or `exports`: those belong to the release packet (K3). `dist/` is already ignored by the root `.gitignore`.

### 2. `packages/cli/src/cli.ts` (new), exactly

```ts
/**
 * countersign: one command for selling, buying and verifying. It holds no logic of its own;
 * each subcommand runs an existing CLI (docs/decisions.md D22).
 */
import { main as runnerMain } from "../../runner/src/cli.ts";

export const VERSION = "0.1.0";

export const USAGE = `countersign ${VERSION}

Sell. The runner dials out to the hub, so you open no port. The key comes from CS_SELLER_KEY.
  countersign sell skill <SKILL.md> --hub <url> --price <atomic> [runner flags]
  countersign sell openapi --spec <spec.json> --operation <id> --hub <url> --price <atomic> [--base-url <url>] [runner flags]
  Add --publish-only to list the offer without serving it.

Buy. The key comes from CS_BUYER_KEY.
  countersign discover|buy|envelope|journal [--hub <url>] [--state <dir>] ...

Verify a slip offline:
  countersign verify <slip.json> [--rpc <url>]

The buyer MCP server over stdio, from @countersign/mcp:
  countersign mcp [--hub <url>] [--state <dir>] [--rpc <url>]
`;

const BUYER_COMMANDS = new Set(["discover", "buy", "envelope", "journal"]);

export interface CliDeps {
  runner: (argv: string[]) => Promise<void>;
  loadBuyer: () => Promise<unknown>;
  loadVerify: () => Promise<unknown>;
  loadMcp: () => Promise<unknown>;
}

// Built at run time, so neither the bundler nor the typecheck needs @countersign/mcp present.
const MCP_PACKAGE = ["@countersign", "mcp"].join("/");

export const DEFAULT_DEPS: CliDeps = {
  runner: (argv) => runnerMain(argv),
  loadBuyer: () => import("../../buyer/src/cli.ts"),
  loadVerify: () => import("../../verify/src/cli.ts"),
  loadMcp: () => import(MCP_PACKAGE),
};

export type RunnerArgs = { ok: true; args: string[] } | { ok: false; error: string };

/** Map `sell <adapter> ...` onto the runner's own arguments. */
export function runnerArgs(rest: string[]): RunnerArgs {
  const publishOnly = rest.includes("--publish-only");
  const flags = rest.filter((arg) => arg !== "--publish-only");
  const verb = publishOnly ? "publish" : "serve";
  const [adapter, ...more] = flags;
  if (adapter === "skill") {
    const [path, ...others] = more;
    if (path === undefined || path.startsWith("--")) {
      return { ok: false, error: "countersign sell skill needs the path to a SKILL.md." };
    }
    return { ok: true, args: [verb, "--skill", path, ...others] };
  }
  if (adapter === "openapi") {
    const at = more.indexOf("--spec");
    const spec = at === -1 ? undefined : more[at + 1];
    if (spec === undefined || spec.startsWith("--")) {
      return { ok: false, error: "countersign sell openapi needs --spec <spec.json>." };
    }
    const others = [...more.slice(0, at), ...more.slice(at + 2)];
    return { ok: true, args: [verb, "--openapi", spec, ...others] };
  }
  if (adapter === "mcp") {
    return {
      ok: false,
      error: "countersign sell mcp is not available yet: the runner CLI sells a skill or an OpenAPI operation.",
    };
  }
  return { ok: false, error: "countersign sell takes skill or openapi." };
}

export async function run(argv: string[], deps: CliDeps = DEFAULT_DEPS): Promise<void> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`countersign ${VERSION}\n`);
    return;
  }
  if (command === "sell") {
    const mapped = runnerArgs(rest);
    if (!mapped.ok) return refuse(mapped.error);
    await deps.runner(mapped.args);
    return;
  }
  if (BUYER_COMMANDS.has(command)) {
    setArgv([command, ...rest]);
    await deps.loadBuyer();
    return;
  }
  if (command === "verify") {
    setArgv(rest);
    await deps.loadVerify();
    return;
  }
  if (command === "mcp") {
    let loaded: unknown;
    try {
      loaded = await deps.loadMcp();
    } catch {
      return refuse("countersign mcp needs @countersign/mcp installed beside countersign.");
    }
    const main = isRecord(loaded) ? loaded.main : undefined;
    if (typeof main !== "function") return refuse("@countersign/mcp has no main(argv) export.");
    await (main as (argv: string[]) => Promise<void>)(rest);
    return;
  }
  return refuse(`countersign: unknown command '${command}'.`);
}

/** The buyer and verifier CLIs read process.argv when they load, so set it to what they expect. */
function setArgv(args: string[]): void {
  process.argv = [process.argv[0] ?? "node", "countersign", ...args];
}

function refuse(message: string): void {
  process.stderr.write(`${message}\n\n${USAGE}`);
  process.exitCode = 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

### 3. `packages/cli/src/bin.ts` (new), exactly

```ts
#!/usr/bin/env node
import { run } from "./cli.ts";

run(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
```

### 4. The runner: these replacements only

**`packages/runner/src/cli.ts`**
- Add `import { createHash } from "node:crypto";` directly above `import { readFileSync } from "node:fs";`.
- Replace
  ```ts
  async function main(): Promise<void> {
    const [command, ...args] = process.argv.slice(2);
  ```
  with
  ```ts
  /** Run the seller CLI with these arguments (by default, this process's own). `countersign sell` calls it. */
  export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
    const [command, ...args] = argv;
  ```
- In the OpenAPI hash, replace `new Bun.CryptoHasher("sha256")` with `createHash("sha256")`. The `.update(bytes).update("\n").update(entry.operationId).digest("hex")` chain stays as it is.
- The `if (import.meta.main) { ... }` block at the end stays as it is.

**`packages/runner/src/skill.ts`**
- Add `import { createHash } from "node:crypto";` and `import { readFile } from "node:fs/promises";` at the top of the imports.
- Replace `const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());` with `const bytes = new Uint8Array(await readFile(path));`.
- Replace `sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),` with `sha256: createHash("sha256").update(bytes).digest("hex"),`.

**`packages/runner/src/child-entry.ts`**
- Replace `const request = parseRequest(await Bun.stdin.text());` with `const request = parseRequest(await readStdin());`.
- Add this function directly after `main`:
  ```ts
  async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  ```

**`packages/runner/src/child.ts`**
- Imports:
  - replace `import { mkdtempSync } from "node:fs";` with `import { existsSync, mkdtempSync } from "node:fs";`;
  - add `import { spawn } from "node:child_process";` and `import { fileURLToPath } from "node:url";`;
  - keep `tmpdir` and `join`.
- Replace `const CHILD_ENTRY = join(import.meta.dir, "child-entry.ts");` with:
  ```ts
  /** The child entry beside this file: child-entry.js in a Node bundle, else the TypeScript source, which Bun runs. */
  export function childEntryPath(): string {
    const bundled = fileURLToPath(new URL("./child-entry.js", import.meta.url));
    if (existsSync(bundled)) return bundled;
    return fileURLToPath(new URL("./child-entry.ts", import.meta.url));
  }
  ```
- In `runInChild`, replace everything from `const proc = Bun.spawn([process.execPath, CHILD_ENTRY], {` through `const exitCode = await proc.exited;` with exactly:
  ```ts
    const proc = spawn(process.execPath, [childEntryPath()], {
      env: scrubbedEnv(process.env, lineage),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let timedOut = false;
    let oversized = false;
    let size = 0;
    const chunks: Uint8Array[] = [];
    const errorChunks: Uint8Array[] = [];

    const exited = new Promise<number>((resolve) => {
      proc.once("error", () => resolve(1));
      proc.once("close", (code) => resolve(code ?? 1));
    });

    // The child can exit before it reads its input; its exit decides the result.
    proc.stdin.on("error", () => undefined);
    proc.stdin.end(JSON.stringify({ spec, input }));

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, limits.timeMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      if (oversized) return;
      size += chunk.byteLength;
      if (size > limits.maxOutputBytes) {
        oversized = true;
        proc.kill();
        return;
      }
      chunks.push(chunk);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      errorChunks.push(chunk);
    });

    const exitCode = await exited;
    clearTimeout(timer);
    const stderr = decode(errorChunks);
  ```
  Everything after that line stays as it is: the `timedOut`, `oversized` and `exitCode` checks, and the output parse.

Nothing else in the runner changes. `daemon.ts` keeps the global `WebSocket`, which Node 22 provides.

## Lease

- new: `packages/cli/package.json`, `packages/cli/src/cli.ts`, `packages/cli/src/bin.ts`, `packages/cli/test/cli.test.ts`;
- `packages/runner/src/cli.ts`, `packages/runner/src/skill.ts`, `packages/runner/src/child-entry.ts` and `packages/runner/src/child.ts`: the replacements in section 4 only.

Read only: everything else. Never commit `bun.lock`: the new workspace member changes it, and orch-cs regenerates it at merge. Never edit the root `package.json` or `tsconfig.json`.

## Tests (`packages/cli/test/cli.test.ts`, bun:test, no network)

Capture output with `spyOn(process.stdout, "write")` and `spyOn(process.stderr, "write")`. In `afterEach`, restore the spies, reset `process.exitCode = 0`, and restore `process.argv` to the value saved in `beforeEach`. Pass a `CliDeps` whose functions record their calls. Each of `runner`, `loadBuyer`, `loadVerify` and `loadMcp` records `process.argv.slice(2)`, or its own argument, at the moment it is called.

1. **`runnerArgs`.**
   - `["openapi","--spec","s.json","--operation","op","--price","10000","--hub","http://hub.test"]` maps to `serve --openapi s.json --operation op --price 10000 --hub http://hub.test`.
   - The same with `--publish-only` anywhere maps to `publish ...`, with `--publish-only` removed.
   - `["skill","./SKILL.md","--price","5000"]` maps to `serve --skill ./SKILL.md --price 5000`.
   - `["openapi","--operation","op"]`, `["skill"]`, `["skill","--price","1"]`, `["mcp"]` and `["frobnicate"]` are each `{ok: false}` with the error strings above.
2. **`--version`** writes exactly `countersign 0.1.0\n`.
3. **`--help`, `help` and no arguments** each write `USAGE`, which contains `countersign sell skill`, `countersign sell openapi`, `countersign discover|buy|envelope|journal`, `countersign verify` and `countersign mcp`.
4. **An unknown command** sets `process.exitCode` to 2 and writes `unknown command 'frobnicate'` to stderr. No dep is called.
5. **`sell openapi`** calls `runner` once with the mapped arguments. **`sell mcp`** sets exit code 2 and calls nothing.
6. **`buy 0xabc --input {}`** calls `loadBuyer` with `process.argv.slice(2)` equal to `["buy","0xabc","--input","{}"]`. **`discover --hub http://h`** gives `["discover","--hub","http://h"]`.
7. **`verify slip.json --rpc http://rpc`** calls `loadVerify` with `process.argv.slice(2)` equal to `["slip.json","--rpc","http://rpc"]`.
8. **`mcp --hub http://h`** with a `loadMcp` that resolves `{ main }` calls `main` with `["--hub","http://h"]`. With a `loadMcp` that rejects, it sets exit code 2 and writes `needs @countersign/mcp` to stderr.
9. **The bin.** `Bun.spawnSync(["bun", "packages/cli/src/bin.ts", "--version"])` from the repository root exits 0 and prints `countersign 0.1.0`.

Every existing test still passes unedited. That includes `packages/runner/test/child.test.ts`, `mcp.test.ts` and `openapi.test.ts`, which pin `runInChild`'s ceilings and errors, and the skill tests, which pin the sha256 values.

## Constraints

- **No browser** of any kind. That means no headless Chrome, no Playwright, no Puppeteer and no screenshot tools.
- **No network** in tests. Never publish, pack or tag anything.
- **Never print a key.** Never put a key in a file or a log.
- **Never run `git stash`.** Every worktree of a clone shares one stash stack. Use a temporary commit or a second worktree.
- **Existing tests:** never edit, weaken, skip or delete one to make it pass. If one fails, fix the code, or stop and report the root cause.
- **Commits:** small, present tense, ending `refs #246`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
cd packages/cli && bun run build && node dist/cli.js --help && node dist/cli.js --version
printf '{"spec":{"adapter":"skill","skillPath":"%s"},"input":{}}' "$(cd .. && pwd)/runner/test/fixtures/SKILL.md" | node dist/child-entry.js
```

All of it must pass. The last line runs the bundled child entry under Node, and it must print one JSON line with an `output` object.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a line this packet quotes differs from the file;
- an existing test fails after the runner change, and the cause is not a slip in your own edit;
- a failure survives three different fixes;
- 45 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-09-countersign-cli.md` (on the second machine): the diff summary, the test names, the gate output counts, and the three acceptance lines' output.
