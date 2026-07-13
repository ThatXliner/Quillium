# PostHog Events

Analytics event catalog (curated subset). All events are captured via `posthog.capture()`. To find all events, grep for `posthog.capture` in the codebase.

## Session & Editor

| Event | When | File |
|-------|------|------|
| `app_session_started` | Editor mounts with document | `Editor.svelte` |
| `undo_history_policy_loaded` | Document policy loaded; includes effective persistence and legacy/setting source | `Editor.svelte` |
| `editor_undo` | Undo from native menu | `Editor.svelte` |
| `editor_redo` | Redo from native menu | `Editor.svelte` |
| `editor_select_all` | Select all from native menu | `Editor.svelte` |
| `beta_terms_accepted` | First-run beta disclaimer accepted | `BetaDisclaimer.svelte` |

## AI Sidebar

| Event | When | File |
|-------|------|------|
| `ai_sidebar_opened` | User opens AI sidebar | `AISidebar.svelte` |
| `ai_message_sent` | Any AI request dispatched | `chatFactory.ts` |
| `ai_chat_message_sent` | Chat message sent | `Chat.svelte` |
| `ai_chat_quick_prompt_used` | Chat quick prompt used | `Chat.svelte` |
| `ai_context_action_used` | Context-aware action card used | `Chat.svelte`, `Feedback.svelte`, `Revise.svelte` |
| `ai_feedback_requested` | Feedback requested | `Feedback.svelte` |
| `ai_feedback_quick_prompt_used` | Feedback quick prompt used | `Feedback.svelte` |
| `ai_revise_requested` | Revision triggered | `Revise.svelte` |
| `ai_revise_quick_prompt_used` | Revise quick prompt used | `Revise.svelte` |
| `context_generated` | Document context generated | `clientStreams.ts` |
| `context_cleared` | Context cleared | `DocumentContext.svelte` |

## Annotations

| Event | When | File |
|-------|------|------|
| `annotation_created` | AI creates annotation | `chatFactory.ts` |
| `comment_created` | User submits comment | `PreComment.svelte` |
| `comment_ai_suggestion_requested` | AI suggestion in thread | `Comment.svelte`, `CommentModal.svelte` |
| `comment_modal_opened` | Full-screen comment modal | `Comment.svelte` |
| `suggestion_applied` | Suggestion applied | `Suggestion.svelte` |
| `suggestion_branched` | Suggestion → revision | `Suggestion.svelte` |
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

## Reader Personas

| Event | When | File |
|-------|------|------|
| `reader_persona_toggled` | Persona enabled/disabled | `Readers.svelte` |
| `reader_chattiness_changed` | Chattiness level changed | `Readers.svelte` |
| `reader_persona_created` | Custom persona created | `Readers.svelte` |
| `reader_persona_removed` | Custom persona deleted | `Readers.svelte` |
| `reader_persona_review_completed` | Persona finishes feedback | `chatFactory.ts` |
| `persona_mode_toggled` | Feedback/Revise persona mode toggled | `Feedback.svelte`, `Revise.svelte` |

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

## Tabs & Drafts

| Event | When | File |
|-------|------|------|
| `tab_created` | New tab via + button | `Editor.svelte` |
| `tab_switched` | Tab clicked | `Editor.svelte` |
| `tab_renamed` | Tab renamed inline | `Editor.svelte` |
| `tab_reordered` | Tab drag-reordered | `Editor.svelte` |
| `tab_deleted` | Tab soft-deleted | `Editor.svelte` |
| `tab_restored` | Tab restored (undo toast or history) | `Editor.svelte`, `VersionHistory.svelte` |
| `draft_iterated` | Next version made (iterate) | `Editor.svelte` |
| `draft_branched` | Different take made (branch) | `Editor.svelte` |
| `draft_switched` | Draft tree row clicked | `Editor.svelte` |
| `draft_deleted` | Leaf draft soft-deleted | `Editor.svelte` |
| `draft_restored` | Draft restored (undo toast or history) | `Editor.svelte`, `VersionHistory.svelte` |
| `draft_locked` / `draft_unlocked` | Lock toggled | `Editor.svelte` |
| `draft_scrapped` | Draft scrapped | `Save.svelte` |
| `delete_toast_view_history` | Delete undo toast opens history | `Editor.svelte` |

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

## Sharing & Provenance

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

## Error & Recovery

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
