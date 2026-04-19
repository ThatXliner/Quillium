# Domain Pitfalls: Real-Time Collaborative Editing

**Domain:** Real-time collaborative text editing with @codemirror/collab
**Project:** Quillium Omni
**Researched:** 2026-04-16
**Confidence:** HIGH (Context7 + official docs + community patterns)

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or architectural dead ends.

### Pitfall 1: Annotation Position Divergence Across Peers

**What goes wrong:** Quillium's annotation system (comments, revisions, suggestions) stores `EditorSelection` positions that anchor highlights to document ranges. When collaborative editing maps positions through concurrent changes, `@codemirror/collab` does NOT guarantee that position mapping converges to the same positions when applied in different order by different peers. Two users may see the same comment anchored to different text spans after concurrent edits resolve.

**Why it happens:** CodeMirror's `ChangeSet.mapPos()` is deterministic for a single peer but the mapping behavior depends on the order operations are applied. OT guarantees document convergence, not position convergence. The official docs explicitly warn: "Position mapping done in the effect's map function... [is not] guaranteed to converge to the same positions when applied in different order by different peers."

**Consequences:**
- Comment highlights drift to wrong text
- Revision ranges cover unintended content
- Suggestion anchors become meaningless
- User confusion about which text a comment refers to

**Warning signs:**
- Different users report seeing annotations on different text
- After rapid concurrent editing, annotation highlights appear "shifted"
- Undo/redo causes annotation positions to jump unexpectedly

**Prevention:**
1. Treat annotation positions as "ephemeral decorations" locally but sync canonical anchor text (or stable IDs) separately
2. Implement periodic position re-synchronization: server broadcasts authoritative anchor positions at intervals
3. Store anchor context (surrounding text) to detect and repair drift
4. Consider syncing annotations through a separate channel with their own versioning, not just as `sharedEffects`

**Detection:** Unit tests with simulated concurrent edits verifying annotation position consistency across peers.

**Phase to address:** Client Collab Integration (Phase 3) — must be designed before first annotation sync attempt.

