# Feature Landscape: Real-Time Collaborative Editing

**Domain:** Real-time collaborative text editing for desktop writing app
**Researched:** 2026-04-16
**Confidence:** HIGH (multiple authoritative sources, Context7 verification)

## Table Stakes

Features users expect from any collaborative editor. Missing these and users will consider the product incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Real-time sync** | Core promise of collaboration; Google Docs set the standard | High | Every keystroke visible within ~100ms; requires CRDT or OT |
| **Concurrent editing** | Multiple users edit simultaneously without conflicts | High | @codemirror/collab handles this, but Yjs is more robust for offline |
| **User identity** | Know who you're collaborating with | Low | Supabase Auth provides this; needed for cursor attribution |
| **Connection status indicator** | Users need to know if they're connected/synced | Low | Simple UI showing online/offline/syncing state |
| **Automatic conflict resolution** | Merging should be invisible and correct | High | Handled by CRDT/OT algorithm; Quillium uses @codemirror/collab |
| **Reconnection handling** | Seamlessly resume after network interruption | Medium | Queue local changes, sync on reconnect; owner-only offline is simpler |
| **Document sharing** | Invite others to collaborate on a document | Medium | Generate shareable link or invite by email; requires access control |
| **Permission levels** | Owner vs. editor vs. viewer roles | Medium | At minimum: owner (full control), editor (can edit), viewer (read-only) |

## Differentiators

Features that set the product apart. Not expected by all users, but highly valued when present.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Live cursors** | See where collaborators are working; feel "together" | Medium | Yjs Awareness protocol provides this; requires position tracking |
| **User avatars/colors** | Visual identity for each collaborator | Low | Assign consistent colors per user; show in cursor and annotation attribution |
| **Presence indicators** | See who's currently viewing the document | Low | List of active users in sidebar or header |
| **Follow mode** | Jump to and track another user's view | Medium | Like VS Code Live Share; keep your view synced with theirs |
| **Annotation sync** | Comments/revisions collaborate in real-time too | High | Quillium's existing annotation system must sync alongside text |
| **Offline editing for owner** | Owner can keep working without connection | Medium | Already scoped in PROJECT.md; collaborators are server-dependent |
| **Version history sync** | Named snapshots visible to all collaborators | Medium | Extend existing snapshot system to relay server storage |
| **Activity feed** | See recent changes and who made them | Medium | Log of actions: "Alice edited paragraph 3", "Bob added a comment" |
| **@mentions in comments** | Notify specific collaborators | Medium | Parse @username, send notification, highlight in thread |
| **Comment threading** | Nested replies in comments | Low | Quillium already has threading; ensure it syncs properly |
| **Resolve/reopen comments** | Mark discussion as done, but keep history | Low | Add resolved state to comment model; sync state changes |
| **Typing indicators** | See when someone is actively typing | Low | "Alice is typing..." near their cursor or in presence UI |
| **Session chat** | Quick messages without creating persistent comments | Medium | Ephemeral chat sidebar; not persisted in document |
| **Notification system** | Email/push for @mentions, new comments, edits | Medium | Requires backend infrastructure; out of scope for prototype |

## Anti-Features

Features to explicitly NOT build. Either too complex, wrong for the product, or actively harmful.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Complex permission granularity** | Over-engineering; most collaborators trust each other | Three levels max: owner/editor/viewer. Social process handles edge cases. |
| **Git-style branching** | Wrong mental model for writers; adds cognitive load | Single document with version snapshots. No merge conflicts for users to resolve. |
| **Manual conflict resolution** | Users shouldn't see merge conflicts | CRDT guarantees automatic convergence; design system to never surface conflicts |
| **Simultaneous different versions** | Confusing; which version is "real"? | One active version at a time; version history is read-only comparison |
| **Full revision history rewriting** | Too complex, adds little value for writers | Linear history only; no rebasing or squashing |
| **Real-time video/audio** | Scope creep; use Zoom/Meet instead | Link to external call if needed; don't build communication tools |
| **Mobile/web collaborative clients** | Out of scope per PROJECT.md | Desktop-only for prototype; web client is future product tier |
| **Collaborative AI editing** | Each user should control their own AI | AI features remain per-user; don't auto-apply AI suggestions to shared doc |
| **Undo other users' changes** | Confusing ownership; social friction | Each user can only undo their own changes (or use version history to restore) |
| **Page/section locking** | Ruins the "live" feeling; creates bottlenecks | Trust concurrent editing; visual awareness prevents accidental overwrites |

## Feature Dependencies

```
User identity (Auth) --> Document sharing --> Permission levels
                    |
                    +--> Real-time sync --> Concurrent editing --> Live cursors
                                       |
                                       +--> Connection status
                                       |
                                       +--> Annotation sync --> Comment threading
                                                           |
                                                           +--> @mentions --> Notifications (future)

Offline editing (owner) --> Reconnection handling --> Conflict resolution (automatic)

Presence indicators --> User avatars/colors --> Follow mode --> Typing indicators
```

## MVP Recommendation

**Prototype phase (per PROJECT.md scope):**

