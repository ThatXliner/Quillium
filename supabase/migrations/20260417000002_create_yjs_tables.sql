-- Migration: 20260417000002_create_yjs_tables.sql
-- Purpose: Yjs state persistence tables for relay server (per D-73)
-- Source: quillium-landing/supabase/migrations/20260417180000_yjs_tables.sql
-- The relay server in quillium-landing persists Yjs document state here.

-- Full document state snapshots
create table if not exists public.yjs_documents (
    document_id uuid primary key references public.sync_documents(id) on delete cascade,
    state_update text not null, -- base64 encoded Uint8Array
    state_vector text,          -- base64 encoded state vector for incremental sync
    updated_at timestamptz not null default now()
);

-- Incremental updates between snapshots (for crash recovery)
create table if not exists public.yjs_updates (
    id bigserial primary key,
    document_id uuid not null references public.sync_documents(id) on delete cascade,
    update_data text not null, -- base64 encoded Uint8Array
    created_at timestamptz not null default now()
);

-- Index for efficient update retrieval
create index if not exists idx_yjs_updates_document_id
    on public.yjs_updates(document_id, created_at);

-- RLS skipped entirely for prototype (consistent with other collab tables)
-- MUST add RLS before production use

comment on table public.yjs_documents is 'Yjs full document state snapshots (base64 encoded)';
comment on table public.yjs_updates is 'Incremental Yjs updates between snapshots';
