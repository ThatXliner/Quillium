# PostHog events

This catalog covers selected product events. Find other call sites with
`rg -n 'capture\(' packages/desktop/src packages/landing/src`.

## Add or change an event

Desktop analytics initialization and privacy handling live in
[posthog.ts](../packages/desktop/src/lib/posthog.ts); startup hooks live in
[hooks.client.ts](../packages/desktop/src/hooks.client.ts). Use the named `capture` export from
`$lib/posthog` at the user-action boundary when sending event properties. It
removes the content keys listed in `REDACTED_KEYS`; the default SDK export does
not apply that wrapper. Never add prose or other sensitive values under a new
property name to bypass redaction. Keep analytics in app adapters,
not the shared annotation core or presentation.

Use a `snake_case` event name with the existing feature prefix, such as
`revision_version_created`. Include properties that explain the action, such as
`trigger`, `has_selection`, a count, or a mode. Follow existing privacy handling
for document content. Add or update the corresponding row in this catalog.

Local configuration uses `PUBLIC_POSTHOG_KEY` and `PUBLIC_POSTHOG_HOST` from the
[desktop environment example](../packages/desktop/.env.example). The client can
remain unconfigured for unrelated development.

## Session and editor

| Event | When | File |
|-------|------|------|
| `app_session_started` | Editor mounts with document | `Editor.svelte` |
| `undo_history_policy_loaded` | Document policy loaded; includes effective persistence and legacy/setting source | `Editor.svelte` |
| `editor_undo` | Undo from native menu | `Editor.svelte` |
| `editor_redo` | Redo from native menu | `Editor.svelte` |
| `editor_select_all` | Select all from native menu | `Editor.svelte` |
| `focus_mode_entered` | User enters distraction-free focus mode | `routes/+page.svelte` |
| `focus_mode_exited` | User exits distraction-free focus mode | `routes/+page.svelte` |
| `beta_terms_accepted` | First-run beta disclaimer accepted | `BetaDisclaimer.svelte` |

## AI sidebar

| Event | When | File |
|-------|------|------|
| `ai_sidebar_opened` | User opens sidebar | `sidebar/Sidebar.svelte` |
| `ai_message_sent` | Sidebar chat transport dispatches a request | `chatFactory.ts` |
| `ai_chat_message_sent` | Chat message sent | `ClassicChat.svelte`, `Chat.svelte` |
| `ai_feedback_requested` | Feedback requested | `Feedback.svelte`, `Chat.svelte` |
| `ai_revise_requested` | Revision triggered | `Revise.svelte`, `Chat.svelte` |
| `context_generated` | Document context generated | `clientStreams.ts` |
| `context_cleared` | Context cleared | `DocumentContext.svelte` |
| `editorial_decision_saved` | Writer saves a document editorial decision | `DocumentContext.svelte` |
| `editorial_decision_removed` | Writer removes a document editorial decision | `DocumentContext.svelte` |

## Annotations

| Event | When | File |
|-------|------|------|
| `annotation_created` | AI creates annotation | `chatFactory.ts` |
| `comment_created` | User submits comment | `PreComment.svelte` |
| `comment_ai_suggestion_requested` | AI suggestion in thread | `Comment.svelte`, `CommentModal.svelte` |
| `comment_modal_opened` | Full-screen comment modal | `Comment.svelte` |
| `suggestion_applied` | Suggestion applied | `Suggestion.svelte` |
| `suggestion_branched` | Suggestion converted to revision | `Suggestion.svelte` |
| `suggestion_diff_viewed` | Inline diff viewed | `Suggestion.svelte` |
| `suggestion_diff_modal_opened` | Full-screen diff modal | `Suggestion.svelte` |
| `revision_version_created` | New revision version | `Revision.svelte`, `RevisionModal.svelte` |
| `revision_version_switched` | Revision version switched | `Revision.svelte`, `RevisionModal.svelte` |
| `revision_modal_opened` | Full-screen revision modal opened | `Revision.svelte` |
| `annotation_deleted` | Annotation deleted | `Comment.svelte`, `Suggestion.svelte`, `Revision.svelte` |
| `ai_target_text_ellipsis_stripped` | AI target cleanup removed ellipsis | `annotations/index.ts` |
| `nested_editor_flush_to_parent_meaningful` | Meaningful nested sync | `NestedEditorController.ts` |
| `modal_stack_duplicate_push` | Duplicate modal prevented | `stores.ts` |

## Dictionary

| Event | When | File |
|-------|------|------|
| `dictionary_opened` | Dictionary popover opened | `dictionaryPlugin.ts` |
| `dictionary_synonym_replaced` | Synonym replacement | `DictionaryPopover.svelte` |
| `dictionary_chip_lookup` | Chip click lookup | `DictionaryPopover.svelte` |
| `dictionary_open_in_chat` | Open in AI chat | `DictionaryPopover.svelte` |
| `dictionary_describe_lookup` | Custom description lookup | `DictionaryPopover.svelte` |

