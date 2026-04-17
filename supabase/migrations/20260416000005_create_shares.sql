-- Migration: 20260416000005_create_shares.sql
-- Purpose: Share tokens for document access - Google Docs style (DATA-04)
-- Source: RESEARCH.md Pattern 3, CONTEXT.md D-03/D-04/D-05/D-06

create table public.shares (
  id uuid default gen_random_uuid() primary key,
  document_id uuid not null references public.sync_documents on delete cascade,
  share_token uuid default gen_random_uuid() not null,
  enabled boolean default true not null,
  permission text default 'edit' not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,

  -- D-03: One share config per document (Google Docs style)
  unique (document_id)
);

-- RLS skipped entirely for prototype (user preference over D-09 default)
-- MUST add RLS before production use

-- Auto-update timestamps via moddatetime
create trigger handle_updated_at before update on public.shares
  for each row execute procedure extensions.moddatetime (updated_at);

-- Token lookup index (partial for enabled only)
-- Per RESEARCH.md: "Token lookup index (partial for enabled only)"
create index idx_shares_token on public.shares (share_token) where enabled = true;

comment on table public.shares is 'Share tokens for document access (Google Docs style) - DATA-04';
comment on column public.shares.share_token is 'UUID token used in share links, resetable by owner (D-05)';
comment on column public.shares.enabled is 'Owner can disable sharing (D-05)';
comment on column public.shares.permission is 'Reserved for v2 granular permissions, default edit (D-04)';
