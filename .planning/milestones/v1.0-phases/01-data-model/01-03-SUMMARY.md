---
phase: 01-data-model
plan: 03
subsystem: database
tags: [supabase, postgres, sharing, migrations]
dependency_graph:
  requires:
    - 01-02-SUMMARY.md (sync_documents table for FK reference)
  provides:
    - shares table with UUID share_token for Google Docs-style sharing
    - seed.sql placeholder for Phase 2 auth data
  affects:
    - Phase 4 relay server (will validate share tokens)
    - Phase 5 client share flow (will query shares table)
tech_stack:
  added: []
  patterns:
    - Google Docs-style sharing (single persistent link per document)
    - Partial index on share_token for enabled shares only
    - moddatetime trigger for automatic updated_at
key_files:
  created:
    - supabase/migrations/20260416000005_create_shares.sql
  modified:
    - supabase/seed.sql
decisions:
  - D-03 implemented: unique(document_id) constraint for one share per document
  - D-04 implemented: no email column, anyone with link can join
  - D-05 implemented: share_token uuid is updateable for reset capability
  - D-06 implemented: no expiry column on shares table
  - D-09 implemented: RLS not enabled (skipped for prototype)
metrics:
  duration: 1m 14s
  completed: 2026-04-17T05:14:45Z
---

# Phase 01 Plan 03: Shares Table and Seed Data Summary

Share token table for Google Docs-style document sharing with UUID tokens, plus seed.sql placeholder documenting auth dependency for Phase 2.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create shares table migration | 44f61fd | supabase/migrations/20260416000005_create_shares.sql |
| 2 | Create seed file placeholder | 3d0b41d | supabase/seed.sql |

## Implementation Details

### Shares Table (Task 1)

Created `public.shares` table with:
- `id uuid` primary key (auto-generated)
- `document_id uuid` FK to sync_documents with cascade delete
- `share_token uuid` for shareable links (resettable by owner per D-05)
- `enabled boolean` to disable sharing without deleting the share config
- `permission text` reserved for v2 granular permissions (defaults to 'edit')
- `unique (document_id)` constraint for one share config per document (D-03)
- Partial index `idx_shares_token` on share_token where enabled = true
- moddatetime trigger for automatic updated_at

Key design decisions from CONTEXT.md:
- No `email` column (D-04: anyone with link can join)
- No `expiry` column (D-06: no expiry for v1)
- RLS not enabled (D-09: prototype mode)

### Seed File (Task 2)

Updated `supabase/seed.sql` with:
- Documentation that auth.users cannot be seeded directly (Supabase managed)
- Example INSERT statement for test users (for use after Phase 2)
- Valid SQL SELECT statement as placeholder
- Clear reference to Phase 2 auth dependency

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

### Automated Checks (PASS)
- shares table contains `share_token uuid` column
- shares table contains `unique (document_id)` constraint
- shares table contains `enabled boolean` column
- shares table does NOT contain `email text` column
- shares table does NOT enable row level security
- seed.sql exists and contains valid SQL (SELECT statement)

### Migration Verification
Docker not available in this environment for `bunx supabase db reset`. Migration syntax verified via content inspection - all 5 migrations present in `supabase/migrations/`:
1. 20260416000001_enable_extensions.sql
2. 20260416000002_create_users.sql
3. 20260416000003_create_sync_documents.sql
4. 20260416000004_create_collab_updates.sql
5. 20260416000005_create_shares.sql (this plan)

## Self-Check: PASSED

### Files Exist
- FOUND: supabase/migrations/20260416000005_create_shares.sql
- FOUND: supabase/seed.sql

### Commits Exist
- FOUND: 44f61fd (Task 1: shares table migration)
- FOUND: 3d0b41d (Task 2: seed.sql placeholder)
