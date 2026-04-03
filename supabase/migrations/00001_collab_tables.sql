-- sync_documents: server-side document registry
create table sync_documents (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    title text not null default 'Untitled',
    content text not null default '',
    version integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- collab_updates: ordered change history for each document
create table collab_updates (
    id bigint generated always as identity primary key,
    document_id uuid not null references sync_documents(id) on delete cascade,
    version integer not null,
    changes jsonb not null,
    client_id text not null,
    created_at timestamptz not null default now(),
    unique (document_id, version)
);

-- shares: access grants for documents
create table shares (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references sync_documents(id) on delete cascade,
    token text not null unique default encode(gen_random_bytes(16), 'hex'),
    email text,
    permission text not null default 'view' check (permission in ('view', 'comment', 'edit')),
    created_at timestamptz not null default now()
);

-- Index for fast lookups
create index collab_updates_doc_version on collab_updates(document_id, version);
create index shares_token on shares(token);
create index sync_documents_owner on sync_documents(owner_id);

-- RLS: enable but keep policies simple for now (relay uses service role)
alter table sync_documents enable row level security;
alter table collab_updates enable row level security;
alter table shares enable row level security;

-- Owners can read their own documents
create policy "owners can read own documents"
    on sync_documents for select
    using (auth.uid() = owner_id);

-- Owners can insert their own documents
create policy "owners can insert own documents"
    on sync_documents for insert
    with check (auth.uid() = owner_id);

-- Owners can update their own documents
create policy "owners can update own documents"
    on sync_documents for update
    using (auth.uid() = owner_id);

-- Owners can delete their own documents
create policy "owners can delete own documents"
    on sync_documents for delete
    using (auth.uid() = owner_id);

-- Owners can manage shares for their documents
create policy "owners can manage shares"
    on shares for all
    using (
        exists (
            select 1 from sync_documents
            where sync_documents.id = shares.document_id
            and sync_documents.owner_id = auth.uid()
        )
    );
