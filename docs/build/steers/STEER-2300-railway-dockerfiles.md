> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# STEER-2300: root-context Dockerfiles for Railway's GitHub builder

From the project lead at about 23:00 IST. This replaces his 22:50 "do not retry": the root cause is found, and it is fixable with one file per service.

**The root cause.** The repo's three Dockerfiles are staging artefacts:
- `apps/web/deploy/Dockerfile` expects `dist` and `server.ts` copied beside it.
- The hub and relay Dockerfiles expect a git-archive snapshot, because their `COPY . .` runs against the staged directory.

Railway's GitHub builder clones the whole repo, so `COPY . .` at the app root gives Railpack nothing to build from.

**The fix: add three NEW root-context Dockerfiles** that build from the repo root. Leave the existing staging Dockerfiles and deploy scripts untouched, and keep the names distinct so the staging ones stay valid.

1. **`deploy/railway/web.Dockerfile`**
   - `FROM oven/bun:1.3.14-slim`, `WORKDIR /app`, `COPY . .`
   - `RUN bun install --frozen-lockfile`, then `bun run --cwd apps/web build`
   - `ENV NODE_ENV=production PORT=8080`
   - `CMD bun apps/web/server.ts`
2. **`deploy/railway/hub.Dockerfile.root`**: the same install, `CMD bun run apps/hub/src/index.ts`, `EXPOSE 8787`.
3. **`deploy/railway/relay.Dockerfile.root`**: the same install, `CMD bun run packages/relay/src/server.ts`, `EXPOSE 8402`.

**Checks the packet must make and paste, without changing the project lead's shape:**
- `apps/web/server.ts` resolves `dist` from the container's cwd or from its own directory. If it resolves from the cwd, set the web image's `WORKDIR` so that `apps/web/dist` is what it serves, and say why in the PR.
- If the default (isolated) linker breaks the build or the start, use `bun install --frozen-lockfile --linker hoisted`, the layout the build machine runs, and say so.
- No secret is baked in. A root `.dockerignore` is added only if it does not change the staging builds' contexts.
- Build each image **on the build machine**, which has a running Docker daemon (the Mac's is not running): `docker build -f deploy/railway/<file> .` from the repo root. Run it under the load rule (the first load number under 24).
- Run each container briefly with test-only environment (no production secrets) and paste the result:
  - the web image's `curl /` returns 200;
  - the hub image's `/healthz` returns 200 (or the precise missing-variable error, if it needs production env to boot);
  - the relay image's `/status`, likewise.

**Owner:** orch-cs. A DeepSeek packet writes the files, cs-w1 reviews them, and they **land on main** as fast as the gate allows. That means a PR into cs/int plus an immediate promotion, or a small PR to main if orch-cs judges that safe.

**Post for the project lead:**
1. The main commit sha.
2. The per-service settings he enters, all with **Builder: Dockerfile** and **Root Directory empty** (the repo root):

| Service | `RAILWAY_DOCKERFILE_PATH` |
|---|---|
| web | `deploy/railway/web.Dockerfile` |
| hub | `deploy/railway/hub.Dockerfile.root` |
| relay | `deploy/railway/relay.Dockerfile.root` |

**Do not reconnect any service yourselves.** The project lead is doing the dashboard. CLI deploys stay the way production is updated until he says otherwise.
