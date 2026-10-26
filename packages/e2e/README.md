# Cross-package Omni tests

This package checks the desktop serializer, shared renderer, Supabase contracts,
relay, and hosted Web Preview together. Run commands from the repository root:

```bash
bun run e2e:test:run   # Vitest; database tests skip without configuration
bun run e2e:test:web   # Playwright; requires Supabase configuration
bun run e2e:test:full  # Local Supabase, all Vitest layers, then Playwright
bun run e2e:test      # Vitest watch mode
```

## Run the complete local suite

Install workspace dependencies, Docker, and the Supabase CLI. Docker must be
running and `supabase` must be on `PATH`. Install the browser once:

```bash
bun install --frozen-lockfile
bun run --cwd packages/e2e playwright install chromium --with-deps
bun run e2e:test:full
```

[`scripts/runLocal.ts`](scripts/runLocal.ts) starts or reuses the root local
Supabase project, applies pending migrations, reads its credentials, and
generates the desktop's SvelteKit configuration. It then requires every database,
relay, and browser layer to run. It leaves Supabase running for reuse.

Use a disposable local stack. The runner applies migrations to an existing
local project, and the tests create and delete fixture users and documents.
It does not run the desktop package's separate test suite or a native Tauri app.

## Coverage

| Test | Boundary exercised |
|---|---|
| `relayConvergence.test.ts` | Production relay, real WebSockets and Supabase JWTs, two-way text and annotation changes, sender-echo checks, persisted recovery, and seeded generated operations |
| `shareRoundTrip.test.ts` | Production desktop serialization and shared state restoration, including linked revisions |
| `shareRoundTrip.fuzz.test.ts` | Seeded generated documents, ranges, threads, replacements, and revision versions |
| `readonlyRender.test.ts` | Mounted shared shell and CodeMirror renderer, version switching, malformed-state recovery, and legacy rendering |
| `supabaseContract.test.ts` | Real user authentication, owner RLS, publish/read/disable through the desktop repository, anonymous table denial, and the public-share RPC |
| `webPreview.pw.ts` | Actual landing route, read-only interactions, annotations and modals, invalid/disabled shares, and responsive images |

The source files own the seeds and run counts. Long desktop collaboration stress
tests live in [the opt-in fuzz directory](../desktop/src/lib/collab/fuzz/README.md).

## Run against an existing test stack

The database and browser layers accept these variables:

```dotenv
E2E_SUPABASE_URL=http://127.0.0.1:54321
E2E_SUPABASE_SERVICE_ROLE_KEY=your-local-service-role-key
E2E_SUPABASE_PUBLISHABLE_KEY=your-local-publishable-key
```

`E2E_SUPABASE_ANON_KEY` is a compatibility fallback for the publishable key.
Keep service-role keys out of frontend configuration. The browser runner passes
only the public values to its landing child process.

Set `E2E_WEB_PREVIEW_REQUIRED=1` when a skipped service-backed layer must fail
the run. The full local runner sets it automatically. Without it, missing
credentials can produce skipped tests rather than verify the database or browser.
The repository currently has no pull-request workflow that runs these suites.

## Visual checks

Linux owns committed snapshots. Web Preview skips image comparisons on macOS
and Windows while retaining semantic checks. `CI=1` requires Linux, builds the
landing app before serving it, writes reports, and fails retry-passes.

For an intentional image change on Ubuntu 24.04:

```bash
CI=1 bun run e2e:test:full -- --update-snapshots --retries=0
```

Arguments after `--` go only to Playwright; the required Vitest layer still runs
first. Follow [visual verification](../../docs/visual-regression.md) to review
image differences and failure artifacts. Do not commit non-Linux baselines.
