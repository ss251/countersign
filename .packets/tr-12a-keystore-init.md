# tr-12a: countersign 0.1.1: the tool holds the agent's key (keystore, init, key loading), and the DX fixes (refs #246)

**Design: decided.** cs-truth wrote this on Opus for STEER-0240: no user ever handles a raw private key. Implement exactly what follows. Nothing here is left for you to choose. **This is a secrets surface: no code path may print, log or put into an error message a key's value.** Work fast: the tarballs are due within the hour. A parallel packet, tr-12b, writes `address`, `balance` and `withdraw` in `packages/cli/src/wallet.ts`. You write only a placeholder of that file (section 4).

## 1. `packages/cli/src/keystore.ts` (new), exactly

```ts
/**
 * The agent's own key, held by the tool (STEER-0240). The person never sees it, pastes it or exports it.
 * Nothing here prints, logs or throws a key's value.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Role = "buyer" | "seller";
export const ROLES: Role[] = ["buyer", "seller"];
export const NO_KEY_MESSAGE = "No countersign key yet. Run: npx -y @countersign-hub/cli init";

export interface KeyBackend {
  readonly kind: "keychain" | "file";
  /** Where a role's key lives, for messages. Never the key. */
  where(role: Role): string;
  read(role: Role): string | null;
  write(role: Role, key: string): void;
}

export function defaultKeyDir(): string {
  return join(homedir(), ".config", "countersign");
}

export function fileBackend(dir: string = defaultKeyDir()): KeyBackend {
  return {
    kind: "file",
    where: (role) => join(dir, `${role}.key`),
    read(role) {
      const path = join(dir, `${role}.key`);
      if (!existsSync(path)) return null;
      const value = readFileSync(path, "utf8").trim();
      return value === "" ? null : value;
    },
    write(role, key) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      const path = join(dir, `${role}.key`);
      writeFileSync(path, `${key}\n`, { mode: 0o600 });
      chmodSync(path, 0o600);
    },
  };
}

export type SecurityRun = (args: string[], input?: string) => string;

const securityRun: SecurityRun = (args, input) =>
  execFileSync("/usr/bin/security", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

/** macOS login Keychain, service "countersign", account = role. The key goes in through stdin, never argv. */
export function keychainBackend(run: SecurityRun = securityRun): KeyBackend {
  return {
    kind: "keychain",
    where: (role) => `the macOS login Keychain (service countersign, account ${role})`,
    read(role) {
      try {
        const value = run(["find-generic-password", "-s", "countersign", "-a", role, "-w"]).trim();
        return value === "" ? null : value;
      } catch {
        return null;
      }
    },
    write(role, key) {
      run(["-i"], `add-generic-password -U -s countersign -a ${role} -w ${key}\n`);
    },
  };
}

/** Keychain on macOS, the 0600 file elsewhere. COUNTERSIGN_KEYSTORE=file forces the file. */
export function defaultBackend(env: Record<string, string | undefined> = process.env): KeyBackend {
  if (env.COUNTERSIGN_KEYSTORE === "file") return fileBackend();
  if (process.platform === "darwin" && existsSync("/usr/bin/security")) return keychainBackend();
  return fileBackend();
}

const OVERRIDE: Record<Role, string> = { buyer: "CS_BUYER_KEY", seller: "CS_SELLER_KEY" };

/**
 * The role's key: the CI override (CS_BUYER_KEY / CS_SELLER_KEY) first, then the Keychain on macOS,
 * then the file. Null when there is none. Never logs.
 */
export function loadKey(
  role: Role,
  env: Record<string, string | undefined> = process.env,
  backends: KeyBackend[] = loadOrder(env),
): string | null {
  const override = env[OVERRIDE[role]]?.trim();
  if (override !== undefined && override !== "") return override;
  for (const backend of backends) {
    const value = backend.read(role);
    if (value !== null) return value;
  }
  return null;
}

function loadOrder(env: Record<string, string | undefined>): KeyBackend[] {
  if (env.COUNTERSIGN_KEYSTORE === "file") return [fileBackend()];
  if (process.platform === "darwin" && existsSync("/usr/bin/security")) return [keychainBackend(), fileBackend()];
  return [fileBackend()];
}
```

