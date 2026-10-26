# Quillium Omni relay

The relay synchronizes Live Rooms over WebSockets, authenticates access through
Supabase, and persists Yjs updates and snapshots. The
[collaboration guide](../../docs/collaboration.md) explains state ownership,
recovery, cleanup, and shutdown.

## Current constraints

Run one long-lived relay process. Rooms and owner presence are process-local;
non-owners can join only while the registered owner is connected to that same
process. Update-log cleanup also assumes one process owns each room. Horizontal
scaling needs coordinated room ownership before another instance is added.

Failed persistence batches remain in memory for retry. A process crash or the
10-second shutdown deadline can lose them. `/health` reports process status and
room count; it does not prove Supabase is reachable or all edits are durable.

## Run locally

Run commands from the repository root. Install dependencies with `bun install`.
If `packages/relay/.env` does not exist, create it from the package example:

```sh
cp packages/relay/.env.example packages/relay/.env
```

Fill in the Supabase values, then start the relay:

```sh
bun run relay:dev
curl http://localhost:3001/health
```

The dev script runs Node through `tsx`. A successful health response contains
`"status":"ok"` and `"protocol":"yjs"`. Set desktop `PUBLIC_RELAY_URL` to
`ws://localhost:3001` to connect a local app.

## Environment

| Name | Default | Purpose |
|---|---|---|
| `SUPABASE_URL` | Required | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | Server-only key; never put it in frontend configuration |
| `PORT` | `3001` | HTTP and WebSocket port |
| `HOST` | `0.0.0.0` | Bind address |
| `ALLOWED_ORIGINS` | Unset | Comma-separated browser origins; unset disables origin checks |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, or `debug` |
| `PERSIST_DEBOUNCE_MS` | `500` | Delay before batching update writes |

When an allowlist is configured, the relay also accepts its built-in localhost
and Tauri development origins, and clients without an Origin header. This check
does not replace authentication. See [`src/origins.ts`](src/origins.ts).

The WebSocket URL is `/<documentId>?auth=<supabase-access-token>`. The desktop
supplies its active draft ID as this room key. Configure proxies to avoid
recording the query string, which contains the access token.

## Build and deploy

Use the Node version range in [the root manifest](../../package.json). Build and
start through the package scripts so Node runs the production bundle:

```sh
bun run relay:build
bun run relay:start
```

Build the Docker image from the repository root:

```sh
docker build -f packages/relay/Dockerfile -t quillium-relay .
docker run --env-file packages/relay/.env -p 3001:3001 quillium-relay
```

[`Dockerfile`](Dockerfile) bundles the relay and shared contracts with esbuild.
The runtime image contains Node and the bundle, without Bun or a production
`node_modules` tree. It exposes port 3001 and probes `/health`.

The checked-in deployment target is Fly. [`fly.toml`](fly.toml) selects the
Dockerfile, port, region, and machine settings. Run Fly commands from the
repository root. Runtime pins and the verified Bun installer are documented in
the [monorepo guide](../../docs/monorepo.md#deployments).

Before a deployment, apply the root Supabase migrations, configure server-only
credentials and allowed origins, and verify owner connect, joiner connect,
owner departure, and reconnect behavior. Allow graceful `SIGTERM` handling and
check logs for failed flushes or the shutdown deadline.

## Verify changes

```sh
bun run relay:typecheck
bun run relay:test:run
```

For real authentication, sockets, and database persistence, use the
[cross-package E2E suite](../e2e/README.md). A health check alone does not cover
those paths.
