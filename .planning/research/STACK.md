# Technology Stack: Real-Time Collaboration for Quillium

**Project:** Quillium Omni
**Researched:** 2026-04-16
**Overall Confidence:** HIGH

---

## Executive Summary

The standard 2025/2026 stack for adding real-time collaboration to a CodeMirror editor consists of two viable approaches: **@codemirror/collab** (operational transformation with central authority) or **Yjs** (CRDT with decentralized conflict resolution). Given Quillium's existing architecture decision to use `@codemirror/collab` for v1, this document validates that choice and specifies the complete technology stack.

**Key finding:** `@codemirror/collab` is the correct choice for Quillium's prototype because:
1. Already using CodeMirror's state model throughout (StateFields, effects, undo integration)
2. Simpler server implementation (thin relay, not CRDT sync)
3. Quillium's annotation system (comments, revisions, suggestions) already uses StateEffects which `@codemirror/collab` can sync via `sharedEffects`
4. Yjs migration remains a future option if offline-first or peer-to-peer becomes necessary

---

## Recommended Stack

### Core Collaboration Framework

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| `@codemirror/collab` | 6.1.1 | OT-based collaborative editing | HIGH |

**Why:** Native CodeMirror integration. Uses the same transaction/effect model Quillium already uses for annotations. Central authority pattern matches the relay server architecture in PROJECT.md. Last modified April 2026 (npm shows 2026-04-13), indicating active maintenance.

**Rationale over Yjs:**
- Quillium's annotation system (`annotationField.ts`) already uses StateEffects for all mutations
- `@codemirror/collab` supports syncing custom StateEffects via `sharedEffects` callback
- No need to maintain two state models (Yjs Y.Doc + CodeMirror state)
- Simpler server: relay just orders changes, doesn't need CRDT merge logic
- Yjs binding (`y-codemirror.next` 0.3.5) last published June 2024, less active

### Authentication

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| `@supabase/supabase-js` | 2.103.3 | Auth client for Tauri desktop | HIGH |
| Supabase Auth (hosted) | N/A | Email/password + OAuth backend | HIGH |

**Why:** PROJECT.md specifies Supabase Auth over license keys for collab identity ("who's typing" UX). Active maintenance (last modified April 2026). Documented patterns exist for Tauri + Supabase OAuth via deep links.

