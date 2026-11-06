# phone-04-canary

## What was built

- `apps/phone/src/runner/link.ts`:
  - imports `canaryMessage` from `@countersign/core`;
  - adds `case "canary"` to `RunnerLink.onFrame`, mirroring `packages/runner/src/daemon.ts`:
    - finds the offer in `this.cfg.skills()` by `offerHash`, compared lowercase;
    - if it is not on, sends `{ t: "canary-fail", offerHash: frame.offerHash, nonce: frame.nonce, reason: "not-served" }`;
    - if it is on, signs `canaryMessage(skill.hash, frame.nonce)` with `this.cfg.signer.signMessage` and sends `{ t: "canary", offerHash: skill.hash, nonce: frame.nonce, sig }`;
  - updates the protocol lines in the header comment.
- A canary only touches `skills()` and the signer. It never calls `serve`, reads the position, opens the camera or runs `checkOrder`.

Nothing else in the phone changed.

## Tests

`apps/phone/test/canary.test.ts` (new) uses the same stand-in `Bun.serve` hub style as the existing phone tests and records every frame the phone sends.

1. A canary for an offer that is on is answered with `t: "canary"`, the same `offerHash` and `nonce`, and a `sig` that `recoverMessageAddress({ message: canaryMessage(hash, nonce), signature })` recovers to the phone's address. The skill's `serve` is never called, and the private key appears in no sent frame (same lowercase substring check as the existing test).
2. Canaries for an offer that is not on and for an unknown offer are both answered with `canary-fail` and `reason: "not-served"`. `serve` is never called, and the key appears in no sent frame.

Acceptance, from the worktree root:

```
bun install && bun run typecheck && bun test apps/phone
# typecheck: pass
# 31 pass, 0 fail, 143 expect() calls, 5 files
```

Full suite:

```
bun test
# 1181 pass, 3 skip, 0 fail, 4384 expect() calls, 138 files
```

## Environment note

This worktree is under `/Users/sailesh`, where a stale `/Users/sailesh/node_modules/@types/node` (20.14.2) is visible to `tsc` and broke typecheck in files untouched by this packet (`Buffer` vs `ArrayBufferView`). The repo's `bun.lock` pins `@types/node` 22.7.5 through `bun-types`; a local `node_modules/@types/node` symlink to that locked copy (install output, not tracked) makes the exact command green. The same source typechecks without the symlink from a path outside `/Users/sailesh` (verified in a temporary worktree). No source, `package.json` or `bun.lock` change was made for this.

No browser, network beyond `127.0.0.1`, key operation, push, merge or deploy was used.
