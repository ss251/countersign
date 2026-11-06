# The countersign hub on Railway: apps/hub from an exact commit, production dependencies only.
# deploy/railway/deploy-hub.sh stages `git archive <ref>` with this file as its Dockerfile.
# It runs as root so the Railway volume at /data (HUB_DB) is writable.
FROM oven/bun:1.3.14-slim
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --production
ENV NODE_ENV=production
EXPOSE 8787
CMD ["bun", "run", "apps/hub/src/index.ts"]
