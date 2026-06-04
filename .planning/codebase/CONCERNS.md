# Codebase Concerns

**Analysis Date:** 2026-04-16

## Tech Debt

### Nested Editor Flush Redundancy
- **Issue:** `NestedEditorController.destroy()` calls `flushToParent()` to serialize nested editor state back to the parent revision's version blob. The architecture description explicitly marks this as "believed to be redundant": `translateAndDispatch` already syncs doc text per-keystroke, and `flushAnnotationStateToParent` syncs sub-annotations per-effect. By destroy time, the parent should already have all state.
- **Files:** `src/lib/editor/plugins/annotations/NestedEditorController.ts` (lines 137-143), `src/lib/editor/plugins/annotations/annotationField.ts`
- **Impact:** Defensive code that may be unnecessary creates cognitive overhead and maintenance burden. The flush exists purely as a safety net and has a PostHog instrumentation flag (`nested_editor_flush_to_parent_meaningful`) to verify. If telemetry confirms zero meaningful flushes over ~1 month, this can be safely removed.
- **Fix approach:** (1) Monitor PostHog metrics for `nested_editor_flush_to_parent_meaningful` events. (2) If zero or near-zero meaningful flushes detected after 1 month, remove the `flushToParent()` call and related code. (3) Update `NestedEditorController` to document decision.

