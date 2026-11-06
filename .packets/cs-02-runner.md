# cs-02-runner — the seller's runner: dial-out daemon, skill adapter, scrubbed child, cli

## Goal

Build `packages/runner`, the seller side. A daemon dials out to the hub over WebSocket, proves it holds the seller key, and serves the seller's offers. Each paid job is input-gated by schema, run in a child process with a scrubbed environment under a time and output-size ceiling, and output-gated by schema. The runner answers with the output and a slip signed by the seller. The first adapter is `skill`: it serves a real `SKILL.md` as guidance text. A CLI publishes skill offers and runs the daemon.

## Lease

You may create or change only these paths:

- `packages/runner/src/**`
- `packages/runner/test/**`
- `.packets/reports/cs-02-runner.md` (your report)

Do not edit any `package.json`, `bun.lock`, `packages/core/**`, `apps/**` or anything else. Do not add dependencies. You have `viem`, `@countersign/core` and Bun built-ins (`Bun.spawn`, `Bun.serve`, `WebSocket`, `bun:test`).

## Read first

- `packages/core/src/wire.ts`: `RUNNER_PATH`, `runnerAuthMessage`, `publishMessage`, `JobOrder`, `HubToRunner`, `RunnerToHub`, `PublishRequest` and `slipBodyFor`.
- `packages/core/src/types.ts`: `Offer` and `SlipBody`.
- `packages/core/src/schema.ts`: `checkSchema`.
- `packages/core/src/slip.ts`: `slipHash` and `slipTypedData`.
- `packages/core/src/canonical.ts`: `canonicalHash`.
- `packages/core/src/offer.ts`: `offerHash` and `assertOffer`.

## What to build

### Files

- `packages/runner/src/skill.ts`: the skill adapter.
  - `readSkill(path): Promise<{name, description, body, sha256}>` parses the YAML front matter at the top of a `SKILL.md`: lines between the first two `---` lines, holding simple `key: value` pairs, and `name` and `description` are required. Do not add a YAML library. `sha256` is the hex SHA-256 of the file bytes (`Bun.CryptoHasher`).
  - `SKILL_INPUT_SCHEMA` is `{type: "object", properties: {question: {type: "string", maxLength: 2000}, section: {type: "string", maxLength: 200}}, additionalProperties: false}`.
  - `SKILL_OUTPUT_SCHEMA` is `{type: "object", properties: {name: {type: "string"}, text: {type: "string"}, sha256: {type: "string", pattern: "^[0-9a-f]{64}$"}}, required: ["name", "text", "sha256"], additionalProperties: false}`.
  - `runSkill(skill, input)` returns `{name, text, sha256}`. When `input.section` is given, `text` is the markdown section whose heading text matches it case-insensitively: from that heading line up to the next heading of the same or higher level. When no heading matches, it throws. Otherwise `text` is the whole body after the front matter.
  - `skillOffer({seller, skill, price, deadline, rails, upstream?, now})` builds the `Offer`:
    - `v: 1`, `title: skill.name`, `summary` from the description cut to 2000 chars, `adapter: "skill"`;
    - `input` and `output` are the two schemas above;
    - `price` is an atomic string, `bond: "0"`, `issuedAt: now`.
- `packages/runner/src/child.ts`: the scrubbed child.
  - `scrubbedEnv(parent)` returns only `PATH` (and `HOME`, set to a temp dir). Nothing named `*KEY*`, `*SECRET*`, `*TOKEN*` or `*PASS*` survives, whatever the parent has.
  - `runInChild(spec: {adapter: "skill", skillPath: string}, input, limits: {timeMs, maxOutputBytes})` spawns `Bun.spawn([process.execPath, <path to child-entry.ts>], {env: scrubbedEnv(process.env), stdin: "pipe", stdout: "pipe", stderr: "pipe"})`, writes `JSON.stringify({spec, input})` to stdin and closes it.
    - Kill the child at `timeMs` and reject with `CeilingError("Refused. The run passed its time ceiling.")`.
    - If stdout is larger than `maxOutputBytes`, kill it and reject with `CeilingError("Refused. The output passed its size ceiling.")`.
    - On a non-zero exit, reject with the child's one-line error message.
