# Roadmap: Quillium Omni

## Milestones

- ✅ **v1.0 Omni MVP** — Phases 1-8.5c shipped; Phases 9-13 deferred (shipped 2026-04-19) — see [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md)
- 📋 **v2.0 Realtime Sync Re-architecture** — planning

## Phases

<details>
<summary>✅ v1.0 Omni MVP (Phases 1-8.5c) — SHIPPED 2026-04-19</summary>

- [x] Phase 1: Data Model (3/3 plans) — completed 2025-04-17
- [x] Phase 2: Auth Foundation (2/2 plans)
- [x] Phase 3: Anonymous Auth (1/1 plan)
- [x] Phase 4: Relay Core (3/3 plans)
- [x] Phase 5: Relay Persistence (3/3 plans) — completed 2025-04-17
- [x] Phase 6: Client Collab (3/3 plans) — completed 2025-04-17
- [x] Phase 6.5: Collab Polish (4/4 plans, INSERTED) — completed 2025-04-17
- [x] Phase 7: Connection UX (1/1 plan) — completed 2026-04-19
- [x] Phase 7.5: Yjs Migration (7/7 plans, INSERTED)
- [x] Phase 8: Annotation Sync (6/6 plans)
- [x] Phase 8.5a: CRDT Data Shape (2/2 plans, INSERTED) — completed 2026-04-18
- [x] Phase 8.5b: CRDT Sync Plumbing (2/2 plans, INSERTED) — completed 2026-04-19
- [x] Phase 8.5c: CRDT Nested Editor Wiring (2/2 plans, INSERTED) — completed 2026-04-18

**Deferred to v2.0:**
- Phase 9: Fix Live Collab Revision Editing Bugs — tactical patches, architecture debt
- Phase 10: Strip Broken Collab Sync Layer — completed but part of a larger incomplete architectural effort
- Phase 11: Unified Subtree Sync Rebuild — completed but architecture still produces sync bugs
- Phase 12: Nested Editor Reunification — symptom patches; needs root-cause re-architecture
- Phase 13: Dogfooding Regression Suite — never planned

See [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md) for full details.

</details>

### 📋 v2.0 Realtime Sync Re-architecture (Planning)

**Scope:** Realtime sync of document text + revision versions (infinitely nested).

Phases to be defined during `/gsd-new-milestone`.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Data Model | v1.0 | 3/3 | Complete | 2025-04-17 |
| 2. Auth Foundation | v1.0 | 2/2 | Complete | - |
| 3. Anonymous Auth | v1.0 | 1/1 | Complete | - |
| 4. Relay Core | v1.0 | 3/3 | Complete | - |
| 5. Relay Persistence | v1.0 | 3/3 | Complete | 2025-04-17 |
| 6. Client Collab | v1.0 | 3/3 | Complete | 2025-04-17 |
| 6.5. Collab Polish | v1.0 | 4/4 | Complete | 2025-04-17 |
| 7. Connection UX | v1.0 | 1/1 | Complete | 2026-04-19 |
| 7.5. Yjs Migration | v1.0 | 7/7 | Complete | - |
| 8. Annotation Sync | v1.0 | 6/6 | Complete | - |
| 8.5a. CRDT Data Shape | v1.0 | 2/2 | Complete | 2026-04-18 |
| 8.5b. CRDT Sync Plumbing | v1.0 | 2/2 | Complete | 2026-04-19 |
| 8.5c. CRDT Nested Editor Wiring | v1.0 | 2/2 | Complete | 2026-04-18 |

---

## v2 Backlog

Ideas deferred from v1 that may become future phases.

| Item | Description | Deferred From |
|------|-------------|---------------|
| Shared Document Mode | Server as source of truth, owner-independent sessions (Google Docs model). Functionally equivalent to Live Room if owner stays online, but survives owner disconnect. Includes offline editing for all participants via Yjs persistence. | Phase 6 |
| Presence/Cursors | Online status, follow mode (PRES-01 through PRES-04). Note: live cursor positions already implemented in Phase 6.5. | v1 scope |
| Sharing UI | Share links, permissions, revoke access (SHAR-01 through SHAR-04) | v1 scope |

---
*Roadmap created: 2025-04-16*
*v1.0 shipped: 2026-04-19*
