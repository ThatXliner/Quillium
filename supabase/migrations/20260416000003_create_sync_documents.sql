-- Migration: 20260416000003_create_sync_documents.sql
-- Purpose: Document registry for sync (DATA-02)
-- Source: RESEARCH.md, PATTERNS.md (no content column - doc content stored locally)

create table public.sync_documents (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid not null references public.users on delete cascade,
  title text default 'Untitled' not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- RLS skipped entirely for prototype (user preference over D-09 default)
-- MUST add RLS before production use

-- Auto-update timestamps via moddatetime
create trigger handle_updated_at before update on public.sync_documents
  for each row execute procedure extensions.moddatetime (updated_at);

-- Index for owner queries (RESEARCH.md: always index FK columns used in JOINs)
create index idx_sync_documents_owner on public.sync_documents (owner_id);

comment on table public.sync_documents is 'Registry of documents available for sync - DATA-02';
comment on column public.sync_documents.owner_id is 'Document owner (FK to public.users)';
comment on column public.sync_documents.title is 'Document title (metadata only, content stored locally)';
