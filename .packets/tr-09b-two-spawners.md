# tr-09b: the runner's job child keeps Bun.spawn under Bun and uses node:child_process elsewhere (refs #246)

**Design: decided.** cs-truth wrote this on Opus after tr-09 stopped correctly at its stop condition. Its decision is `docs/decisions.md` "D22, amended", which is already committed in this worktree. Implement exactly what follows. Nothing here is left for you to choose.

## Where you start

This worktree holds tr-09's finished work, uncommitted: `packages/cli/` and the four runner files. One existing test fails, `packages/runner/test/children.test.ts` > "the child env carries COUNTERSIGN_LINEAGE and no other new variable". It watches the env through a wrapper around `Bun.spawn`, and tr-09's `runInChild` no longer calls `Bun.spawn`. That test stays unedited. The fix is in `child.ts`.

## Step 1: commit tr-09's work first, as it is

Make these commits, in this order. Never commit `bun.lock`: leave it modified and uncommitted.
1. `packages/runner/src/cli.ts`, `packages/runner/src/skill.ts` and `packages/runner/src/child-entry.ts`: `the runner reads files, hashes and stdin through node APIs and exports main(argv) (refs #246)`.
2. `packages/cli/`: `add the countersign CLI, which delegates to the runner, buyer, verifier and MCP server (refs #246)`.

Do not commit `child.ts` yet: step 2 changes it.

## Step 2: `packages/runner/src/child.ts`

Keep the imports tr-09 added (`spawn`, `existsSync`, `fileURLToPath`) and `childEntryPath()`. Replace the whole `runInChild` function with exactly this, and add the types and helpers after it:

```ts
/** How runInChild starts its child: Bun.spawn under Bun, whose tests observe that call; node:child_process anywhere else. */
export type ChildSpawner = "bun" | "node";

export function defaultSpawner(): ChildSpawner {
  return typeof (globalThis as { Bun?: unknown }).Bun === "undefined" ? "node" : "bun";
}

interface ChildRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  oversized: boolean;
}

/** Run one job in the child entry process and return its output. */
export async function runInChild(
  spec: ChildSpec,
  input: unknown,
  limits: ChildLimits,
  lineage?: string,
  spawner: ChildSpawner = defaultSpawner(),
): Promise<unknown> {
  const env = scrubbedEnv(process.env, lineage);
  const request = JSON.stringify({ spec, input });
  const run =
    spawner === "bun" ? await runWithBun(env, request, limits) : await runWithNode(env, request, limits);

  if (run.timedOut) throw new CeilingError("Refused. The run passed its time ceiling.");
  if (run.oversized) throw new CeilingError("Refused. The output passed its size ceiling.");
  if (run.exitCode !== 0) throw new Error(childError(run.stdout, run.stderr, run.exitCode));

  const parsed = parseJson(run.stdout);
  if (!isRecord(parsed) || !("output" in parsed)) {
    throw new Error("The child returned no output.");
  }
  return parsed.output;
}

async function runWithBun(
  env: Record<string, string>,
  request: string,
  limits: ChildLimits,
): Promise<ChildRun> {
  const proc = Bun.spawn([process.execPath, childEntryPath()], {
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    proc.stdin.write(request);
    await proc.stdin.end();
  } catch {
    // The child can exit before it reads its input; its exit decides the result.
  }

  let timedOut = false;
  let oversized = false;
  let size = 0;
  const chunks: Uint8Array[] = [];
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, limits.timeMs);

  const reader = proc.stdout.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limits.maxOutputBytes) {
        oversized = true;
        proc.kill();
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
  }

  const stderr = await new Response(proc.stderr).text().catch(() => "");
  const exitCode = await proc.exited;
  return { exitCode, stdout: decode(chunks), stderr, timedOut, oversized };
}

function runWithNode(env: Record<string, string>, request: string, limits: ChildLimits): Promise<ChildRun> {
  return new Promise<ChildRun>((resolve) => {
    const proc = spawn(process.execPath, [childEntryPath()], { env, stdio: ["pipe", "pipe", "pipe"] });
    let timedOut = false;
    let oversized = false;
    let size = 0;
    let settled = false;
    const chunks: Uint8Array[] = [];
    const errorChunks: Uint8Array[] = [];
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, limits.timeMs);
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout: decode(chunks), stderr: decode(errorChunks), timedOut, oversized });
    };
    proc.once("error", () => finish(1));
    proc.once("close", (code) => finish(code ?? 1));
    // The child can exit before it reads its input; its exit decides the result.
    proc.stdin.on("error", () => undefined);
    proc.stdin.end(request);
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
  });
}
```

`decode`, `parseJson`, `childError`, `firstLine`, `isRecord`, `scrubbedEnv`, `CeilingError` and `ChildLimits` stay as they are. Nothing else in the runner changes.

Commit: `the job child keeps Bun.spawn under Bun and spawns through node:child_process elsewhere (refs #246)`.

## Step 3: `packages/runner/test/child-node.test.ts` (new)

Copy `packages/runner/test/child.test.ts`'s imports, `FIXTURE` and its three `runInChild` cases. Pass `undefined` as `lineage` and `"node"` as `spawner` in each, so they run the Node path under Bun. Add one case: `defaultSpawner()` is `"bun"` under bun:test. Call the describe block `runInChild through node:child_process`.

Commit: `test the job child through node:child_process (refs #246)`.

## Lease

- `packages/runner/src/child.ts`: `runInChild` and the new helpers only;
- `packages/runner/test/child-node.test.ts`: new;
- the commits of tr-09's existing work in step 1.

Read only: everything else, `children.test.ts` and `child.test.ts` included. Never commit `bun.lock`.

## Constraints

- **No browser** of any kind. That means no headless Chrome, no Playwright, no Puppeteer and no screenshot tools.
- **No network** in tests.
- **Never print a key.**
- **Never run `git stash`.** Use a temporary commit or a second worktree.
- **Existing tests:** never edit, weaken, skip or delete one to make it pass.
- **Commits:** small, present tense, ending `refs #246`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
cd packages/cli && bun run build && node dist/cli.js --help && node dist/cli.js --version
printf '{"spec":{"adapter":"skill","skillPath":"%s"},"input":{}}' "$(cd .. && pwd)/runner/test/fixtures/SKILL.md" | node dist/child-entry.js
```

All green, with `children.test.ts` passing unedited.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- an existing test still fails, and the cause is not a slip in your own edit;
- a failure survives three different fixes;
- 25 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-09b-two-spawners.md` (on the second machine): the commits, the test names, the gate output counts, and the three acceptance lines' output.
