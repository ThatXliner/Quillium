create table public.live_room_grants (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references public.sync_documents(id) on delete cascade,
    created_by uuid not null references public.users(id),
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    invited_email text check (invited_email = lower(trim(invited_email))),
    role text not null check (role in ('viewer', 'commenter', 'editor')),
    delivery_status text not null check (delivery_status in ('link', 'pending', 'sent', 'failed')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    expires_at timestamptz not null,
    revoked_at timestamptz,
    check (expires_at > created_at),
    check ((invited_email is null and delivery_status = 'link') or
        (invited_email is not null and delivery_status in ('pending', 'sent', 'failed')))
);

create index live_room_grants_document_id on public.live_room_grants(document_id);
alter table public.live_room_grants enable row level security;
revoke all on public.live_room_grants from anon, authenticated;
grant all on public.live_room_grants to service_role;
grant select (id, document_id, created_by, invited_email, role, delivery_status,
    created_at, updated_at, expires_at, revoked_at) on public.live_room_grants to authenticated;
create policy "Owners can inspect Live Room grants"
    on public.live_room_grants for select to authenticated
    using (exists (select 1 from public.sync_documents
        where sync_documents.id = live_room_grants.document_id
        and sync_documents.owner_id = (select auth.uid())));
