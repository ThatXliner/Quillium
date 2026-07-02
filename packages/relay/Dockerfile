FROM oven/bun:1 AS deps

WORKDIR /app
COPY package.json bun.lock ./
COPY packages/desktop/package.json packages/desktop/package.json
COPY packages/landing/package.json packages/landing/package.json
COPY packages/relay/package.json packages/relay/package.json
COPY packages/share/package.json packages/share/package.json
RUN bun install --frozen-lockfile --filter @quillium/relay

FROM deps AS build

COPY packages/relay/tsconfig.json packages/relay/tsconfig.json
COPY packages/relay/src packages/relay/src
RUN bun --cwd packages/relay run build

FROM oven/bun:1-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

COPY package.json bun.lock ./
COPY packages/desktop/package.json packages/desktop/package.json
COPY packages/landing/package.json packages/landing/package.json
COPY packages/relay/package.json packages/relay/package.json
COPY packages/share/package.json packages/share/package.json
RUN bun install --frozen-lockfile --production --filter @quillium/relay
COPY --from=build /app/packages/relay/dist packages/relay/dist

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD bun -e "const port = process.env.PORT || 3001; fetch(`http://127.0.0.1:${port}/health`).then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "packages/relay/dist/index.js"]