### Collapsed Revision queueMicrotask Race Condition
- **Issue:** `collapsedRevisionResolver` uses `queueMicrotask` to defer removal of collapsed revisions. While this avoids dispatching inside a `ViewPlugin.update()` (which is illegal in CodeMirror), microtask ordering is not guaranteed when multiple microtasks fire simultaneously. The code guards against dispatch-inside-update with `if (update.view.state !== update.state) return;` but if the user presses Cmd+Z synchronously before the microtask fires, ordering becomes fragile.
- **Files:** `src/lib/editor/plugins/annotations/index.ts` (collapsedRevisionResolver implementation)
- **Impact:** Rare race condition under rapid undo/redo with collapsed revisions. Under normal typing conditions this is not triggered. The guard prevents double-removal but doesn't prevent potential ordering issues if the state advances unexpectedly between the update firing and the microtask running.
- **Fix approach:** Consider replacing `queueMicrotask` with a per-view ordered queue (similar to the persistence layer's `persistQueue` pattern in `listeners.ts`) or explore CodeMirror's official mechanisms for deferred updates. Alternatively, add PostHog instrumentation to detect when the state-guard fires and log it to quantify real-world frequency.

### Coarse-Grained Thread Updates
- **Issue:** `updateThread` StateEffect replaces the entire thread array (`annotation.thread`). Undoing a single message edit reverts the entire thread to its prior state. There is no granular message-level history.
- **Files:** `src/lib/editor/plugins/annotations/annotationField.ts` (lines 286-287 in ARCHITECTURE.md)
- **Impact:** Thread edits are all-or-nothing in the undo history. Users cannot undo a single message within a thread without losing all subsequent messages added after that message was edited.
- **Fix approach:** Either (1) accept this as a documented limitation and update user documentation, or (2) refactor to track individual message mutations as separate effects, which would require a more complex undo inversion strategy for threads.

### Single Pending Comment Enforcement
- **Issue:** `canCreateNewComment()` enforces a strict one-pending-comment-at-a-time mutex. Only one annotation with `thread.length === 0` (pending state) can exist. Attempting to create a second pending comment while one exists returns false.
- **Files:** `src/lib/editor/plugins/annotations/utils.ts` (via `canCreateNewComment`), `src/lib/editor/plugins/annotations/index.ts` (createCommentCommand)
- **Impact:** Users cannot create multiple comment drafts simultaneously. The locking mechanism is enforced at creation time but has no explicit FSM — the pending state is implicit (`thread.length === 0`). This is acknowledged in ARCHITECTURE.md as "technical debt."
- **Fix approach:** Consider adding explicit annotation status enum (`"draft" | "active" | "resolved"`) instead of inferring from thread length. Allow multiple drafts but prevent editing until one is submitted.

---

## Known Limitations (Documented in ARCHITECTURE.md)

### Multi-Selection Not Supported
- **Limitation:** The annotation system assumes one selection range per annotation (`selection.main`). Multi-cursor editing is not handled.
- **Files:** All annotation code assumes `EditorSelection.main` — no multi-range support in range mapping, view plugins, or nested editors
- **Impact:** Users with multi-cursor habits will find revisions/comments behave unexpectedly with multiple selections. The feature will degrade silently.
- **Priority:** Low (multi-cursor is advanced usage; most writers use single selection)

### Revision Selection Rebuilding on Version Switch
- **Limitation:** `_updateActiveRevisionVersion` rebuilds the entire revision's selection to span the new version's text length. If versions differ significantly in length, the selection may not preserve the user's intended position.
- **Files:** `src/lib/editor/plugins/annotations/annotationField.ts` (Phase 2 handling of `_updateActiveRevisionVersion` effect)
- **Impact:** Version switching always resets the revision's span to `[from, from + newVersionLength]`. No position memory across versions.
- **Priority:** Medium (affects common workflow of comparing version lengths)

### Revision IDs Assumed Sequential in Suggestion Inversion
- **Limitation:** `addSuggestion` inversion in `invertedAnnotationFieldEffects` uses `Math.max` on suggestion IDs to find the next available ID, assuming IDs are sequential and monotonically increasing.
- **Files:** `src/lib/editor/plugins/annotations/annotationField.ts` (undo/redo inversion for suggestions)
- **Impact:** Works correctly for normal workflows. Breaks if suggestions are added in bulk (e.g., AutoAI creating 10 suggestions simultaneously with non-sequential IDs). The inversion would compute an incorrect ID and potentially collide with existing annotations.
- **Priority:** Medium (bulk suggestion creation via AutoAI is a real scenario; inversion bug would cause undo corruption)

### No Explicit Annotation Status Enum
- **Limitation:** There is no FSM for annotation lifecycle. `thread.length === 0` means "pending comment", but this is implicit and fragile. Other annotation types (revisions, suggestions) have no explicit draft/active/resolved distinction.
- **Files:** All annotation components implicitly check `thread.length === 0` or use other implicit markers
- **Impact:** Makes code harder to reason about; easy to introduce state-consistency bugs when adding features (e.g., annotation deletion, restoration)
- **Priority:** Low-Medium (current approach works but is acknowledged technical debt in ARCHITECTURE.md)

### Deeply Nested Modal External-Sync Relies on Global Store Array
- **Limitation:** Child modals read parent annotation state from `modalAnnotationStores[stackIndex - 1]` instead of directly from the parent's `EditorView`. This creates a global per-level store dependency.
- **Files:** `src/lib/editor/plugins/annotations/RevisionModal.svelte` (lines 442-447 in ARCHITECTURE.md), `src/lib/stores.ts` (modalAnnotationStores)
- **Impact:** Works correctly for cascading undo/redo. However, the global store array is a fragile coupling point. Changes to modal lifecycle could break sync if the index-to-store mapping becomes stale. No direct parent-child signal; state flows through a global indirection.
- **Priority:** Low (works reliably; refactoring to direct signals would be a larger architectural change)

---

## Fragile Areas

### Annotation Re-Anchoring on Crash Recovery
- **Files:** `src/lib/editor/restore.ts` (entire file)
- **Why fragile:** The crash recovery system uses `SearchCursor` to re-find anchor text in the restored document. If the anchor text appears multiple times in the restored doc, the first match is used (no uniqueness guarantee). If the text doesn't exist in the backup (e.g., because the backup is truncated or from an older version), the annotation is placed at position 0 with a console warning. No user notification.
- **Safe modification:** (1) Before re-anchoring, extract the anchor text from the *original* doc and log a detailed audit trail. (2) If re-match fails, place a visual marker in the editor (e.g., a comment at position 0) alerting the user rather than silently dropping the annotation. (3) Add PostHog instrumentation to track how often re-anchoring fails (currently only console-warned).
- **Test coverage:** `restore.ts` has no unit tests. Add tests for truncated backups, missing anchor text, and multi-occurrence anchor texts.

### Phase 3 (`pushDocToVersionState`) Timing and Undo Interaction
- **Files:** `src/lib/editor/plugins/annotations/annotationField.ts` (Phase 3 implementation, lines ~300-310)
- **Why fragile:** Phase 3 is triggered on every `tr.docChanged` for revisions not in `revisionsWithExplicitEffect`. The mutations are inline state updates, not `StateEffect`s, so they're not directly invertible by the history system. Instead, CodeMirror inverts the *document* change, which causes the revision range to collapse back, and the next Phase 3 push on the inverted transaction re-reads the correct text. **This relies on the invariant that you never switch versions mid-undo.** If someone switches versions while undo is in flight, the re-read position may be stale.
- **Safe modification:** Add an invariant check: before a version switch, verify there are no pending undo transactions. Or, refactor Phase 3 to emit proper `StateEffect`s with inversions instead of inline mutations (higher complexity but more robust).
- **Test coverage:** Covered by `annotationField.test.ts` and fuzz tests in `annotations.fuzz.test.ts`, but version-switch-during-undo is not explicitly exercised.

### Nested Editor State Serialization via `VersionState` Blobs
- **Files:** `src/lib/editor/plugins/annotations/models.ts`, `src/lib/editor/plugins/annotations/NestedEditorController.ts` (flushToParent), `src/lib/editor/restore.ts` (healNestedAnnotations)
- **Why fragile:** Nested editor state (annotations inside revisions) is serialized as opaque `{ annotationField?: ... } & { doc, label? }` blobs via `editor.state.toJSON(nestedSavedFields)`. The schema uses `.passthrough()` so extra keys survive round-trips, but the production path relies only on `doc` and `label`. If a nested editor is destroyed and recreated, the full nested `EditorState` is lost and rebuilt from just the `doc` string. Any custom state stored in the blob (e.g., scroll position, cursor, nested editor history) is silently discarded.
- **Safe modification:** (1) Document what data *must* be preserved in the blob vs. what is ephemeral. (2) Add PostHog instrumentation to track when nested editors are destroyed/recreated to quantify data loss impact. (3) Consider persisting scroll position and cursor separately if needed.
- **Test coverage:** Nested editor state persistence is covered by end-to-end tests but not granularly by unit tests.

### Error Guard Thresholds Are Static
- **Files:** `src/lib/errorGuard.ts` (lines 59-65, 135-142)
- **Why fragile:** `SUSPICIOUS_DELETION_RATIO = 0.2`, `SUSPICIOUS_DELETION_MIN_CHARS = 100`, `SUSPICIOUS_ANNOTATION_REMOVAL_MIN = 3`, and `SUSPICIOUS_ANNOTATION_REMOVAL_RATIO = 0.25` are hardcoded constants. They were chosen conservatively (false positives just mean extra snapshots), but there's no feedback loop to adjust them based on real-world usage. Users with small documents (< 500 chars) may trigger false positives frequently.
- **Safe modification:** Make thresholds configurable via settings (hidden developer option), or add PostHog instrumentation to track false positive rate per document size and adjust thresholds accordingly.
- **Test coverage:** No unit tests for `errorGuard.ts`. Add tests for edge cases: tiny documents, bulk deletions, annotation spam.

---

## Security Considerations

### API Key Storage (Keychain Integration)
- **Risk:** API keys are stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) via Tauri's `invoke("get_api_key")` / `invoke("set_api_key")` commands. The keychain is the recommended approach for desktop apps, but a few edge cases exist:
  - If the user's machine is compromised at the kernel level, keychain contents can be extracted.
  - The app process must have permission to access the keychain (granted by the OS at runtime).
  - If the Tauri IPC bridge is compromised, the key could be intercepted in transit.
