# The Whitechain relay on Railway: packages/relay from an exact commit, production dependencies only.
# deploy-relay.sh stages `git archive <ref>` with this file as its Dockerfile.
# It runs as root so the Railway volume at /data (RELAY_DB) is writable.
FROM oven/bun:1.3.14-slim
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --production
ENV NODE_ENV=production
EXPOSE 8402
CMD ["bun", "run", "packages/relay/src/server.ts"]
