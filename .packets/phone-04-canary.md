# phone-04-canary: the phone page answers the hub's canary, as the runner does (refs #26)

## Goal

The hub now sends a canary to every online offer (#26, D18): `{ t: "canary", offerHash, nonce }` over the runner WebSocket.

- A runner that serves the offer answers `{ t: "canary", offerHash, nonce, sig }`, where `sig` is the seller's EIP-191 `personal_sign` over `canaryMessage(offerHash, nonce)` from `@countersign/core`.
- One that does not serve it answers `{ t: "canary-fail", offerHash, nonce, reason: "not-served" }`.
- An online offer whose runner fails every canary is delisted.

The phone page's runner link (`apps/phone/src/runner/link.ts`) must answer exactly as `packages/runner/src/daemon.ts` does. Otherwise a phone that is online would have its offers delisted.

## Read first

- `packages/core/src/wire.ts`: `canaryMessage`, and the `canary` and `canary-fail` frames in `HubToRunner` and `RunnerToHub`.
- `packages/runner/src/daemon.ts`, the `case "canary"` block. Mirror it exactly.
- `apps/phone/src/runner/link.ts`: `RunnerLink.onFrame`, `send`, and how `this.cfg.skills()` lists the offers that are on.
- `apps/phone/test/skills.test.ts`, the last test: a stand-in hub over `Bun.serve` that sends frames and records every frame the phone sends.

## What to build

1. In `apps/phone/src/runner/link.ts`, add `case "canary"` to `onFrame`.
   - Find the offer in `this.cfg.skills()` by `offerHash`, compared lowercase.
   - **Not found:** send `{ t: "canary-fail", offerHash: frame.offerHash, nonce: frame.nonce, reason: "not-served" }`.
   - **Found:** send `{ t: "canary", offerHash: <the served hash>, nonce: frame.nonce, sig }`, where `sig = await this.cfg.signer.signMessage({ message: canaryMessage(<the served hash>, frame.nonce) })`.
   - Never call `serve`, read the position, open the camera or run `checkOrder` for a canary. A canary proves the key and the link, nothing else.
   - Import `canaryMessage` from `@countersign/core`.
   - Update the protocol lines in the file's header comment.
2. Change nothing else in the phone.

## Tests

Add tests to `apps/phone/test/skills.test.ts` in the same style as the existing stand-in-hub test, or put them in a new file `apps/phone/test/canary.test.ts`.

1. A canary for an offer that is on is answered with `t: "canary"`, the same `offerHash` and `nonce`, and a `sig` that `recoverMessageAddress({ message: canaryMessage(hash, nonce), signature })` recovers to the phone's address. The skill's `serve` is never called.
2. A canary for an offer that is not on, or not known, is answered with `canary-fail` and reason `not-served`.
3. The phone's private key appears in no frame it sends, checked the same way the existing test checks.

## Lease

Touch only these paths. Nothing else.

- `apps/phone/src/runner/link.ts`
- `apps/phone/test/skills.test.ts`, or `apps/phone/test/canary.test.ts` (new)
- `.packets/reports/phone-04-canary.md` (new)

## Constraints

- **No browser of any kind on this machine.** No headless Chrome, Playwright, Puppeteer or screenshot tools.
- **No network beyond `127.0.0.1`** in tests.
- **No new dependency.** Do not edit any `package.json` or `bun.lock`.
- **Do not rewrite, weaken, skip or delete any existing test.** If an existing test breaks, fix the code. If you cannot, stop and write the root cause in the report.
- **No widening:** only the canary answer.
- **Never run `git stash`.** Every worktree of this clone shares one stash stack, on both machines. To set work aside, make a temporary commit or use a second worktree.
- **Do not push, merge, deploy or touch any key.**

## Acceptance

Run this from the worktree root. It must be green:

```
bun install && bun run typecheck && bun test apps/phone
```

Then run the full `bun test` once, and report its pass, skip and fail counts.

## Stop conditions

- If one problem has blocked you for more than 15 minutes, stop, commit what passes, and write the report.
- If the code you need to change is outside the lease, stop and say so in the report.

## Commits and report

- Commit with small present-tense messages, each ending `(refs #26)`, with no trailers.
- Write `.packets/reports/phone-04-canary.md`. It holds what you built, the tests with their counts, and the full-suite counts.