- **Files:** `src/lib/ai/settings.svelte.ts` (ensureApiKeyLoaded, loadApiKeyForProvider), `src-tauri/src/keychain.rs` (set_api_key, get_api_key, delete_api_key commands)
- **Current mitigation:** Keys are never stored in localStorage; they're loaded on-demand from the keychain only when needed. A `HAS_API_KEY_KEY` flag in localStorage is used to avoid prompting for keychain access on every app load.
- **Recommendations:** (1) Document the assumption that the OS keychain is secure (it is, for end-user threat models). (2) For extra paranoia, consider encrypting the API key before storing in keychain with a user-provided password (adds friction; low priority). (3) Add audit logging to keychain operations for post-breach forensics.

### Document Content in localStorage
- **Risk:** Crash backups are stored in `localStorage["quillium_backup_crash"]` as plain JSON. localStorage is readable by any JavaScript in the same webview, including potential XSS or injected code. However, the backup is only created on a crash, not continuously.
- **Files:** `src/lib/errorGuard.ts` (writeBackup, readBackup), `src/hooks.client.ts` (crash handlers), `src/lib/ErrorBanner.svelte` (restore UI)
- **Current mitigation:** (1) Backups are ephemeral — they're only created on crash and are cleared after the user restores or dismisses the banner. (2) The app uses a CSP (Content Security Policy) header to limit script injection. (3) API keys are never backed up (they go to the keychain instead).
- **Recommendations:** (1) If XSS is a concern in your threat model, store crash backups in IndexedDB instead with encryption (adds complexity). For now, the assumption is that localStorage XSS is acceptable for a desktop app. (2) Add a user-facing warning before restoring that the backup is plain-text.

