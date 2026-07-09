# @quillium/e2e

Cross-package end-to-end tests for **Quillium Omni** — the seams no single
package can test on its own. Run from the repo root:

```bash
bun run e2e:test:run      # single run
bun run e2e:test          # watch mode
```

Also included in `bun run test:all`.

## Track B — Share / web preview (implemented)

Exercises the desktop → wire → landing pipeline for the Omni web preview, with
**zero infrastructure**:

- `shareRoundTrip.test.ts` — builds a document (comment + two revisions + a
  version group) through the real annotation core, serializes it the way desktop
  publishes (`state.toJSON(readonlySavedFields)`), restores it the way the
  landing `ReadonlyDocument` does (`EditorState.fromJSON`), and asserts content,
  annotation fidelity, and the **linked-revision cascade** survive the round-trip.
- `readonlyRender.test.ts` — mounts the real `ReadonlyDocument` component and
  asserts it renders through the actual read-only CodeMirror editor.
- `supabaseContract.test.ts` — the Supabase seam (publish → `published_state`
  column → `get_public_share_by_token` RPC). **Gated**: needs a local Supabase
  stack with the `share_published_state` migration applied, so it is skipped
  unless `E2E_SUPABASE_URL` and `E2E_SUPABASE_SERVICE_ROLE_KEY` are set.

## Track A — Relay real-time collaboration (planned)

Booting the real relay over a live WebSocket and asserting two clients converge
(+ persistence) is tracked in [#325](https://github.com/ThatXliner/Quillium/issues/325),
not yet implemented here.