Prioritize:
1. **Real-time sync** - Core value proposition; two instances see each other's edits
2. **User identity** - Supabase Auth; know who's editing
3. **Connection status** - Users need to know sync state
4. **Automatic conflict resolution** - @codemirror/collab handles this
5. **Reconnection handling** - Basic queue for owner's offline edits
6. **Basic sharing** - Connect to document by ID (UI can be minimal)

Defer to post-prototype:
- **Live cursors** - Deferred per PROJECT.md; requires Supabase Realtime integration
- **Presence indicators** - Deferred per PROJECT.md; nice-to-have after core sync works
- **Follow mode** - Requires presence first
- **Permission levels** - Prototype assumes trusted collaborators; add editor/viewer later
- **Annotation sync** - Complex; may need Yjs migration for proper CRDT support
- **Version history sync** - Server-side snapshots need additional schema work
- **@mentions** - Requires notification infrastructure
- **Activity feed** - Nice-to-have after core features

**Post-prototype priorities (for production Omni):**

1. **Presence system** (cursors, online indicators, follow mode)
2. **Sharing UI + permissions** (invite by email, link sharing, permission levels)
3. **Annotation sync** (comments and revisions sync with text)
4. **Version history sync** (snapshots visible to all collaborators)
5. **Notification system** (@mentions, comment notifications)

## Quillium-Specific Considerations

### Existing Features That Interact with Collab

| Existing Feature | Collab Impact | Recommendation |
|------------------|---------------|----------------|
| **Annotations (comments/revisions)** | Must sync or be owner-only | Start owner-only; migrate to full sync post-prototype |
| **AutoAI** | Should remain per-user | AutoAI runs locally; suggestions are user's own |
| **Reader Personas** | Should remain per-user | Feedback is personal; don't broadcast to collaborators |
| **Version History** | Could sync or be owner-only | Start owner-only; sync snapshots post-prototype |
| **Undo/Redo** | Per-user or global? | Per-user undo; global undo is confusing |
| **Dictionary popover** | No collab impact | Purely local feature |

### Architecture Decision: @codemirror/collab vs Yjs

**@codemirror/collab (chosen for v1):**
- Pros: Already using CodeMirror; simpler integration; good enough for basic sync
- Cons: Less robust offline support; no built-in awareness/presence protocol

**Yjs (future migration path):**
- Pros: Better offline-first; built-in awareness; peer-to-peer possible; CRDT guarantees
- Cons: Requires replacing document model; more complex integration
- Recommendation: Migrate when presence features are prioritized

## Competitive Landscape Reference

| Competitor | Differentiating Features | Quillium Opportunity |
|------------|-------------------------|---------------------|
| Google Docs | Gold standard for real-time collab; live cursors; suggesting mode | Focus on writing-specific features (revisions, AI feedback) |
| Notion | Workspace/database paradigm; blocks; less real-time "feel" | Better real-time experience for prose writing |
| Figma | Multiplayer term; follow mode; smooth cursor rendering | Borrow UX patterns for presence |
| VS Code Live Share | Follow mode; shared terminals; debugging | Borrow follow mode UX for writing context |
| Overleaf | LaTeX collaboration; commenting; track changes | Quillium's revision system is more flexible |

## Sources

**Real-time collaboration architecture:**
- [CKEditor Collaborative Editing](https://ckeditor.com/collaborative-editing/)
- [Tiptap Collaboration](https://tiptap.dev/product/collaboration)
- [Liveblocks Text Editor](https://liveblocks.io/text-editor)
- [System Design: Real-Time Collaborative Editor](https://crackingwalnuts.com/post/collaborative-editor-system-design)

**CRDT and conflict resolution:**
- [Yjs Documentation - Awareness & Presence](https://docs.yjs.dev/getting-started/adding-awareness)
- [Building a Collaborative Document Editor (CRDTs)](https://codefarm0.medium.com/building-a-collaborative-document-editor-real-time-synchronization-crdts-and-conflict-resolution-4743436639f5)
- [Decipad's CRDT Implementation](https://www.decipad.com/blog/decipads-innovative-method-collaborative-and-offline-editing-using-crdts)

**Presence and UX:**
- [Figma Multiplayer Technology](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [VS Code Live Share - Follow Mode](https://learn.microsoft.com/en-us/visualstudio/liveshare/use/coedit-follow-focus-visual-studio-code)
- [Collaborative UX Best Practices](https://ably.com/blog/collaborative-ux-best-practices)

**Permissions and sharing:**
- [Box Collaborator Permission Levels](https://support.box.com/hc/en-us/articles/360044196413-Understanding-Collaborator-Permission-Levels)
- [Figma Sharing and Permissions Guide](https://help.figma.com/hc/en-us/articles/1500007609322-Guide-to-sharing-and-permissions)

**Anti-features and complexity:**
- [Upwelling: Real-time Collaboration + Version Control](https://www.inkandswitch.com/upwelling/) - Deliberately avoided Git-style history rewriting
- [Collaborative Text Editing without CRDTs or OT](https://mattweidner.com/2025/05/21/text-without-crdts.html) - Complexity analysis

**Context7 documentation:**
- CodeMirror documentation on document changes and collaboration extension points
- Yjs documentation on Awareness protocol for cursor/presence sync
