# Phase 4: Relay Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 04-relay-core
**Areas discussed:** Runtime & Framework, Auth & Permissions, Document Rooms

---

## Runtime & Framework

### WebSocket Library
| Option | Description | Selected |
|--------|-------------|----------|
| ws (Recommended) | Minimal, fast, well-maintained. Standard choice for Node.js WebSocket servers. | |
| socket.io | Higher-level with rooms, reconnection, fallback. More abstraction but heavier. | ✓ |
| uWebSockets.js | Maximum performance (C++ bindings). Overkill for prototype scale. | |

**User's choice:** socket.io
**Notes:** Built-in room management and reconnection support valued over minimalism

### Language
| Option | Description | Selected |
|--------|-------------|----------|
| TypeScript (Recommended) | Type safety, better IDE support, matches Quillium client codebase style | ✓ |
| Plain JavaScript | Faster to write, no build step needed, simpler setup | |

**User's choice:** TypeScript

---

## Auth & Permissions

### JWT Validation
| Option | Description | Selected |
|--------|-------------|----------|
| Supabase Admin SDK (Recommended) | Use @supabase/supabase-js with service_role key. Validates JWT + can query permissions. | ✓ |
| Manual JWT verification | Verify signature with Supabase JWT secret. Lighter but separate permission queries. | |
| Supabase Edge Function proxy | Route through Supabase for validation. Extra hop but keeps secrets in Supabase. | |

**User's choice:** Supabase Admin SDK

### Invalid/Expired Token Handling
| Option | Description | Selected |
|--------|-------------|----------|
| Reject immediately (Recommended) | Close connection with error code. Client must re-auth and reconnect. | ✓ |
| Grace period | Allow connection briefly while client refreshes token. More complex flow. | |
| Read-only fallback | Accept connection but disallow writes. Unusual for this use case. | |

**User's choice:** Reject immediately

### Permission Check Frequency
| Option | Description | Selected |
|--------|-------------|----------|
| Once on connect (Recommended) | Check share token validity when joining room. Simpler, faster. | ✓ |
| Every message | Re-validate on each edit. More secure but significant DB load. | |
| Periodic refresh | Re-check every N minutes. Middle ground. | |

**User's choice:** Once on connect

---

## Document Rooms

### In-Memory State
| Option | Description | Selected |
|--------|-------------|----------|
| Version counter only (Recommended) | Track current version in memory, fetch updates from DB on demand. | ✓ |
| Full document + version | Keep document text in memory for faster rebaseUpdates. More memory. | |
| Recent updates buffer | Cache last N updates for fast catchup. Middle ground. | |

**User's choice:** Version counter only

### Reconnection Catchup
| Option | Description | Selected |
|--------|-------------|----------|
| Client requests from last version (Recommended) | Client tracks its version, requests missing updates on reconnect. | ✓ |
| Server pushes missed updates | Server tracks per-client state, pushes on reconnect. | |
| Full document sync | Always send full document on reconnect. Simple but wasteful. | |

**User's choice:** Client requests from last version

### Empty Room Handling
| Option | Description | Selected |
|--------|-------------|----------|
| Immediate cleanup (Recommended) | Remove room from memory when last client leaves. | |
| Keep alive briefly | Keep room for 30-60 seconds in case someone reconnects. | ✓ |
| Keep indefinitely | Never clean up rooms. Memory grows with active documents. | |

**User's choice:** Keep alive briefly
**Notes:** Smoother experience for brief network hiccups

---

## Claude's Discretion

- Socket.io configuration details
- Exact room cleanup timeout
- Error codes for auth failures
- Logging approach
- rebaseUpdates implementation (requirement RELY-03 provides guidance)

## Research-Based Revisions

After initial discussion, user requested research on Google Docs-style collaboration patterns.

### Research Sources
- [Google Docs Architecture](https://sderay.com/google-docs-architecture-real-time-collaboration/)
- [OT vs CRDT Best Practices](https://www.tiny.cloud/blog/real-time-collaboration-ot-vs-crdt/)
- [System Design Handbook](https://www.systemdesignhandbook.com/guides/google-docs-system-design/)

### Revised: In-Memory State
| Option | Description | Selected |
|--------|-------------|----------|
| Version counter only | Track current version in memory, fetch updates from DB on demand. | |
| Full document + version (Google-style) | Keep document text in memory for faster rebaseUpdates. | ✓ |
| Recent updates buffer | Cache last N updates for fast catchup. Middle ground. | |

**User's choice:** Full document + version (revised based on Google Docs research)
**Notes:** Google Docs keeps document in memory for fast OT transforms. Relay reloads from DB on restart.

### New: Reconnection Backoff
| Option | Description | Selected |
|--------|-------------|----------|
| Yes, relay sends retry hints | Relay sends 'retry-after' timing in disconnect messages. | ✓ |
| Client-side only | Socket.io handles backoff automatically. | |
| Skip for prototype | Not critical for 2-user dogfooding. | |

**User's choice:** Relay sends retry hints
**Notes:** Prevents thundering herd when many clients reconnect simultaneously

---

## Deferred Ideas

- OT ordering discussion skipped — user selected 3 of 4 areas, RELY-03 covers this
