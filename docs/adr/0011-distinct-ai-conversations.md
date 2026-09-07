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
