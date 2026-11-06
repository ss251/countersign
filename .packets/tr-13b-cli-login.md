# tr-13b: countersign 0.1.1: login, logout and whoami over the hub's device flow, and the DX fixes (refs #246)

**Design: decided.** cs-truth wrote this on Opus for STEER-0245. Implement exactly what follows. Nothing here is left for you to choose. **This is a secrets surface: the session token is never printed, logged or put into an error message.** The hub half, tr-13a, adds these routes:
- `POST /cli/login/start`, which returns `{code, deviceSecret, verifyUrl, interval, expiresAt}`;
- `POST /cli/login/poll {deviceSecret}`, which returns `{status:"pending"}` or `{status:"approved", sessionToken, address, expiresAt}`;
- `GET /cli/session`, with `Authorization: Bearer <token>`, which returns `{address, expiresAt}`;
- `POST /cli/logout`, with Bearer.

## 1. `packages/cli/src/session.ts` (new)

```ts
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const NOT_SIGNED_IN = "Not signed in. Run: npx -y @countersign-hub/cli login";

export interface Session { token: string; hub: string; address: string; expiresAt: number }

export interface SessionBackend {
  readonly kind: "keychain" | "file";
  where(): string;
  read(): Session | null;
  write(session: Session): void;
  clear(): void;
}

export type SecurityRun = (args: string[], input?: string) => string;
const securityRun: SecurityRun = (args, input) =>
  execFileSync("/usr/bin/security", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

function parse(text: string): Session | null {
  try {
    const value = JSON.parse(text) as Partial<Session>;
    if (typeof value.token === "string" && typeof value.hub === "string" && typeof value.address === "string" && typeof value.expiresAt === "number") {
      return value as Session;
    }
  } catch {}
  return null;
}

export function fileSessionBackend(dir: string = join(homedir(), ".config", "countersign")): SessionBackend {
  const path = join(dir, "session.json");
  return {
    kind: "file",
    where: () => path,
    read: () => (existsSync(path) ? parse(readFileSync(path, "utf8")) : null),
    write(session) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      writeFileSync(path, `${JSON.stringify(session)}\n`, { mode: 0o600 });
      chmodSync(path, 0o600);
    },
    clear() {
      rmSync(path, { force: true });
    },
  };
}

/** macOS login Keychain, service countersign, account session. The value goes in through stdin, hex-encoded, never argv. */
export function keychainSessionBackend(run: SecurityRun = securityRun): SessionBackend {
  return {
    kind: "keychain",
    where: () => "the macOS login Keychain (service countersign, account session)",
    read() {
      try {
        const hex = run(["find-generic-password", "-s", "countersign", "-a", "session", "-w"]).trim();
        return hex === "" ? null : parse(Buffer.from(hex, "hex").toString("utf8"));
      } catch {
        return null;
      }
    },
    write(session) {
      const hex = Buffer.from(JSON.stringify(session), "utf8").toString("hex");
      run(["-i"], `add-generic-password -U -s countersign -a session -w ${hex}\n`);
    },
    clear() {
      try {
        run(["delete-generic-password", "-s", "countersign", "-a", "session"]);
      } catch {}
    },
  };
}

/** Keychain on macOS, the 0600 file elsewhere. COUNTERSIGN_KEYSTORE=file forces the file. */
export function defaultSessionBackend(env: Record<string, string | undefined> = process.env): SessionBackend {
  if (env.COUNTERSIGN_KEYSTORE === "file") return fileSessionBackend();
  if (process.platform === "darwin" && existsSync("/usr/bin/security")) return keychainSessionBackend();
  return fileSessionBackend();
}

/** The stored session, if it has not expired. */
export function loadSession(backend: SessionBackend = defaultSessionBackend(), now = Math.floor(Date.now() / 1000)): Session | null {
  const session = backend.read();
  return session !== null && session.expiresAt > now ? session : null;
}
```

## 2. `packages/cli/src/login.ts` (new)

`export interface LoginDeps { backend: SessionBackend; hub: string; write: (t: string) => void; fetchImpl?: typeof fetch; open?: (url: string) => void; sleep?: (ms: number) => Promise<void>; now?: () => number; balances?: (address: string) => Promise<string> }`

- **`runLogin(args, deps)`.**
  - POST `${hub}/cli/login/start`. Write `Open this link and sign in: <verifyUrl>` and `The page will show this code: <code>`, then call `open(verifyUrl)`, ignoring errors.
  - The default `open` uses `spawn("open" | "xdg-open" | "cmd", ...)` detached.
  - Poll `POST /cli/login/poll {deviceSecret}` every `interval` seconds until `expiresAt`:
    - `approved`: `backend.write({token: sessionToken, hub, address, expiresAt})`, then write:
      `Signed in. Your agent wallet: <address>`;
      `Fund it: send testnet USDC to <address> (Circle faucet: https://faucet.circle.com).`;
      `For Whitechain, get test WBT for gas at https://faucet.testnet.whitechain.io.`;
      `The session lasts 7 days; countersign logout ends it.`
    - expired, a 410, or time is up: stderr `The login expired. Run countersign login again.`, exit code 1.
- **`runLogout(args, deps)`.**
  - If there is a session, POST `/cli/logout` with Bearer and ignore a network failure. Always call `backend.clear()`, and write `Signed out.`.
  - With no session, write `Not signed in.`