## 2. `packages/cli/src/init.ts` (new), exactly

```ts
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { fileBackend, ROLES, type KeyBackend, type Role } from "./keystore.ts";

export const CIRCLE_FAUCET = "https://faucet.circle.com";
export const WBT_FAUCET = "https://faucet.testnet.whitechain.io";

export interface InitDeps {
  backend: KeyBackend;
  write: (text: string) => void;
  newKey?: () => `0x${string}`;
}

/** `countersign init [--role buyer|seller] [--force]`: create and store the agent's keys. Prints only addresses and where they live. */
export async function runInit(args: string[], deps: InitDeps): Promise<void> {
  const at = args.indexOf("--role");
  const named = at === -1 ? undefined : args[at + 1];
  if (at !== -1 && named !== "buyer" && named !== "seller") {
    process.stderr.write("countersign init --role takes buyer or seller.\n");
    process.exitCode = 2;
    return;
  }
  const roles: Role[] = named === undefined ? ROLES : [named as Role];
  const force = args.includes("--force");
  const newKey = deps.newKey ?? generatePrivateKey;
  for (const role of roles) {
    const existing = deps.backend.read(role);
    if (existing !== null && !force) {
      const address = privateKeyToAccount(existing as `0x${string}`).address;
      deps.write(`${role}: a key already exists in ${deps.backend.where(role)}. Address ${address}. Use --force to replace it.\n`);
      continue;
    }
    const key = newKey();
    let backend = deps.backend;
    try {
      backend.write(role, key);
    } catch {
      backend = fileBackend();
      backend.write(role, key);
    }
    const address = privateKeyToAccount(key).address;
    deps.write(
      `${role}: ${address}\n` +
        `  Stored in ${backend.where(role)}. countersign never prints it.\n` +
        `  Fund it: send testnet USDC to ${address} (Circle faucet: ${CIRCLE_FAUCET}).\n` +
        `  For Whitechain, get test WBT for gas at ${WBT_FAUCET}.\n`,
    );
  }
}
```

## 3. `packages/cli/src/cli.ts`: these changes only

1. Change `export const VERSION = "0.1.0";` to `export const VERSION = "0.1.1";`.
2. Add these imports at the top:
   ```ts
   import { runInit } from "./init.ts";
   import { defaultBackend, loadKey, NO_KEY_MESSAGE, type Role } from "./keystore.ts";
   import { runWallet } from "./wallet.ts";
   ```
