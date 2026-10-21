FROM oven/bun:1 AS deps

WORKDIR /app
COPY package.json bun.lock ./
# Every workspace member in packages/* must be present or bun treats the
# lockfile as changed and --frozen-lockfile fails, even for members the relay
# does not depend on.
COPY packages/desktop/package.json packages/desktop/package.json
COPY packages/e2e/package.json packages/e2e/package.json
COPY packages/landing/package.json packages/landing/package.json
COPY packages/relay/package.json packages/relay/package.json
COPY packages/share/package.json packages/share/package.json
RUN bun install --frozen-lockfile --filter @quillium/relay

FROM node:22.23.4-bookworm-slim AS build

WORKDIR /app
COPY --from=deps /app /app

COPY packages/relay/tsconfig.json packages/relay/tsconfig.json
COPY packages/relay/src packages/relay/src
COPY packages/share/src packages/share/src
COPY packages/relay/build.mjs packages/relay/build.mjs
RUN npm run --workspace @quillium/relay build

FROM node:22.23.4-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/relay/dist ./packages/relay/dist

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "const port = process.env.PORT || 3001; fetch(`http://127.0.0.1:${port}/health`).then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "packages/relay/dist/index.js"]
