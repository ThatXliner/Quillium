-- Migration: 20260416000004_create_collab_updates.sql
-- Purpose: Ordered OT updates from @codemirror/collab (DATA-03)
-- Source: RESEARCH.md Pattern 2, CONTEXT.md D-07/D-08

create table public.collab_updates (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.sync_documents on delete cascade,
  version bigint not null,
  client_id text not null,
  changes jsonb not null,
  created_at timestamptz default now() not null,

  -- Enforce version uniqueness per document (critical for OT ordering)
  unique (document_id, version)
);

-- RLS skipped entirely for prototype (user preference over D-09 default)
-- MUST add RLS before production use

-- Critical index for version queries (relay hot path)
-- Per RESEARCH.md: "relay must query max(version) from DB on document load"
create index idx_collab_updates_doc_version
  on public.collab_updates (document_id, version);

comment on table public.collab_updates is 'Ordered OT updates from @codemirror/collab - DATA-03';
comment on column public.collab_updates.version is 'Monotonic version assigned by relay server (D-08)';
comment on column public.collab_updates.client_id is 'Client identifier from @codemirror/collab clientID';
comment on column public.collab_updates.changes is 'Serialized ChangeSet JSON from CodeMirror';