3. Directly below `VERSION`, add:
   ```ts
   /** The production hub, on testnet. `--hub` wins, then `CS_HUB`. */
   export const DEFAULT_HUB = "https://hub-production-e85e.up.railway.app";

   /** `--hub` wins, then `CS_HUB`, then the production hub. */
   export function withHub(args: string[], env: Record<string, string | undefined> = process.env): string[] {
     if (args.some((arg) => arg === "--hub" || arg.startsWith("--hub="))) return args;
     const fromEnv = env.CS_HUB?.trim();
     return [...args, "--hub", fromEnv !== undefined && fromEnv !== "" ? fromEnv : DEFAULT_HUB];
   }

   /** Load the stored key for this role into this process's env, where the delegated CLI reads it. False when there is none. */
   export function useStoredKey(role: Role, env: Record<string, string | undefined> = process.env): boolean {
     const name = role === "seller" ? "CS_SELLER_KEY" : "CS_BUYER_KEY";
     const key = loadKey(role, env);
     if (key === null) return false;
     env[name] = key;
     return true;
   }

   export const COMMAND_USAGE: Record<string, string> = {
     init: `Usage: countersign init [--role buyer|seller] [--force]
     Creates the agent's own keys and stores them: the macOS Keychain, or ~/.config/countersign at mode 0600.
     It prints only each address and where it lives. Fund the address, then buy or sell.
   `,
     address: `Usage: countersign address\n  Prints the buyer and seller addresses.\n`,
     balance: `Usage: countersign balance\n  USDC on Arc and USDT on Whitechain, for each stored key.\n`,
     withdraw: `Usage: countersign withdraw --to <your address> [--amount <usd>] [--role buyer|seller]\n  Sends the agent's USDC on Arc back to your own wallet.\n`,
     sell: `Usage:
     countersign sell skill <SKILL.md> --price <atomic> [--hub <url>] [runner flags]
     countersign sell openapi --spec <spec.json> --operation <id> --price <atomic> [--base-url <url>] [--hub <url>] [runner flags]
     Add --publish-only to list the offer without serving it. The runner dials out to the hub, so you open no port.
   `,
     discover: `Usage: countersign discover [--catalogue <url|circle> [query]] [--category <c>] [--limit <n>] [--hub <url>] [--state <dir>]\n`,
     buy: `Usage: countersign buy <offerHash|callUrl> --input '<json>' [--rail <id>] [--approve] [--approvals hub] [--hub <url>] [--state <dir>]
     Set an envelope first: countersign envelope set --cap <usd> --per-merchant <usd>.
   `,
     envelope: `Usage: countersign envelope show | set --cap <usd> --per-merchant <usd> [--ask-above <usd>] [--revoke | --unrevoke] [--state <dir>]\n`,
     journal: `Usage: countersign journal [--state <dir>]\n`,
     verify: `Usage: countersign verify <slip.json> [--rpc <url>] [--mirror <url>]\n`,
     mcp: `Usage: countersign mcp [--hub <url>] [--state <dir>] [--rpc <url>]\n  The buyer MCP server over stdio, for Claude, Cursor or any MCP client.\n`,
   };
   ```
4. In `USAGE`:
   - replace every sentence that names `CS_SELLER_KEY` or `CS_BUYER_KEY` with nothing (delete those sentences);
   - add these lines at the very end, before the closing backtick:
     ```
     Start here: countersign init, then fund the printed address, then buy or sell, then countersign withdraw.
     The hub defaults to https://hub-production-e85e.up.railway.app (testnet); CS_HUB or --hub changes it. Every subcommand answers --help.
     Advanced (CI only): CS_BUYER_KEY and CS_SELLER_KEY override the stored keys.
     ```
5. Replace `DEFAULT_DEPS` with exactly:
   ```ts
   export const DEFAULT_DEPS: CliDeps = {
     runner: async (argv) => {
       if (!useStoredKey("seller")) {
         process.stderr.write(`${NO_KEY_MESSAGE}\n`);
         process.exitCode = 1;
         return;
       }
       await runnerMain(withHub(argv));
     },
     loadBuyer: async () => {
       const [command = "", ...rest] = process.argv.slice(2);
       const needsKey = command === "buy" || command === "journal" || (command === "envelope" && rest[0] === "set");
       if (!useStoredKey("buyer") && needsKey) {
         process.stderr.write(`${NO_KEY_MESSAGE}\n`);
         process.exitCode = 1;
         return;
       }
       process.argv = [process.argv[0] ?? "node", "countersign", ...withHub([command, ...rest])];
       return import("../../buyer/src/cli.ts");
     },
     loadVerify: () => import("../../verify/src/cli.ts"),
     // A literal path into this repository: the bundle carries the server, and no package name is resolved.
     loadMcp: async () => {
       useStoredKey("buyer");
       return import("../../mcp/src/main.ts");
     },
   };
   ```
6. In `run`, directly after the `--version` block, add:
   ```ts
   if ((rest.includes("--help") || rest.includes("-h")) && COMMAND_USAGE[command] !== undefined) {
     process.stdout.write(COMMAND_USAGE[command] as string);
     return;
   }
   if (command === "init") {
     await runInit(rest, { backend: defaultBackend(), write: (text) => process.stdout.write(text) });
     return;
   }
   if (command === "address" || command === "balance" || command === "withdraw") {
     await runWallet(command, rest, { loadKey: (role) => loadKey(role), write: (text) => process.stdout.write(text) });
     return;
   }
   ```

Nothing else in `cli.ts` changes. With injected deps, `run` behaves as before, so the existing `cli.test.ts` passes unedited.

## 4. `packages/cli/src/wallet.ts` (new): a placeholder that tr-12b replaces

```ts
import type { Role } from "./keystore.ts";

