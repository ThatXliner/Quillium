# Phase 1: Data Model - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 01-data-model
**Areas discussed:** User Profile, Share Token Design, Update Storage, RLS Policies

---

## User Profile Fields

| Option | Description | Selected |
|--------|-------------|----------|
| Display names + avatars | Store uploaded avatar images | |
| Display names only | Auto-generate avatars client-side | ✓ |
| Full profile (bio, etc.) | Extended user profiles | |

**User's choice:** Display names only, avatars auto-generated from display name
**Notes:** Keeps users table minimal, no file storage needed for v1

---

## Share Token Design

| Option | Description | Selected |
|--------|-------------|----------|
| Google Docs style | Persistent link, anyone can join, owner can reset/disable | ✓ |
| Granular permissions | View/comment/edit levels per share | |
| Expiring links | Time-limited access tokens | |
| Single-use links | One-time join tokens | |

**User's choice:** Google Docs style — simple, familiar
**Notes:** Granular permissions deferred to v2 (SHAR-01)

---

## Update Storage Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Individual operations | One row per character/edit | |
| Time-based batching | Batch ops every N seconds | |
| Store what client sends | One row per WebSocket message | ✓ |

**User's choice:** Store what the client sends
**Notes:** Natural batching from @codemirror/collab protocol. Each row = one version number.

---

## RLS Policies

| Option | Description | Selected |
|--------|-------------|----------|
| Full RLS | Strict row-level security from day one | |
| Zero RLS (prototype) | All tables publicly accessible | ✓ |
| Partial RLS | Protect users table only | |

**User's choice:** Zero RLS for prototype
**Notes:** ⚠️ DANGEROUS — explicitly acknowledged. Must add RLS before production.

---

## Claude's Discretion

- Exact column types and nullable fields
- Index strategy
- Migration file organization

## Deferred Ideas

- Granular share permissions (v2)
- Share link expiry
- Row-level security (CRITICAL for production)