- `packages/runner/src/child-entry.ts`: reads stdin, runs `runSkill(await readSkill(spec.skillPath), input)`, and writes `JSON.stringify({output})` to stdout. On error it writes `{error: message}` and exits 1.
- `packages/runner/src/daemon.ts`: `startRunner(cfg): RunnerHandle`.
  - The config is `{hubUrl: string; account: LocalAccount /* viem, the seller key */; served: Array<{offer: Offer; spec: {adapter: "skill"; skillPath: string}}>; limits?: {timeMs?: number /* default 30_000 */; maxOutputBytes?: number /* default 1_000_000 */}; now?: () => number}`.
  - Connect to `hubUrl` with `http` replaced by `ws` (and `https` by `wss`), plus `RUNNER_PATH`.
  - On `challenge`, send `hello {seller: account.address, offers: served offer hashes, nonce, sig: account.signMessage({message: runnerAuthMessage(nonce)})}`.
  - On `ready`, resolve `handle.ready`. On `ping`, send `pong`.
  - On `job`:
    1. Find the served offer by `order.offerHash`. If there is none, send `fail` "Refused. This runner does not serve that offer."
    2. If `now() >= order.deadline`, send `fail` "Refused. The deadline has passed."
    3. Input gate with `checkSchema(offer.input, order.input)`. If it fails, send `fail` "Refused. The input does not match the offer's schema."
    4. `runInChild(...)`. On error, send `fail` with its message.
    5. Output gate with `checkSchema(offer.output, output)`. If it fails, send `fail` "Refused. The output does not match the offer's schema."
    6. Build `body = slipBodyFor(order, account.address, canonicalHash(order.input), canonicalHash(output), now())` and `hash = slipHash(body)`, sign with `sellerSig = account.signTypedData(slipTypedData(body))`, and send `{t: "result", jobId, output, slip: {body, hash, sellerSig}}`.
  - Reconnect on close with backoff 1, 2, 4, 8, 16 and 30 s (capped), and reset after `ready`.
  - `handle.stop()` closes the socket and stops reconnecting.
- `packages/runner/src/publish.ts`: `publishOffer(hubUrl, account, offer)` POSTs `PublishRequest {offer, sig: account.signMessage({message: publishMessage(offerHash(offer))})}` to `${hubUrl}/offers`. It returns the `offerHash` on 200 or 201, and throws with the hub's `message` otherwise.
- `packages/runner/src/cli.ts`, run as `bun packages/runner/src/cli.ts <command>`:
  - The seller key comes only from the environment variable `CS_SELLER_KEY` (0x-prefixed hex). Never print it, and never accept it as an argument.
  - `publish --hub <url> --skill <path/SKILL.md> --price <atomic> [--deadline 120] [--rails escrow] [--upstream-url <url> --licence <id>]` builds the skill offer, publishes it and prints the offer hash.
  - `serve --hub <url> --skill <path> [--skill <path> ...] [same offer flags]` publishes each skill and runs the daemon until SIGINT. It logs one line per job: short jobId, offer title, ok or the refusal.
  - Parse arguments by hand, with no library.
- `packages/runner/src/index.ts`: export `startRunner`, `publishOffer`, `skillOffer`, `readSkill`, `runSkill`, `runInChild`, `scrubbedEnv` and `CeilingError`.

## Tests (`packages/runner/test/`)

- `fixtures/SKILL.md`: a small skill you write yourself, with front matter `name: test-skill` and a one-line `description`, and two `##` sections.
- `skill.test.ts`:
  - parses front matter;
  - `sha256` matches `Bun.CryptoHasher`;
  - a section lookup returns only that section;
  - an unknown section throws;
  - the offer validates with `assertOffer`.
- `child.test.ts`:
  - `scrubbedEnv({PATH: "/bin", CS_SELLER_KEY: "x", AWS_SECRET: "y", GH_TOKEN: "z", DB_PASS: "w"})` keeps only `PATH` and `HOME`;
  - `runInChild` returns the skill output;
  - a `timeMs: 1` ceiling rejects with `CeilingError`;
  - a `maxOutputBytes: 10` ceiling rejects with `CeilingError`.
- `daemon.test.ts` runs a fake hub (`Bun.serve({port: 0, fetch(req, server) { server.upgrade(req) }, websocket: {...}})`) that:
  - sends `challenge`, checks the `hello` signature with viem `recoverMessageAddress` and sends `ready`;
  - sends a `job` whose `JobOrder` targets the fixture offer, and asserts the `result`:
    - `slip.hash === slipHash(slip.body)`;
    - `recoverTypedDataAddress({...slipTypedData(slip.body), signature: slip.sellerSig}) === seller`;
    - `body.outputHash === canonicalHash(output)`;
    - the output passes `SKILL_OUTPUT_SCHEMA`;
  - sends a job with bad input and asserts `fail` with the input refusal;
  - sends a job past its deadline and asserts `fail`;
  - sends a job for an unknown offer and asserts `fail`.

## Constraints

- TypeScript strict. No `any`.
- The seller key never reaches the child process, a log line or argv.
- Keep each file under about 250 lines.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/runner && bun test && forge test
```

Every command passes, with no skipped or todo tests.

## Stop conditions

- You need to edit anything outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit on your branch with small present-tense messages. Write `.packets/reports/cs-02-runner.md` with:

- what you built;
- the acceptance output, with the last lines of each command;
- anything you could not do.

Do not push, merge or deploy.
