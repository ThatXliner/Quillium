-- Migration: 20260417000001_create_collab_snapshots.sql
-- Purpose: Periodic document snapshots for fast state reconstruction (RELY-05, RELY-06)
-- Source: RESEARCH.md D-41 (periodic snapshots for fast state reconstruction)

create table public.collab_snapshots (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.sync_documents on delete cascade,
  version bigint not null,
  state_json text not null,
  created_at timestamptz default now() not null,

  -- Enforce one snapshot per version (prevents duplicate snapshots)
  unique (document_id, version)
);

-- RLS skipped entirely for prototype (matching Phase 1 pattern)
-- MUST add RLS before production use

-- Index for fast latest-snapshot queries (descending for ORDER BY version DESC LIMIT 1)
-- Per D-41: "load latest snapshot + replay updates since" is the hot path on restart
create index idx_collab_snapshots_doc_version
  on public.collab_snapshots (document_id, version desc);

comment on table public.collab_snapshots is 'Periodic document snapshots for fast state reconstruction - D-41';
comment on column public.collab_snapshots.version is 'Document version at snapshot creation time';
comment on column public.collab_snapshots.state_json is 'Full document text at snapshot time (not ChangeSet)';