**Implementation notes:**
- Use PKCE flow for desktop OAuth
- In dev: OAuth in Tauri webview (deep links require bundled .app)
- In prod: External browser flow with deep link redirect
- Store session in localStorage (Supabase's native storage has Tauri compatibility issues)

### Relay Server

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| Node.js | 20+ LTS | Runtime for relay server | HIGH |
| `ws` | 8.x | WebSocket server | HIGH |
| PostgreSQL (Supabase) | N/A | Persist `collab_updates` table | HIGH |

**Why:** PROJECT.md specifies Node.js WebSocket relay hosted on Fly.io. The relay is intentionally thin: receives changes, assigns version numbers, broadcasts to peers, persists to `collab_updates` table in Supabase Postgres.

**Not using Hocuspocus/y-websocket:** Those are Yjs-specific. `@codemirror/collab` needs a simpler authority server that:
1. Accepts `pushUpdates` (changes + clientID + version)
2. Rebases if version mismatch
3. Broadcasts to other connected peers
4. Stores ordered history in Postgres

### Hosting

| Technology | Estimated Cost | Purpose | Confidence |
|------------|----------------|---------|------------|
| Fly.io | ~$5-7/month | WebSocket relay hosting | HIGH |
| Supabase (Free tier) | $0 | Auth + Postgres | HIGH |

**Why:** PROJECT.md already specifies Fly.io (~$7/mo). WebSocket support is first-class on Fly.io with automatic TLS. Supabase free tier covers prototype needs (50K monthly active users, 500MB database).

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lib0` | 0.2.x | Encoding utilities for wire protocol | Optional: efficient binary encoding |
| `uuid` | 9.x | Client ID generation | Generating unique peer identifiers |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Collab framework | `@codemirror/collab` | Yjs + `y-codemirror.next` | Adds CRDT complexity; annotation StateEffects don't map cleanly to Y.Map; would need dual state model |
| Collab framework | `@codemirror/collab` | Liveblocks | Hosted service cost; less control over sync logic |
| Relay server | Custom Node.js | Hocuspocus | Yjs-specific; overkill for OT relay |
| Relay server | Custom Node.js | PartyKit | Edge deployment is overkill for prototype; adds vendor lock-in |
| Auth | Supabase Auth | License keys (#194) | Collab needs identity for presence; license keys are anonymous |
| Auth | Supabase Auth | Firebase Auth | Already using Supabase for Postgres; no benefit to splitting |
| Hosting | Fly.io | Railway/Render | Fly.io WebSocket support is more mature; ~same cost |

---

## What NOT to Use

### Yjs for v1

**Why avoid (for now):**
1. Quillium's annotation system is deeply integrated with CodeMirror's StateEffect model
2. Syncing annotations with Yjs would require:
   - Separate Y.Map for annotations alongside Y.Text for document
   - Custom conflict resolution for annotation positions
   - Maintaining two sources of truth (Yjs state + CodeMirror annotationField)
3. `y-codemirror.next` only syncs Y.Text, not custom StateEffects
4. More complex server (CRDT sync vs. simple ordering)

**When to reconsider:** If offline-first editing for collaborators becomes a requirement, or if peer-to-peer sync is needed.

### Liveblocks

**Why avoid:**
1. Hosted service adds ongoing cost ($99/month for Starter)
2. Less control over sync logic
3. Prototype goal is validating architecture, not shipping quickly

### Supabase Realtime for Document Sync

**Why avoid:**
1. Supabase Realtime is broadcast-based, not designed for OT/CRDT
2. Community Yjs providers (`y-supabase`) are experimental, not production-ready
3. Use Supabase Realtime only for presence (cursors, online indicators) — out of scope for prototype

---

## Syncing Quillium's Annotations

### The Challenge

Quillium's annotation system uses StateEffects for all mutations:
- `addAnnotation`, `removeAnnotation`
- `updateThread` (comment messages)
- `_addVersionToRevision`, `_deleteVersionFromRevision` (revision versions)
- `_updateActiveRevisionVersion`, `_updateRevisionVersionState`

These must sync across peers.

### The Solution: `sharedEffects`

`@codemirror/collab` supports syncing custom StateEffects via the `sharedEffects` option:

```typescript
import { collab, getSyncedVersion, sendableUpdates, receiveUpdates } from "@codemirror/collab";

const collabExtension = collab({
    startVersion: initialVersion,
    clientID: uniqueClientId,
    sharedEffects: (tr) => {
        // Filter transaction effects to find annotation-related ones
        return tr.effects.filter(e => 
            e.is(addAnnotation) ||
            e.is(removeAnnotation) ||
            e.is(updateThread) ||
            // ... other annotation effects
        );
    }
});
```

### Position Mapping Caveat

From CodeMirror docs: "the kind of position mapping done in the effect's `map` function is not guaranteed to converge to the same positions when applied in different order by different peers."

**Mitigation:** Annotation positions may diverge slightly. For comments/revisions, this is usually harmless (highlights the approximate region). For critical precision, implement periodic position reconciliation via the server.

---

## Installation

```bash
# Core collaboration
bun add @codemirror/collab

# Auth (if not already installed)
bun add @supabase/supabase-js

# Server-side (in quillium-landing repo)
bun add ws

# Optional: efficient encoding
bun add lib0

# Dev dependency for client ID
bun add uuid
bun add -D @types/uuid
```

---

## Wire Protocol Sketch

### Client -> Server

```typescript
// Push local changes
{
    type: "pushUpdates",
    documentId: string,
    version: number,
    updates: Array<{
        changes: ChangeSet (JSON serialized),
        effects: StateEffect[] (JSON serialized),
        clientID: string
    }>
}

// Pull new changes
{
    type: "pullUpdates",
    documentId: string,
    version: number
}
```

### Server -> Client

```typescript
// Broadcast updates
{
    type: "updates",
    updates: Array<{
        changes: ChangeSet,
        effects: StateEffect[],
        clientID: string
    }>
}

// Initial document state
{
    type: "document",
    version: number,
    doc: string,
    annotations: Annotations
}
```

---

## Version Verification

All versions verified via npm registry on 2026-04-16:

| Package | Version | Last Modified |
|---------|---------|---------------|
| `@codemirror/collab` | 6.1.1 | 2026-04-13 |
| `@supabase/supabase-js` | 2.103.3 | 2026-04-16 |
| `yjs` | 13.6.30 | 2026-03-14 |
| `y-codemirror.next` | 0.3.5 | 2024-06-18 |
| `y-websocket` | 3.0.0 | 2026-03-24 |
| `@hocuspocus/server` | 3.4.4 | 2026-04-16 |

---

## Sources

### Official Documentation
- [CodeMirror Collaborative Editing Example](https://codemirror.net/examples/collab/)
- [CodeMirror Reference Manual](https://codemirror.net/docs/ref/)
- [Yjs CodeMirror Binding](https://docs.yjs.dev/ecosystem/editor-bindings/codemirror)
- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)

### Implementation References
- [Fly.io WebSocket Support](https://fly.io/blog/websockets-and-fly/)
- [Fly.io Pricing](https://fly.io/pricing/)
- [Tauri + Supabase OAuth Guide](https://medium.com/@nathancovey23/supabase-google-oauth-in-a-tauri-2-0-macos-app-with-deep-links-f8876375cb0a)

### Ecosystem Comparisons
- [CRDT Implementation Guide (Velt, 2025)](https://velt.dev/blog/crdt-implementation-guide-conflict-free-apps)
- [Yjs WebSocket Server Guide (Velt, 2025)](https://velt.dev/blog/yjs-websocket-server-real-time-collaboration)
- [y-codemirror.next GitHub](https://github.com/yjs/y-codemirror.next)
- [@codemirror/collab GitHub](https://github.com/codemirror/collab)