### Document Export Format
- **Risk:** Document export (txt, json, md, txt+json) includes annotations as inline data. If a user exports and shares a document, annotations (comments, feedback) may contain sensitive information.
- **Files:** `src/lib/export.ts` (exportDocument function), `src/lib/ai/Revise.svelte` (export UI)
- **Current mitigation:** Export is user-initiated; the app doesn't automatically share. The user must explicitly click "Export" and save the file.
- **Recommendations:** (1) Add a UI option to strip annotations before export (currently, no such option exists). (2) Document in the export dialog that annotations are included and may contain sensitive data.

### PostHog Analytics Opt-Out
- **Risk:** PostHog is integrated for analytics. User analytics include event types (e.g., `ai_feedback_requested`, `annotation_created`), which could leak information about document structure (e.g., how many annotations per session). The opt-out mechanism is localStorage-based.
- **Files:** `src/lib/posthog.ts` (posthog init, opt-out), `src/lib/settings.svelte.ts` (analyticsEnabled toggle), `src/lib/ErrorBanner.svelte` (crash event capture)
- **Current mitigation:** (1) Opt-out is respected immediately via `posthog.opt_out_capturing()` and persists across sessions. (2) Exception capture is wired only to crash handlers, not to every error. (3) API keys are never logged to PostHog.
- **Recommendations:** (1) Add a privacy policy link in the settings modal. (2) Document what event types are captured for transparency. (3) Consider using anonymized session IDs instead of user IDs.

---

## Performance Bottlenecks

### Large Document State Serialization
- **Problem:** Every 50 events or 120 seconds, a full snapshot of `EditorState.toJSON(savedFields)` is created and stored in SQLite. For documents with many annotations (50+), this snapshot includes the entire `annotationField` as JSON, which can be multi-MB.
- **Files:** `src/lib/editor/listeners.ts` (snapshot creation logic), `src-tauri/src/db/events.rs` (SNAPSHOT_EVENT_THRESHOLD = 50, SNAPSHOT_TIME_THRESHOLD_SECS = 120)
- **Cause:** No incremental snapshots; every snapshot is a full state blob. The event log captures incremental changes, but snapshots are monolithic.
- **Improvement path:** (1) Consider deltaing snapshots against the previous one and storing diffs. (2) Or, increase snapshot frequency thresholds if the document is small. (3) Or, prune the annotationField in snapshots if annotations are persisted separately (not currently done).