## Settings

| Event | When | File |
|-------|------|------|
| `settings_opened` | Settings dialog opened | `SettingsModal.svelte` |
| `settings_saved` | Settings saved; includes `persist_undo_history_for_new_documents` | `SettingsModal.svelte` |
| `ai_settings_provider_changed` | Provider changed | `AISettings.svelte` |
| `ai_settings_model_changed` | Model changed | `AISettings.svelte` |
| `semantic_search_toggled` | Search-by-meaning toggled | `SettingsModal.svelte` |
| `semantic_search_model_uninstalled` | Semantic model removed | `SettingsModal.svelte` |
| `shortcut_hints_hidden` | Annotation shortcut hints hidden | `Annotations.svelte` |

## Reader personas

| Event | When | File |
|-------|------|------|
| `reader_persona_toggled` | Persona enabled/disabled | `Readers.svelte` |
| `reader_chattiness_changed` | Chattiness level changed | `Readers.svelte` |
| `reader_persona_created` | Custom persona created | `Readers.svelte` |
| `reader_persona_removed` | Custom persona deleted | `Readers.svelte` |
| `reader_persona_review_completed` | Persona finishes feedback | `chatFactory.ts` |

## AutoAI

| Event | When | File |
|-------|------|------|
| `autoai_toggled` | AutoAI enabled/disabled | `AutoAIWidget.svelte` |
| `autoai_mode_changed` | Mode switched | `AutoAIWidget.svelte` |
| `autoai_manual_review_triggered` | "Review now" clicked | `AutoAIWidget.svelte` |
| `autoai_settings_changed` | Settings changed | `AutoAIWidget.svelte` |

## Tutorial

| Event | When | File |
|-------|------|------|
| `tutorial_started` | Tutorial started | `Tutorial.svelte` |
| `tutorial_step_advanced` | Tutorial next step | `Tutorial.svelte` |
| `tutorial_step_back` | Tutorial previous step | `Tutorial.svelte` |
| `tutorial_completed` | Tutorial completed | `Tutorial.svelte` |
| `tutorial_skipped` | Tutorial skipped | `Tutorial.svelte` |

## Library

| Event | When | File |
|-------|------|------|
| `library_viewed` | Library page opened | `library/+page.svelte` |
| `document_created` | Document created; includes effective undo policy and `new_document_setting` source | `library/+page.svelte` |
| `document_opened` | Document opened; includes effective undo policy and legacy/setting source | `library/+page.svelte` |
| `document_opened_new_window` | Document opened in a new window; includes effective undo policy and legacy/setting source | `library/+page.svelte` |
| `document_renamed` | Document renamed | `library/+page.svelte` |
| `document_tags_updated` | Tags updated | `library/+page.svelte` |
| `document_trashed` | Document trashed | `library/+page.svelte` |
| `document_restored` | Document restored | `library/+page.svelte` |
| `document_deleted_permanently` | Permanent delete | `library/+page.svelte` |
| `document_exported` | Document exported | `export.ts` |

Undo-policy events use `persist_undo_history` (boolean) and
`undo_history_policy_source` (`legacy_date_cutoff` or `new_document_setting`). Track unique users
with `undo_history_policy_loaded` and `legacy_date_cutoff` to measure active reliance on the
temporary July 14 grandfathering. `settings_saved.persist_undo_history_for_new_documents` and
`document_created.persist_undo_history` measure adoption of the explicit setting.

## Tabs and drafts

| Event | When | File |
|-------|------|------|
| `tab_created` | New tab via + button | `tabDrafts.svelte.ts` |
| `tab_switched` | Tab clicked | `tabDrafts.svelte.ts` |
| `tab_renamed` | Tab renamed inline | `tabDrafts.svelte.ts` |
| `tab_reordered` | Tab drag-reordered | `tabDrafts.svelte.ts` |
| `tab_deleted` | Tab soft-deleted | `tabDrafts.svelte.ts` |
| `tab_restored` | Delete undo toast restores a tab | `tabDrafts.svelte.ts` |
| `draft_iterated` | Next version made (iterate) | `tabDrafts.svelte.ts` |
| `draft_branched` | Different take made (branch) | `tabDrafts.svelte.ts` |
| `draft_switched` | Draft tree row clicked | `tabDrafts.svelte.ts` |
| `draft_deleted` | Draft deleted through the panel; `mode` records the operation | `tabDrafts.svelte.ts` |
| `draft_restored` | Delete undo toast restores a draft | `tabDrafts.svelte.ts` |
| `draft_locked` / `draft_unlocked` | Lock toggled | `tabDrafts.svelte.ts` |
| `delete_toast_view_history` | Delete undo toast opens history | `tabDrafts.svelte.ts` |

## Collaboration