- **`runWhoami(args, deps)`.**
  - With no session: stderr `NOT_SIGNED_IN`, exit code 1.
  - Otherwise GET `/cli/session` with Bearer. A 401 gives `NOT_SIGNED_IN` and exit code 1.
  - Otherwise write `Signed in as <address> until <ISO date of expiresAt>`.
  - Then, when `deps.balances` is given, write its result. Its default reads USDC on Arc (5042002, `0x3600000000000000000000000000000000000000`, rpc `https://rpc.testnet.arc.network`) and USDT on Whitechain (1874, `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, rpc `https://rpc.ankr.com/whitechain_testnet`) with viem `readContract` `balanceOf`. It writes `x USDC on Arc, y USDT on Whitechain`, and `unavailable` per chain on error.

## 3. `packages/cli/src/cli.ts`: these changes only

1. `VERSION` becomes `"0.1.1"`.
2. Add `export const DEFAULT_HUB = "https://hub-production-e85e.up.railway.app";` and `withHub(args, env = process.env)`. `--hub` or `--hub=` wins, then `CS_HUB`, then `DEFAULT_HUB`, appended as `"--hub", value`.
3. Add `COMMAND_USAGE: Record<string, string>` with one usage block each for `login`, `logout`, `whoami`, `sell`, `discover`, `buy`, `envelope`, `journal`, `verify` and `mcp`.
   - The flags are as today.
   - `login` reads: `Usage: countersign login\n  Opens a sign-in link; your agent wallet is a Privy server wallet, so no key is ever on this machine.\n`.
4. **`useSession(env = process.env)`.** If `CS_BUYER_KEY` or `CS_SELLER_KEY` is set, return `true`: that is the CI override, and the delegated code uses it. Otherwise, with `loadSession()` non-null, set `env.CS_SESSION = token`, and `env.CS_HUB = session.hub` unless `CS_HUB` is already set, and return `true`. Otherwise return `false`.
5. **In `DEFAULT_DEPS`:**
   - `runner`: if `!useSession()`, stderr `NOT_SIGNED_IN` and exit code 1. Otherwise call `runnerMain(withHub(argv))`.
   - `loadBuyer`: call `useSession()`. If it is false and the command is `buy`, `journal` or `envelope set`, stderr `NOT_SIGNED_IN` and exit code 1. Otherwise set `process.argv` with `withHub` and import the buyer CLI as today.
   - `loadMcp`: call `useSession()`, never block, then import as today.
   - `loadVerify`: unchanged.
6. **In `run`, after `--version`:**
   - if `rest` holds `--help` or `-h` and `COMMAND_USAGE[command]` exists, print it and return;
   - `login`, `logout` and `whoami` call `runLogin`, `runLogout` and `runWhoami`. Their deps are `{ backend: defaultSessionBackend(), hub: withHub([]).at(-1)!, write: stdout }`.
7. **`USAGE`:**
   - drop every sentence naming `CS_SELLER_KEY` or `CS_BUYER_KEY`;
   - add at the end: `Start here: countersign login, then fund the printed address, then buy or sell.`, then the default-hub line, then `Advanced (CI only): CS_BUYER_KEY and CS_SELLER_KEY sign locally instead.`

With injected deps, `run` behaves as before, so `cli.test.ts` passes unedited.

## Lease

- new: `packages/cli/src/session.ts`, `packages/cli/src/login.ts`, `packages/cli/test/login.test.ts`;
- `packages/cli/src/cli.ts` (section 3).

Read only: everything else. Never commit `bun.lock`.

## Tests (`packages/cli/test/login.test.ts`, no network: a fake `fetchImpl`, temp dirs, a mocked `SecurityRun`)

1. **Session storage.**
   - File round trip: mode `0o600` in a `0o700` directory.
   - Keychain round trip: no element of any `args` contains the token, and the hex rides in `input`.
   - An expired session reads as `null` through `loadSession`.
2. **`login`.** The fake hub answers start, then pending once, then approved.
   - The session is saved.
   - The output names the address, `https://faucet.circle.com` and `faucet.testnet.whitechain.io`, and never contains the token.
   - A 410 from poll gives exit code 1.
3. **`logout`** clears the backend, and POSTs `/cli/logout` with the Bearer.
4. **`whoami`.**
   - Signed in, it writes the address and the injected balances.
   - With no session, it writes `Not signed in. Run: npx -y @countersign-hub/cli login` and sets exit code 1.
5. **`useSession`.**
   - It sets `CS_SESSION` and `CS_HUB` from a stored session.
   - It returns `true` and touches nothing when `CS_BUYER_KEY` is set.
   - It returns `false` with neither.
6. **DX.**
   - `withHub` precedence.
   - `run(["buy","--help"], deps)` prints `COMMAND_USAGE.buy` and calls no dep.
   - `VERSION` is `"0.1.1"`.
7. **Redaction.** Across cases 2 to 5, captured stdout and stderr never contain the token.

## Constraints

- **No browser** in tests: inject `open`.
- **No network** in tests.
- **Never print or log the session token.**
- **Never touch the real Keychain or `~/.config/countersign` in tests.**
- **Never run `git stash`.**
- **Existing tests:** never edit, weaken, skip or delete one.
- **Commits:** small, present tense, ending `refs #246`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
cd packages/cli && bun run build && node dist/cli.js --version && node dist/cli.js login --help && node dist/cli.js buy -h
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a failure survives three different fixes;
- 35 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-13b-cli-login.md` (on the second machine): the diff summary, the test names and the gate counts. Write no secret in it.
