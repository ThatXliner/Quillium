# @quillium/e2e

Cross-package integration and end-to-end tests for **Quillium Omni** — the
seams no single package can test on its own.

```bash
bun run e2e:test:run   # component, round-trip, fuzz, and optional DB contract
bun run e2e:test:web  # Playwright only; requires the Supabase env below
bun run e2e:test:full # start/reuse local Supabase, then run every layer
bun run e2e:test       # Vitest watch mode
```

`e2e:test:full` is the release-confidence command for Omni. It reads
credentials from `supabase status -o json`, starts the local stack when needed,
generates required SvelteKit state for a clean checkout, and does not allow the
database, relay, or browser layers to be silently skipped. CI runs this command
for changes that can affect the collaboration or hosted preview paths.

## Track A — Relay real-time collaboration (implemented)

`relayConvergence.test.ts` boots the production `createRelayServer()` on an
ephemeral port and connects two headless Yjs clients over real `ws` sockets. It
creates two local Supabase users, authenticates both clients with their real
access-token JWTs, and covers:

- owner and collaborator edits in both directions, including document text and
  annotation maps;
- exactly-once delivery to the other client without sender echo; and
- relay debounce persistence by replaying the stored `yjs_updates` rows into a
  fresh Y.Doc.

The suite uses the same opt-in Supabase environment as Track B, so the default
`e2e:test:run` remains infrastructure-free. `e2e:test:full` supplies those
variables from the local Supabase CLI and therefore requires the relay contract
to run.

## Track B — Share / web preview (implemented)

The suite covers the desktop → wire → Supabase → landing → browser pipeline at
four levels:

- `shareRoundTrip.test.ts` calls the production desktop serializer, restores
  with the shared read-only core, and verifies comments, suggestions, revisions,
  and linked-version cascades.
- `shareRoundTrip.fuzz.test.ts` runs 100 seeded, shrinking fast-check cases over
  generated documents, ranges, threads, replacements, and revision versions.
- `readonlyRender.test.ts` mounts the actual share shell and CodeMirror renderer,
  including UI-driven linked-version switching, malformed-state recovery, and
  the legacy pre-`published_state` fallback.
- `supabaseContract.test.ts` creates and authenticates a real local user, checks
  owner RLS, calls the production desktop repository to publish/get/disable,
  verifies anonymous table denial, and reads enabled snapshots through
  `get_public_share_by_token`.
- `webPreview.pw.ts` starts the real landing app and drives `/share/[token]` in
  Chromium, covering metadata, the CTA, read-only enforcement, all annotation
  types, linked revisions, legacy shares, malformed tokens, disabled shares,
  and cleanup.

The Supabase-backed Vitest and Playwright layers accept:

```bash
E2E_SUPABASE_URL=http://127.0.0.1:54321
E2E_SUPABASE_SERVICE_ROLE_KEY=...
E2E_SUPABASE_PUBLISHABLE_KEY=... # E2E_SUPABASE_ANON_KEY also works
```

The browser suite remains optional when those variables are absent. CI and other
required runs set `E2E_WEB_PREVIEW_REQUIRED=1`; in that mode a missing URL,
service-role key, or publishable/anon key fails during Playwright configuration
instead of reporting a skipped green run. CI retries failures only to collect
diagnostic evidence and uses Playwright's `failOnFlakyTests`, so a retry-pass is
still a failing required check. Playwright retains a trace, screenshot, and HTML
DOM attachment for each failed test under `packages/e2e/test-results/`; CI also
writes JSON and HTML reports.

Web Preview image assertions cover modern `published_state` and pre-migration
legacy rendering in light and dark themes at wide, tablet, and mobile widths,
plus nested revision, long comment, and multi-option suggestion modals. Expected
images live in `packages/e2e/tests/webPreview.pw.ts-snapshots/` and Linux is the
canonical rendering environment. To review an intentional visual change, run
this on the documented Ubuntu/Playwright environment:

```bash
CI=1 bun run e2e:test:full -- --update-snapshots
```

`runLocal.ts` forwards arguments after `--` only to Playwright, while still
running the required migrations and Vitest contract layer first. Do not commit
macOS- or Windows-generated baselines.