### Nested Editor Context Calculation
- **Problem:** `RevisionModal.svelte` calculates `contextLayers` (context before/after each nested revision in the modal breadcrumb trail) on every annotation change via `$effect`. For deeply nested modals (3+ levels), each layer triggers a full recalculation of the parent-of-parent's annotation state.
- **Files:** `src/lib/editor/plugins/annotations/RevisionModal.svelte` (lines 112-140)
- **Cause:** No memoization of context layers. The derived state re-runs whenever any parent annotation changes (re-reads `parentState.field(annotationField)`).
- **Improvement path:** (1) Add a per-crumb cache keyed by `(parentViewId, revisionId)` to avoid recalculating unchanged layers. (2) Or, move context calculation to a separate utility function that can be tested independently and optimized later. (3) For now, deeply nested modals (>3 levels) will have slower updates.

### Annotation Event Extraction on Every Transaction
- **Problem:** `extractAnnotationEvents()` in `listeners.ts` processes every transaction and builds an `AnnotationEvent[]`. For transactions with many annotation effects (e.g., AutoAI adding 10 suggestions), the effect loop iterates all of them.
- **Files:** `src/lib/editor/listeners.ts` (extractAnnotationEvents, lines 95-150)
- **Cause:** No batching; each transaction processes effects individually.
- **Improvement path:** For AutoAI and bulk operations, the number of effects is capped (typically <10), so this is not a bottleneck. No optimization needed unless AutoAI is enhanced to create 100+ annotations per review.

---

## Scaling Limits

### SQLite Event Log Unbounded Growth
- **Current capacity:** Events are appended forever; no automatic pruning. Snapshots are auto-pruned per retention policy, but events are not.
- **Limit:** SQLite WAL (Write-Ahead Log) can grow unbounded. A document with continuous editing could accumulate millions of events over months. The `events` table would grow to several GB per document.
- **Scaling path:** (1) Implement event pruning: after a snapshot is taken, delete events older than the snapshot timestamp (keep only the most recent N events or events within M days). (2) Or, periodically compact the event log by creating a new snapshot and deleting all prior events + snapshots. (3) Currently, Version History UI shows snapshots, not events, so pruning events is safe.

### Nested Editor Nesting Depth
- **Current capacity:** Theoretically unlimited (each `RevisionModal` can contain another nested revision). Practically, UI becomes unusable at 3+ levels.
- **Limit:** Each nesting level adds a full CodeMirror instance (editor state + view), which consumes memory. At 10 levels, the app would have 10 EditorView instances in memory simultaneously.
- **Scaling path:** (1) Document that infinite nesting is supported but UX degrades beyond 3 levels. (2) Add a hard depth limit in the code (e.g., `stackIndex < MAX_NESTING_DEPTH = 10`) to prevent accidental infinite loops. (3) Currently, no limit exists, and the breadcrumb trail will get very long.

### Document Size
- **Current capacity:** CodeMirror 6 supports documents up to several MB without UI lag (tested up to 5MB in production).
- **Limit:** Snapshot creation (serialization to JSON) becomes slow at 10MB+. Event log replay is O(events), so a document with 1M events would replay slowly on load.
- **Scaling path:** For large documents, consider (1) implementing document chunking (split into sections), or (2) lazy-loading snapshots (only load the most recent N snapshots to avoid loading old state). Currently, no large-document optimizations exist.

