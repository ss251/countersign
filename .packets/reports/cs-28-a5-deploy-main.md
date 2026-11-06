# cs-28-a5-deploy-main: production runs only main's commit, and /healthz names it (STEER-2130 A5)

## Diff summary

- `deploy/railway/deploy-hub.sh`: default ref is `origin/main`; fetches `origin main`, resolves
  `want` (`origin/main`) and `full` (`$ref^{commit}`), refuses anything that differs with the exact
  line on stderr and exit 1; stages `git archive "$full"`, writes the full commit as one line to
  `COMMIT` in the stage. `DRY_RUN=1`, the Dockerfile copy, the size line and the `railway up
  --message "hub $sha"` are unchanged. Usage comment updated.
- `apps/hub/src/app.ts`: `HubDeps.commit?: string` with its doc comment; `/healthz` gains
  `commit: deps.commit ?? null` as the key after `ok`. Nothing else in the route changed.
- `apps/hub/src/index.ts`: reads the commit once at startup from `HUB_COMMIT` (trimmed), else
  `COMMIT` in `process.cwd()` (trimmed, missing file treated as no value); keeps it only when it
  matches `/^[0-9a-f]{40}$/`; logs `[hub] commit <first 7>` or `[hub] commit unknown`; passes it to
  `createHub` as `...(commit ? { commit } : {})`.
- `apps/hub/test/healthz-commit.test.ts` (new): `createHub` with a store; with
  `commit: "a".repeat(40)` the `/healthz` body has that commit, without it the body's `commit` is
  `null`.
- `docs/deploy.md`: the hub line in "Deploying by hand" now names `git archive origin/main` and the
  refusal; the `deploy-hub.sh` bullet now states it deploys only `origin/main`'s exact commit and
  that the running hub reports it as `commit` on `/healthz`.

No existing test was edited; no dependencies were added; `deploy/railway/deploy-relay.sh` was not
touched.

## Dry runs

`DRY_RUN=1 bash deploy/railway/deploy-hub.sh`:

```
staged hub at origin/main (a48c28b), 6.0M
DRY_RUN=1: not uploading. Stage left at /var/folders/nc/j5wdfhws2q56jzdcj_jkdvww0000gn/T//countersign-hub.yQUJqh
```

Exit 0; the stage was deleted afterwards.

`DRY_RUN=1 bash deploy/railway/deploy-hub.sh HEAD`:

```
Refused. Production runs only main's commit: HEAD is 98e1e1fab6d0ea3ad220f59bb300d39c9f65785c, origin/main is a48c28b5a417e4c2e899268d1ea4040df5e9db1f.
```

Exit 1; nothing was staged or uploaded.

## Final counts

- `bun test`: 1159 pass, 3 skip, 0 fail; 1162 tests across 134 files.
- `bun test apps/hub`: 170 pass, 0 fail; 883 expect() calls across 18 files.
- `forge test`: 47 tests passed, 0 failed, 0 skipped across 5 suites.
- `bun run typecheck`: clean.
