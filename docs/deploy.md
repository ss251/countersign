# Deploying countersign

Two services run on Railway in one project, `countersign`:

| Service | What it is | Source | Health |
|---|---|---|---|
| `web` | The console: the static build of `apps/web` behind `apps/web/server.ts` | `apps/web` | `GET /healthz` |
| `hub` | The hub: offers, the x402 challenge, paid calls, slips, the runner link | `apps/hub` and the workspace packages | `GET /healthz` |

The console calls `/hub`, `/relay` and `/merchant-api` on its own origin. `server.ts` forwards them to `HUB_URL`, `RELAY_URL` and `MERCHANT_URL`, so no backend needs CORS for the page. The generated `*.up.railway.app` domains are fixed once they are in the README. Never regenerate them.

## Deploying by hand (today)

From the repository root, with the Railway CLI logged in and linked to the `countersign` project:

```sh
bash apps/web/deploy.sh                    # console: builds apps/web, uploads dist + server.ts
bash deploy/railway/deploy-hub.sh cs/int   # hub: uploads `git archive cs/int`, production dependencies only
```

- `apps/web/deploy.sh` builds with `VITE_HUB_URL=https://hub-production-e85e.up.railway.app` by default, so the console reads the live hub unless a visitor opens it with `?hub=off`. The hub answers CORS for every route the console calls. `VITE_HUB_URL=/hub` builds against the console's same-origin proxy instead. `DRY_RUN=1` stages the upload without sending it.
- `deploy-hub.sh` deploys an exact commit: only committed files, nothing from the working tree.

### Variables

All values live in Railway, never in the repository.

- `web`: `HUB_URL`, plus `RELAY_URL` and `MERCHANT_URL` once the Whitechain services are public.
- `hub`:
  - `PORT`.
  - `HUB_DB`, which points into the service volume mounted at `/data`, so offers, jobs and slips survive redeploys.
  - `HUB_PUBLIC_URL`, `ARC_ESCROW` and `ARC_RPC_URL`.
  - `CS_NETWORK`, left unset (testnet). `mainnet` refuses to boot until [mainnet.md](mainnet.md) is complete.
  - The relayer key, `CS_RELAYER_KEY`. It is set from stdin so it never appears in a command line: `railway variable set CS_RELAYER_KEY --stdin`.

## Target: Railway's GitHub app

- Production follows `main`.
- Each pull request gets an ephemeral environment with its own URL, posted on the pull request and torn down when it closes.
- PR environments and wait-for-CI are on, so nothing red deploys. There are no hand-rolled previews.
- Installing the app on the repository is an account-level permission and needs the owner's approval.

## Preview secrets rule

This holds before any preview environment exists, and for every one after.

1. **A preview hub never holds a key that matters.** It runs in fixture mode or with testnet-only demo keys. It never carries the Whitechain relayer key, a Hedera operator key, the deployer key, or any key that holds funds.
2. **Previews come from a sanitised `preview` environment, never from `production`.** Railway copies the base environment's variables into each PR environment, so the base must not hold anything a preview may not have.
3. **Never put a secret in a `VITE_*` variable.** Vite inlines every `VITE_*` value into the public JavaScript bundle. Once it is pushed, it cannot be taken back. The console's `VITE_*` variables are public paths (`/hub`, `/relay`, `/merchant-api`) and nothing else.

A key that ends up anywhere it should not is rotated at once, not cleaned up afterwards.