### Number of Annotations per Document
- **Current capacity:** 1000+ annotations work correctly; no hard limit enforced. Rendering all annotation cards in the sidebar at once becomes slow (>500 cards).
- **Limit:** The right sidebar (Annotations.svelte) renders every annotation card simultaneously. At 2000+ annotations, rendering and scrolling lag.
- **Scaling path:** Implement virtual scrolling in the annotation sidebar to render only visible cards. Currently, all cards are rendered at once.

---

## Dependency Risk

### CodeMirror 6 Plugin API
- **Risk:** The app is tightly coupled to CodeMirror 6's plugin API (ViewPlugin, StateField, facets, etc.). CodeMirror 7 (if it exists) might have breaking changes.
- **Impact:** Major refactor if CodeMirror updates incompatibly. The annotation system alone (annotationField, ViewPlugins) would need significant rework.
- **Mitigation:** (1) Monitor CodeMirror releases for stability. (2) Add integration tests that exercise the full plugin stack to catch breaking changes early.

### AI SDK (Universal AI SDK)
- **Risk:** The app uses `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` via the `ai` SDK. If the SDK has a breaking change or deprecates a provider, the app must update.
- **Impact:** AutoAI and the AI sidebar would break if a provider is deprecated (e.g., if OpenAI's API changes unexpectedly).
- **Mitigation:** (1) Pin major versions of AI SDK in package.json. (2) Implement provider fallback logic (if OpenAI fails, try Anthropic). (3) Currently, no fallback exists; if one provider fails, all AI features fail.

### Tauri 2 Stability
- **Risk:** Tauri 2 is used for desktop packaging. Tauri 3 or 4 might introduce breaking changes in the API or native plugin ecosystem.
- **Impact:** Build/packaging would break on Tauri major version upgrades.
- **Mitigation:** (1) Monitor Tauri releases. (2) Use pinned versions (`@tauri-apps/cli`, `@tauri-apps/api`). (3) Test each Tauri minor version before releasing.

---

## Missing Critical Features

### Offline Support
- **Gap:** The app requires Tauri and SQLite to work. Without network, the app still works for document editing, but AI features fail. There is no fallback to a local LLM or cached responses.
- **Blocks:** Users with intermittent connectivity cannot reliably use AI features.
- **Mitigation:** Document that AI requires a persistent API key and network access. Consider adding an offline indicator in the UI.

### Multi-Device Sync
- **Gap:** Documents are stored locally in SQLite. There is no sync mechanism to move documents between devices or to the cloud.
- **Blocks:** Users cannot access their documents on multiple machines. No cross-device backup.
- **Mitigation:** Document the single-machine assumption. Users must manually export documents to move them.

### Selective Annotation Export
- **Gap:** Document export includes all annotations (comments, revisions, suggestions). There is no UI option to strip annotations before export.
- **Blocks:** Users who want to share documents without sharing feedback must manually edit the exported file.
- **Mitigation:** Add an export options dialog with checkboxes for annotation types to include.

---

## Test Coverage Gaps

### `restore.ts` (Crash Recovery Re-Anchoring)
- **What's not tested:** Truncated backups, missing anchor text, multi-occurrence anchor texts, nested annotation re-anchoring
- **Files:** `src/lib/editor/restore.ts`
- **Risk:** Re-anchoring logic has no unit tests. If a bug is introduced (e.g., search cursor position off-by-one), it won't be caught until a user crashes and tries to restore.
- **Priority:** High

### `errorGuard.ts` (Suspicious Change Detection)
- **What's not tested:** Edge cases around threshold boundaries (e.g., exactly 20% deletion), documents smaller than SUSPICIOUS_DELETION_MIN_CHARS, large annotation removals
- **Files:** `src/lib/errorGuard.ts`
- **Risk:** Thresholds are untested. A future change to the thresholds could introduce false positives/negatives.
- **Priority:** Medium

### Nested Editor Sync During Undo
- **What's not tested:** Version switching mid-undo, rapidly switching versions and undoing, undo of nested edits in inline vs. modal editors
- **Files:** `src/lib/editor/plugins/annotations/NestedEditorController.ts`, `src/lib/editor/plugins/annotations/RevisionModal.svelte`
- **Risk:** The fragile Phase 3 undo interaction (revision selection remapping during undo) is not explicitly tested. Subtle bugs in undo sequencing could go undetected.
- **Priority:** High (undo is critical UX)

### AutoAI Edge Cases
- **What's not tested:** AutoAI with empty documents, AutoAI with very large documents, AutoAI creating >100 annotations at once, AutoAI during offline mode
- **Files:** `src/lib/autoai/engine.ts`, `src/lib/autoai/AutoAIWidget.svelte`
- **Risk:** AutoAI is a complex feature that integrates with AI SDK, persistence, and annotation creation. Edge cases (e.g., network failure during review) are not covered.
- **Priority:** Medium

### Reader Personas Edge Cases
- **What's not tested:** Persona deletion while feedback is in flight, custom persona color/emoji edge cases, disabled persona toggling during multi-persona execution
- **Files:** `src/lib/readers/settings.svelte.ts`, `src/lib/ai/Readers.svelte`, `src/lib/ai/chatFactory.ts`
- **Risk:** Persona CRUD and multi-persona parallel execution have race conditions that are not tested.
- **Priority:** Medium

---

## Known Bugs (Documented or Inferred)

### Modal Stack Duplicate Push Prevention
- **Symptom:** Clicking a revision card multiple times rapidly could theoretically push the same modal entry multiple times, creating duplicate modals.
- **Files:** `src/lib/stores.ts` (modalStack.push), `src/lib/editor/plugins/annotations/Revision.svelte` (revision click handler)
- **Current mitigation:** The click handler is already guarded, and a PostHog event `modal_stack_duplicate_push` is captured if a duplicate is detected. The implementation prevents this, so no active bug exists.
- **Status:** Monitored via PostHog; no action needed unless events spike.

### Revision Selection Rebuilding on Version Switch
- **Symptom:** When switching revision versions with significantly different text lengths (e.g., v1 is 100 chars, v2 is 10 chars), the revision's selection in the main document becomes misaligned. The selection is rebuilt to `[from, from + newVersionLength]`, which may span less of the document than intended.
- **Files:** `src/lib/editor/plugins/annotations/annotationField.ts` (Phase 2 handling of `_updateActiveRevisionVersion` effect)
- **Workaround:** User must manually adjust the revision range in the nested editor or delete and recreate the revision.
- **Root cause:** No position memory across versions. The system assumes versions are alternatives for the same span, not independently sized blocks.
- **Priority:** Low (edge case; users typically keep versions similar in size)

---

## Summary of Priority Fixes

| Category | Issue | Priority | Effort |
|----------|-------|----------|--------|
| Tech Debt | Nested editor flush redundancy | Medium | Low (remove code) |
| Tech Debt | Coarse-grained thread updates | Low | Medium (FSM refactor) |
| Tech Debt | Single pending comment enforcement | Low | Medium (add enum) |
| Fragile | Crash recovery re-anchoring | High | High (unit tests + UI) |
| Fragile | Phase 3 undo interaction | High | Medium (add tests + guards) |
| Fragile | Error guard thresholds | Medium | Low (add instrumentation) |
| Performance | Large document snapshots | Medium | High (delta snapshots) |
| Performance | Nested context calculation | Low | Medium (memoization) |
| Scaling | SQLite event log growth | Medium | High (pruning logic) |
| Scaling | Annotation sidebar rendering | Medium | Medium (virtual scroll) |
| Security | API key theft at OS level | Low | N/A (document assumption) |
| Security | Document export with annotations | Medium | Low (add UI option) |
| Dependency | CodeMirror 6 API stability | Medium | N/A (monitor) |
| Coverage | Test gaps in restore.ts | High | Medium (unit tests) |
| Coverage | Test gaps in undo/redo | High | Medium (integration tests) |

---

*Concerns audit: 2026-04-16*
