# The countersign console from a Railway GitHub build: repo root is the build context.
FROM oven/bun:1.3.14-slim
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run --cwd apps/web build
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["bun","apps/web/server.ts"]