| Event | When | File |
|-------|------|------|
| `collab_went_live` | Owner starts a live session | `liveSession.svelte.ts` |
| `collab_go_live_failed` | Going live failed (relay/auth/sync error) | `liveSession.svelte.ts` |
| `collab_room_joined` | Joiner connects to a shared room | `liveSession.svelte.ts` |
| `collab_join_failed` | Joining a room failed | `liveSession.svelte.ts` |
| `collab_session_ended` | Session ended (`role`, `reason`: manual/owner_left) | `liveSession.svelte.ts` |
| `collab_reconnect_started` | Connection lost, first retry begins | `liveSession.svelte.ts` |
| `collab_reconnected` | Reconnected after retries (`attempts`) | `liveSession.svelte.ts` |
| `collab_reconnect_failed` | Retries exhausted, session torn down (`attempts`) | `liveSession.svelte.ts` |

## Sharing and provenance

| Event | When | File |
|-------|------|------|
| `readonly_share_published` | Read-only public page first published | `GoLiveButton.svelte` |
| `readonly_share_updated` | Read-only public page updated | `GoLiveButton.svelte` |
| `readonly_share_link_copied` | Public link copied | `GoLiveButton.svelte` |
| `readonly_share_disabled` | Public link disabled | `GoLiveButton.svelte` |
| `authorship_report_exported` | Authorship report exported | `provenance/export.ts` |
| `feedback_menu_opened` | Feedback survey opened/requested | `posthog.ts` |

## Navigation

| Event | When | File |
|-------|------|------|
| `navigated_to_library` | App navigates to library | `navigation.ts` |
| `navigated_to_history` | App navigates to version history | `navigation.ts` |
| `navigated_to_authorship` | App navigates to authorship route | `navigation.ts` |
| `navigated_to_editor` | App navigates back to editor | `navigation.ts` |

## Errors and recovery

| Event | When | File |
|-------|------|------|
| `crash_backup_restored` | Backup restored | `ErrorBanner.svelte` |
| `crash_backup_downloaded` | Backup downloaded | `ErrorBanner.svelte` |
| `crash_banner_dismissed` | Banner dismissed | `ErrorBanner.svelte` |
| `crash_app_reloaded` | App reloaded | `ErrorBanner.svelte` |
| `editor_replay_event_failed` | Event replay failed | `replay.ts` |
| `editor_replay_completed_with_failures` | Replay with failures | `replay.ts` |
| `perf_coords_at_pos` | Slow `coordsAtPos` measurement captured | `listeners.ts` |

## Updates

| Event | When | File |
|-------|------|------|
| `update_available` | Update detected | `+page.svelte` |
| `update_started` | Update download started | `+page.svelte` |
| `update_ready` | Download complete | `+page.svelte` |
| `update_relaunched` | Relaunch clicked | `+page.svelte` |
| `update_dismissed` | Banner dismissed | `+page.svelte` |
| `update_failed` | Update failed | `+page.svelte` |
| `update_app_store_opened` | App Store update link opened | `+page.svelte` |

## Changelog

| Event | When | File |
|-------|------|------|
| `changelog_viewed` | Changelog dismissed | `ChangelogModal.svelte` |

## Omni landing hero experiment

[Omni hero: original vs manuscript](https://us.posthog.com/project/334824/experiments/461612)
uses flag `omni-hero`. The page recognizes `control` as the original centered
headline and `manuscript` as the 3D hero. Both use the same signup form and page
below the hero. Allocation and experiment status are configured in PostHog;
this repository does not define the active split. The page freezes its assignment
for the visit and falls back to the manuscript hero after 1.2 seconds if flags
are unavailable.

| Event | When | File |
|-------|------|------|
| `$experiment_exposure` | Assigned hero becomes visible; once per page mount | `packages/landing/src/routes/omni/+page.svelte` |
| `omni_waitlist_submitted` | Waitlist form submitted | Same |
| `omni_waitlist_succeeded` | Waitlist API returns success; experiment primary conversion | Same |
| `omni_waitlist_failed` | Waitlist API rejects the request | Same |

Signup events include `hero_variant`, `hero_assignment`, `hero_exposed`, and
`form_location` (`hero` or `footer`). Exposure events exclude previews and
fallbacks. The explicit `$feature/omni-hero` property preserves the rendered
assignment even
if the SDK refreshes its flags while the visitor is on the page. Tracking respects
the existing PostHog opt-out. No experiment exposure is emitted in development.

Preview either hero with `/omni?omni-hero=original` or
`/omni?omni-hero=manuscript`. These links never enroll visitors in the experiment.
An unavailable or unrecognized flag value uses the manuscript fallback. Changing
remote experiment settings does not replace a hero already assigned for the visit.

## Invitation privacy

The landing `/join` handoff reads an invitation token from the URL fragment.
It does not resolve invitations or initialize analytics on a direct visit.
The landing analytics initializer drops events on `/join` and events containing
an invitation URL, including after navigation from another page. The handoff
content blocks autocapture and keeps the token out of referrers. Invitation
creation and join flows do not emit token, email, or display-name properties.