export interface WalletDeps {
  loadKey: (role: Role) => string | null;
  write: (text: string) => void;
}

/** address | balance | withdraw. tr-12b writes the real one. */
export async function runWallet(command: "address" | "balance" | "withdraw", _args: string[], _deps: WalletDeps): Promise<void> {
  process.stderr.write(`countersign ${command} is not built yet.\n`);
  process.exitCode = 2;
}
```

## Lease

- new: `packages/cli/src/keystore.ts`, `packages/cli/src/init.ts`, `packages/cli/src/wallet.ts` (the placeholder), `packages/cli/test/keystore.test.ts`;
- `packages/cli/src/cli.ts` (section 3).

Read only: everything else, including `packages/cli/test/cli.test.ts`. Never commit `bun.lock`. `viem` is already a dependency of the runner.

## Tests (`packages/cli/test/keystore.test.ts`, bun:test, no network)

Use a fresh temp directory per test, from `mkdtempSync(join(tmpdir(), "cs-keys-"))`. Use the fixed test key `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` as `newKey`.

1. **File round trip.** `fileBackend(dir).write("buyer", K)`, then `read("buyer")` returns `K`. The file's mode is `0o600` and the directory's is `0o700`. Use `statSync(...).mode & 0o777`.
2. **Keychain round trip, mocked.** A fake `SecurityRun` records its calls and keeps a map.
   - `write` passes the key only in `input`: no element of any call's `args` contains the key.
   - `read` returns it.
3. **`loadKey`.**
   - The override wins: `loadKey("buyer", { CS_BUYER_KEY: K }, [])` is `K`.
   - Then the backends in order.
   - `null` when there is none.
4. **`init` creates and is idempotent.** `runInit([], { backend, write, newKey })` with a file backend:
   - it writes both roles;
   - its output names each address and the faucet, and **does not contain `K.slice(2)` in any case**.
   - A second run says `already exists` and keeps the same key. `--force` replaces it, since `newKey` can return a second fixed key for that case.
   - `--role buyer` writes only the buyer key, and `--role nope` sets exit code 2.
5. **No key.** `useStoredKey("buyer", {})`, with `COUNTERSIGN_KEYSTORE=file` and `HOME` pointed at an empty temp dir, is `false`. `NO_KEY_MESSAGE` is exactly `No countersign key yet. Run: npx -y @countersign-hub/cli init`.
6. **Redaction.** Capture `process.stdout.write` and `process.stderr.write`.
   - Run `init`, a second `init`, and `run(["init","--help"])`.
   - Run `run(["--help"])`.
   - The concatenated output never contains the key's 64 hex digits, in either case.
7. **DX.**
   - `withHub(["discover"], {})` ends with `"--hub", DEFAULT_HUB`. `CS_HUB` wins over the default, and an explicit `--hub` comes back unchanged.
   - `run(["buy","--help"], deps)` and `run(["discover","-h"], deps)` print their `COMMAND_USAGE` and call no dep.
   - `VERSION` is `"0.1.1"`.

Every existing test still passes unedited.

## Constraints

- **No browser** of any kind.
- **No network** in tests.
- **Never print, log or put into an error message a key's value**, in code, tests or the report.
- **Never touch the real `~/.config/countersign` or the real Keychain in tests:** use temp dirs and the mocked `SecurityRun`.
- **Never run `git stash`.**
- **Existing tests:** never edit, weaken, skip or delete one.
- **Commits:** small, present tense, ending `refs #246`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
cd packages/cli && bun run build && node dist/cli.js --version && node dist/cli.js init --help && node dist/cli.js buy -h
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- an existing test fails;
- a failure survives three different fixes;
- 20 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-12a-keystore-init.md` (on the second machine): the diff summary, the test names and the gate counts. Write no key value in it.
