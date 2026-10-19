# Preserve AI conversation paths independently of prose

Store each Chat, Feedback, and Revise discussion as a distinct SQLite row with a
stable ID and original writing-context association. Retain a draft ID and label
snapshot even if the draft is deleted; document deletion still removes its AI
history. Migrate legacy draft/mode arrays by copying their original JSON.

Conversation branching copies a message prefix and records the source
conversation and message IDs. Edit and retry create another path before asking
for an answer. This is sufficient for local conversation management and avoids
introducing a shared message graph, graph deletion rules, or prose history events.
Deleting an origin must not delete its descendants.

A reopened conversation uses its original draft's current context for new turns.
Other drafts can browse it, but cannot send into it. Per-turn metadata distinguishes
past context from the next turn. Switching discussions cancels and settles the
current request before changing the displayed messages; writes retain the
initiating conversation ID. Historical tools are displayed as data, not replayed.

See [issue #436](https://github.com/ThatXliner/Quillium/issues/436) and
[the AI pipeline](../ai-sidebar.md#conversation-identity-and-alternative-paths).

## Unified chat (September 2026)

Chat now hosts discussion, feedback, and revision requests in one conversation.
The original separate-panel design interrupted follow-up questions and required
writers to remember where a discussion happened. History therefore spans legacy
mode values, while each new turn carries its own task permissions. Existing row
IDs, mode fields, source links, and draft associations remain unchanged; no data
migration merges or discards conversations. Edit/retry reuse a saved turn's task
(and exact word target), falling back to the legacy mode only for older messages.
New follow-ups default to discussion; feedback and revision actions are explicit
per-request permissions, not persistent conversation modes.

This changes navigation and action selection, not draft authority, historical
tool replay, cancellation, or the persistence boundaries above. Built-in chat is
the primary UI; the existing optional MCP bridge is a complementary integration
for external assistants and does not replace it.
