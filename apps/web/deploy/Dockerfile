# The countersign console: the static build of apps/web behind apps/web/server.ts.
# apps/web/deploy.sh stages dist/, server.ts and this file, then uploads only that.
FROM oven/bun:1.3.14-slim
WORKDIR /app
COPY dist ./dist
COPY server.ts ./server.ts
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER bun
CMD ["bun", "server.ts"]
