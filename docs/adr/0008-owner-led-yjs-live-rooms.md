# Run owner-led Yjs Live Rooms with ephemeral joiners

Mirror the owner's live draft through Yjs over WebSocket instead of maintaining
a custom operational-transform protocol, while keeping the owner's SQLite state
as durable authority. Joiner state is ephemeral and the room ends when the owner
disconnects, trading host migration and durable multi-writer collaboration for
a smaller live-collaboration boundary. See [issue #169](https://github.com/ThatXliner/Quillium/issues/169)
and [PR #200](https://github.com/ThatXliner/Quillium/pull/200).
