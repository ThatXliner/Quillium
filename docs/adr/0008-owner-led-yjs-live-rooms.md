# Run owner-led Yjs Live Rooms with ephemeral joiners

Mirror the owner's live draft through Yjs over WebSocket instead of maintaining
a custom operational-transform protocol, while keeping the owner's SQLite state
as durable authority. Joiner state is ephemeral and the room ends when the owner
disconnects, trading host migration and durable multi-writer collaboration for
a smaller live-collaboration boundary. See [issue #169](https://github.com/ThatXliner/Quillium/issues/169)
and [PR #200](https://github.com/ThatXliner/Quillium/pull/200).

## Invitation permissions

Live Room grants are separate from Web Preview. Owners and editors retain the
Yjs update protocol. Viewers and commenters cannot submit raw Yjs updates,
including synchronization step 2. Commenters submit validated create-comment
and reply commands. The relay resolves their root or nested revision scope,
checks the anchors, and writes the resulting Yjs data with server-assigned
identity and timestamps.

Comparing visible document state after a candidate update is insufficient.
A Yjs update can contain unresolved structures or delete sets that take effect
after later dependencies arrive. Rejecting the raw update before application
keeps those writes outside the room.

Grant management goes through the same relay process that owns the room.
Revocation, role changes, and link replacement remove affected connections
before the management response. Admission checks both a room epoch and a grant
change counter after asynchronous authorization. This prevents an older access
lookup from admitting a client after revocation or owner reconnection. Expiry
is checked before document and presence broadcasts as well as on inbound frames.

Joiners remain ephemeral. A role change ends the affected connection and
requires a fresh invitation join with a fresh Y.Doc. Owner departure still ends
the room and restores joiners' prior local views.