**Sources:**
- [CodeMirror Collaborative Example](https://codemirror.net/examples/collab/) — explicit warning about position divergence
- [GitHub codemirror/collab](https://github.com/codemirror/collab)

---

### Pitfall 2: Update Starvation Under High Latency

**What goes wrong:** A high-latency client submits changes based on version N, but by the time they reach the server, peers have already pushed versions N+1, N+2, N+3. The server rejects the stale update. The client fetches new updates, rebases, resubmits — but by then, more updates have arrived. The cycle repeats, and the high-latency user can never get their edits through.

**Why it happens:** Naive server implementations reject version mismatches outright. Even with `rebaseUpdates()`, if the round-trip time exceeds the average inter-update interval of faster peers, the slow client's rebased updates arrive stale again.

**Consequences:**
- User types but nothing persists
- Edits appear locally then vanish (overwritten by syncs)
- Complete inability to edit in poor network conditions
- Frustration → users give up on the feature

**Warning signs:**
- Users report "my changes keep disappearing"
- High retry counts in push loop telemetry
- Specific users consistently fail to sync while others succeed

**Prevention:**
1. Always use `rebaseUpdates()` server-side instead of rejecting stale versions
2. Implement client-side debouncing: batch rapid keystrokes into fewer pushes (CodeMirror example uses 100ms setTimeout between push attempts)
3. Add exponential backoff on push retries with jitter
4. Consider server-side buffering: accept updates even if slightly stale, merge on arrival
5. Show clear UI feedback when sync is delayed (not silent failure)

**Detection:** Load test with simulated high-latency clients (500ms+ RTT) against fast-typing peers. Measure update success rate.

**Phase to address:** Relay Server (Phase 2) — server must implement rebasing from day one.

**Sources:**
- [CodeMirror Collaborative Example](https://codemirror.net/examples/collab/) — mentions rebaseUpdates
- [@codemirror/collab npm](https://www.npmjs.com/package/@codemirror/collab)

---

### Pitfall 3: Bolt-On Architecture (Collab as Afterthought)

**What goes wrong:** CKEditor learned this the hard way: "Full support for collaborative editing... couldn't be simply overlaid on existing capabilities." Teams try to add collab to an existing editor assuming it's just "sync the document" — then discover that every subsystem (undo, annotations, state effects, persistence) must be collaboration-aware.

**Why it happens:** Collaborative editing is not a feature — it's an architectural mode. Systems designed for single-user operation make assumptions (local undo history is authoritative, state effects don't need network round-trips, persistence can be synchronous) that break under collab.

**Consequences (from CKEditor postmortem):**
- Poor intention preservation after conflict resolution
- Multi-year rewrites (CKEditor spent 4+ years, 42 person-years)
- Exponential complexity as edge cases compound
- Ship dates slip repeatedly

**Warning signs:**
- "We'll just sync the document and everything else stays the same"
- Undo reverting other users' changes
- State effects (annotations) getting lost during sync
- Constant "just one more edge case" patches

**Prevention:**
1. Accept that Quillium's existing systems may need modification, not just wrapping
2. Identify all state that needs syncing early: document, annotations, cursor positions, AutoAI state
3. Design sync boundaries explicitly: what's local-only vs. shared
4. Build collab mode as a distinct operational mode, not a transparent layer
5. Start with the hardest part (annotation sync) to validate architecture before building easy parts

**Detection:** Architecture review checklist: for each existing feature (undo, annotations, persistence, AutoAI), document how it behaves under concurrent editing.

**Phase to address:** All phases — but architecture validation in Phase 1 (Auth) before writing collab code.

**Sources:**
- [CKEditor Lessons Learned](https://ckeditor.com/blog/lessons-learned-from-creating-a-rich-text-editor-with-real-time-collaboration/)

---

### Pitfall 4: WebSocket Reconnection State Desync

**What goes wrong:** User goes offline (network hiccup, laptop sleep, train tunnel). WebSocket drops. On reconnect, the client's local version is stale. If the reconnection logic doesn't properly handle the version gap, the client either:
- Receives a flood of updates that corrupt local state
- Has local pending changes that can't be rebased (too much divergence)
- Loses unsynced local edits entirely

**Why it happens:** WebSocket is stateless — a new connection knows nothing about the previous session. The hard problem is: "State exists on both sides of the connection and has diverged — the server had subscriptions, message stream positions; the client had unacknowledged outbound messages."

**Consequences:**
- Data loss (the worst case)
- Document corruption ("my text got duplicated")
- State inconsistency between what client shows and server has
- Users learn not to trust the sync feature

**Warning signs:**
- Users report duplicated content after network interruption
- "My document looks different after I came back online"
- Pending changes silently vanish
- Error logs showing version mismatch spikes after reconnects

**Prevention:**
1. Persist pending (unconfirmed) changes locally before sending
2. On reconnect, re-fetch server version and replay pending changes through `rebaseUpdates`
3. Implement heartbeat/ping to detect stale connections early
4. For long disconnections, fall back to "fetch full document + diff against local" rather than incremental sync
5. For Quillium: owner-only offline editing simplifies this (collaborators are server-dependent per spec)
6. Show clear "offline" / "reconnecting" / "synced" UI states

**Detection:** Test by killing WebSocket mid-edit, waiting 30s, reconnecting. Verify no data loss.

**Phase to address:** Relay Server (Phase 2) + Client Integration (Phase 3) — reconnection is split across both.

**Sources:**
- [WebSocket Reconnection Guide](https://websocket.org/guides/reconnection/)
- [Ably WebSocket Best Practices](https://ably.com/topic/websocket-architecture-best-practices)

---

### Pitfall 5: Undo/Redo in Multi-User Context

**What goes wrong:** User A types "hello", User B types "world". User A presses Cmd+Z expecting to undo "hello" but instead undoes "world" (last operation globally). Or: User A's undo reverts an operation that User B's subsequent edit depended on, creating an inconsistent state.

**Why it happens:** Single-user undo assumes a linear history owned by one actor. Multi-user undo must answer: whose history? Global history makes undo unpredictable. Per-user history requires tracking operation ownership and handling conflicts when undoing operations that others have built upon.

**Consequences:**
- Users inadvertently revert collaborators' work
- "Undo feels broken" — unpredictable behavior
- State corruption when dependent operations are undone

**Warning signs:**
- Undo reverts changes the user didn't make
- "I pressed undo but nothing I wrote disappeared"
- After undo, text that another user was editing vanishes

**Prevention:**
1. Implement per-user undo stacks tracking only local operations
2. When undoing an operation that has been built upon, transform the inverse operation through subsequent changes
3. Handle "tombstoned" operations gracefully: if undoing an insert but that text was already deleted by someone else, skip silently
4. Consider Liveblocks pattern: `pause()` and `resume()` to batch related operations into single undo units
5. For Quillium: since `historyField` is already undo-aware for annotations, ensure collab mode respects the same `addToHistory` flags

**Detection:** Two-client test: A types, B types, A undoes. Verify A's change reverted, B's change preserved.

**Phase to address:** Client Collab Integration (Phase 3) — undo behavior must be defined before shipping.

**Sources:**
- [Liveblocks Undo/Redo in Multiplayer](https://liveblocks.io/blog/how-to-build-undo-redo-in-a-multiplayer-environment)
- [DEV Community: You Don't Know Undo/Redo](https://dev.to/isaachagoel/you-dont-know-undoredo-4hol)

---

## Moderate Pitfalls

Mistakes that cause significant rework or degraded UX.

### Pitfall 6: JWT Token Expiry During Long Sessions

**What goes wrong:** User opens Quillium, authenticates, gets JWT. Starts writing for 3 hours. JWT expires. Next sync attempt fails auth. Connection drops. If not handled gracefully, user sees cryptic errors or loses recent work.

**Why it happens:** JWTs have expiry by design. WebSocket connections are long-lived. The intersection creates a timing problem: "A JWT issued when the connection opens will expire during a long session."

**Prevention:**
1. Implement in-band token refresh: send new token over existing WebSocket before expiry
2. Track token expiry client-side, proactively refresh 5-10 minutes before expiry
3. On auth failure, queue pending changes locally, trigger re-auth flow, resume sync
4. Never drop unsynced changes due to auth expiry

**Detection:** Set short JWT expiry (5 min) in test env. Verify continuous editing survives token rotation.

**Phase to address:** Auth (Phase 1) + Relay Server (Phase 2).

**Sources:**
- [Linode JWT WebSocket Auth](https://www.linode.com/docs/guides/authenticating-over-websockets-with-jwt/)
- [Socket.IO JWT Guide](https://socket.io/how-to/use-with-jwt)

---

### Pitfall 7: History Accumulation Memory Leak

**What goes wrong:** The relay server stores all updates forever to support late-joining peers. Over hours/days of active editing, memory grows unbounded. Server crashes or slows to a crawl.

**Why it happens:** The CodeMirror collab example "endlessly accumulates updates for every single change." This is fine for demos but fatal for production.

**Prevention:**
1. Implement snapshot compaction: periodically collapse N updates into a full document snapshot
2. Discard updates older than the oldest connected client's version (or oldest snapshot)
3. For late joiners beyond the history window: serve full document, not incremental updates
4. Monitor server memory; alert on growth trends

**Detection:** Run simulated editing session for 24 hours. Measure server memory growth.

**Phase to address:** Relay Server (Phase 2).

**Sources:**
- [CodeMirror Collaborative Example](https://codemirror.net/examples/collab/) — "endlessly accumulates updates"

---

### Pitfall 8: Supabase Realtime Limits and WAL Buildup

**What goes wrong:** Supabase Realtime has documented limits: "Too many channels currently joined for a single connection" and "Too many total concurrent connections for a project." Additionally, Postgres WAL (Write-Ahead Logging) can build up if Realtime can't keep up, eventually crashing the database.

**Why it happens:** Supabase is designed for general-purpose realtime, not high-frequency collab traffic. The Postgres NOTIFY payload limit is 8KB. Heavy collab use may exceed these limits.

**Prevention:**
1. Use Supabase for presence/cursors only; use dedicated WebSocket relay for document changes
2. Batch database writes; don't persist every keystroke
3. Set `max_slot_wal_keep_size` to prevent unbounded WAL growth
4. Monitor Supabase connection counts and channel usage
5. Have fallback if Realtime channel is full

**Detection:** Load test with 20+ concurrent editors. Monitor Supabase dashboard for limit warnings.

**Phase to address:** Relay Server (Phase 2) — architecture decision about what goes through Supabase vs. relay.

**Sources:**
- [Supabase Realtime Limits](https://supabase.com/docs/guides/realtime/limits)

---

### Pitfall 9: Revision Version State Sync Complexity

**What goes wrong:** Quillium's revision system stores multiple versions per revision (`versions[]` array with `activeVersionIndex`). Syncing this across peers is complex: if User A switches to version 2 while User B is editing version 1, what happens? Do both users see the switch? Does B's edit apply to version 1 or 2?

**Why it happens:** The revision system was designed for single-user workflows. Multi-version annotations are a state machine that's harder to distribute than simple text.

**Prevention:**
1. Define semantics clearly: is version switch local or shared?
2. Consider: each user has independent `activeVersionIndex` (their view), only the version content syncs
3. Alternatively: version switches are shared operations, all users see the same active version
4. Lock editing of inactive versions to avoid "editing a version someone else is about to delete"
5. Sync version content as separate entities, not nested in annotation state

**Detection:** Test: A edits version 1, B switches to version 2 and edits, A switches to version 2. Verify no data loss.

**Phase to address:** Client Collab Integration (Phase 3) — requires explicit design decision.

**Sources:**
- Quillium ARCHITECTURE.md (revision system documentation)

---

### Pitfall 10: Testing Concurrent Edits is Extremely Hard

**What goes wrong:** Teams build collab features, manual test with 2 browsers, ship. In production, edge cases emerge: rapid concurrent edits, network partitions, race conditions between reconnects and pushes. Bugs are hard to reproduce.

**Why it happens:** "Efficient testing of collaborative real-time editing tools (CRETs) is extremely challenging" — timing, ordering, and network conditions create a combinatorial explosion of states. Manual testing can't cover it.

**Prevention:**
1. Build a test harness that simulates N clients with configurable latency
2. Use property-based testing: generate random edit sequences, verify convergence
3. Implement a "chaos mode" that randomly delays/reorders messages
4. Log all operations with timestamps for post-hoc debugging
5. Quillium already has fuzz tests (`.fuzz.test.ts`); extend pattern to collab scenarios

**Detection:** Flaky CI tests that only fail sometimes → indicates race conditions.

**Phase to address:** All phases — but test infrastructure should be built alongside Phase 2 (Relay Server).

**Sources:**
- [IEEE: Test Case Generation for Collaborative Real-time Editing Tools](https://ieeexplore.ieee.org/document/4291044)

---

## Minor Pitfalls

Mistakes that cause friction or suboptimal UX.

### Pitfall 11: Thundering Herd on Reconnection

**What goes wrong:** Server restarts. 100 clients all reconnect simultaneously. Server is overwhelmed before it can stabilize.

**Prevention:**
1. Add jitter to reconnection delays (random backoff)
2. Implement connection rate limiting on server
3. Clients should not all use the same reconnection timing

**Phase to address:** Client Collab Integration (Phase 3).

---

### Pitfall 12: Cursor/Presence Position Mapping

**What goes wrong:** User A sees User B's cursor at position 50. User A types at position 30. User B's cursor should now be at position 51, but if presence updates are sent separately from doc changes, A might see B's cursor at the wrong position briefly.

**Prevention:**
1. Map cursor positions through the same `ChangeSet` as document changes
2. Send cursor updates atomically with or immediately after doc changes
3. Accept some transient inconsistency for presence (it's less critical than document sync)

**Phase to address:** Presence System (out of scope for prototype, but design for it).

---

### Pitfall 13: Network Efficiency (Chatty Protocol)

**What goes wrong:** Every keystroke triggers a push. On mobile or metered connections, this burns bandwidth and battery. Server sees 100 small messages instead of 1 batched message.

**Prevention:**
1. Debounce pushes (CodeMirror example uses 100ms)
2. Batch rapid changes into single updates
3. Use binary protocols (MessagePack) if JSON overhead is significant
4. Compress large change sets

**Phase to address:** Client Collab Integration (Phase 3).

---

### Pitfall 14: Fly.io Scaling Without Sticky Sessions

**What goes wrong:** Fly.io can run multiple instances. If document D's authority is on instance 1 but a client connects to instance 2, sync fails or requires inter-instance communication.

**Prevention:**
1. Use Fly.io's `fly-replay` header to route requests to specific instances
2. Or: make relay stateless, store authority state in Redis/Postgres
3. Or: single instance for prototype (acceptable at Fly's $7/mo tier)

**Phase to address:** Relay Server (Phase 2) — architecture decision.

**Sources:**
- [Fly.io Sticky Sessions](https://community.fly.io/t/session-affinity-sticky-sessions/638)

---

## Phase-Specific Warnings

| Phase | Likely Pitfall | Mitigation |
|-------|----------------|------------|
| Phase 1: Auth | JWT expiry during session | Implement token refresh in WebSocket protocol from day 1 |
| Phase 2: Relay Server | History accumulation, no rebasing | Implement snapshotting + `rebaseUpdates` before any client work |
| Phase 3: Client Integration | Annotation divergence, undo confusion | Design annotation sync semantics explicitly; test with 2+ clients |
| Phase 4: Offline Queue | Reconnection state desync | Persist pending changes locally; full-document fallback for long disconnects |
| Presence (deferred) | Cursor position drift | Map through same ChangeSets as document |

---

## Testing Recommendations

1. **Convergence tests:** Two clients make concurrent edits; after sync, documents must be identical (byte-for-byte).

2. **Annotation consistency tests:** Two clients create/edit annotations while editing document; after sync, both see same annotation positions.

3. **Latency simulation:** Test with 500ms, 1000ms, 2000ms artificial delays. Verify no starvation.

4. **Reconnection tests:** Kill WebSocket mid-edit, wait, reconnect. Verify no data loss.

5. **Stress tests:** 10+ concurrent editors, rapid typing. Verify no crashes, reasonable sync latency.

---

## Sources

### Official Documentation (HIGH confidence)
- [CodeMirror Collaborative Example](https://codemirror.net/examples/collab/)
- [CodeMirror Reference Manual](https://codemirror.net/docs/ref/)
- [Supabase Realtime Limits](https://supabase.com/docs/guides/realtime/limits)
- [@codemirror/collab npm](https://www.npmjs.com/package/@codemirror/collab)
- [GitHub codemirror/collab source](https://github.com/codemirror/collab/blob/main/src/collab.ts)

### Industry Experience (MEDIUM confidence)
- [CKEditor: Lessons Learned from Real-Time Collaboration](https://ckeditor.com/blog/lessons-learned-from-creating-a-rich-text-editor-with-real-time-collaboration/)
- [Liveblocks: Undo/Redo in Multiplayer](https://liveblocks.io/blog/how-to-build-undo-redo-in-a-multiplayer-environment)
- [WebSocket.org: Reconnection Guide](https://websocket.org/guides/reconnection/)
- [Ably: WebSocket Best Practices](https://ably.com/topic/websocket-architecture-best-practices)

### Research and Technical Deep Dives (MEDIUM confidence)
- [IEEE: Test Case Generation for Collaborative Real-time Editing Tools](https://ieeexplore.ieee.org/document/4291044)
- [Design Gurus: Real-Time Collaborative Document Editor](https://www.designgurus.io/blog/design-real-time-editor)
- [DEV Community: OT vs CRDTs](https://dev.to/puritanic/building-collaborative-interfaces-operational-transforms-vs-crdts-2obo)

### Deployment (MEDIUM confidence)
- [Fly.io: WebSockets and Fly](https://fly.io/blog/websockets-and-fly/)
- [Fly.io: Sticky Sessions Discussion](https://community.fly.io/t/session-affinity-sticky-sessions/638)
