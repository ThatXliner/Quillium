# syntax=docker/dockerfile:1.7
# Official runtime archives are pinned by SHA256 while Docker's new Node tags publish.
FROM python:3.13-slim@sha256:cf50a4f6ac4f026458b08d5222023d700ac806410dff5e9ca8728fa44f2b850f AS runtime-unpack
ARG TARGETARCH
ADD --checksum=sha256:f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9 https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-arm64.tar.gz /archives/node-arm64.tar.gz
ADD --checksum=sha256:b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406 https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.gz /archives/node-amd64.tar.gz
ADD --checksum=sha256:baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-aarch64.zip /archives/bun-arm64.zip
ADD --checksum=sha256:bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-x64.zip /archives/bun-amd64.zip
COPY scripts/unpack-relay-runtime.py /bootstrap/unpack.py
RUN python3 /bootstrap/unpack.py "$TARGETARCH" /out

FROM debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad AS deps
COPY --from=runtime-unpack /out/node /usr/local
COPY --from=runtime-unpack /out/bun /usr/local/bin/bun
RUN test "$(node --version)" = 'v22.23.4' && test "$(bun --revision)" = '1.4.4+38afee6c8'

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

FROM deps AS build

WORKDIR /app

COPY packages/relay/tsconfig.json packages/relay/tsconfig.json
COPY packages/relay/src packages/relay/src
COPY packages/share/src packages/share/src
COPY packages/relay/build.mjs packages/relay/build.mjs
RUN npm run --workspace @quillium/relay build

FROM debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad AS runtime
COPY --from=runtime-unpack /out/node/bin/node /usr/local/bin/node

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
