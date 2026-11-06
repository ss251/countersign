# tr-09c: the runner imports viem's accounts statically, so the Node bundle carries them (refs #246)

**Design: decided.** cs-truth wrote this on Opus after a dry run of tr-09's Node bundle outside the repository failed with `Cannot find package '@countersign/core'`. Implement exactly what follows. Nothing here is left for you to choose.

## Why

`sellerAccount()` in `packages/runner/src/cli.ts` loads `viem/accounts` at run time through `createRequire(import.meta.resolve("@countersign/core"))`. A bundle cannot carry a lookup made at run time, so every `countersign sell` fails outside the repository. The comment above it dates from before the runner declared viem. It does now, `cli.ts` already imports `isAddress` from `viem`, and `bond.ts` already imports `privateKeyToAccount` from `viem/accounts` statically.

## Decision (`packages/runner/src/cli.ts` only)

1. Delete `import { createRequire } from "node:module";` and `import { pathToFileURL } from "node:url";`. Nothing else in the file uses them.
2. Directly below `import { isAddress } from "viem";`, add `import { privateKeyToAccount } from "viem/accounts";`.
3. Delete the `AccountsModule` interface and the whole `loadAccounts` function, including its comment.
4. In `sellerAccount`, replace
   ```ts
     const module = await loadAccounts();
     return module.privateKeyToAccount(key as Hex);
   ```
   with
   ```ts
     return privateKeyToAccount(key as Hex);
   ```
   If the typecheck rejects that return type, write `return privateKeyToAccount(key as Hex) as unknown as RunnerAccount;` instead. Make no other change.

## Lease

`packages/runner/src/cli.ts`: the four edits above only. Read only: everything else. Never commit `bun.lock`.

## Constraints

- **No browser** of any kind.
- **No network** in tests.
- **Never print a key.**
- **Never run `git stash`.**
- **Existing tests:** never edit, weaken, skip or delete one.
- **Commits:** one commit, `the runner imports viem's accounts statically, so a Node bundle carries them (refs #246)`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
cd packages/cli && bun run build && ! grep -q '@countersign/core' dist/cli.js && node dist/cli.js --version
```

All green. The bundle must not name `@countersign/core` anywhere.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- the quoted lines differ from the file;
- a failure survives three different fixes;
- 15 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-09c-static-viem.md` (on the second machine): the diff, the gate output counts, and the acceptance output.
