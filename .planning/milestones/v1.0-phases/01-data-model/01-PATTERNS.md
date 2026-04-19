# Phase 1: Data Model - Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 7
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/20260416000001_enable_extensions.sql` | migration | DDL | `.worktrees/sync-service-draft-1/supabase/migrations/00001_collab_tables.sql` | exact |
| `supabase/migrations/20260416000002_create_users.sql` | migration | DDL | `.worktrees/sync-service-draft-1/supabase/migrations/00001_collab_tables.sql` | exact |
| `supabase/migrations/20260416000003_create_sync_documents.sql` | migration | DDL | `.worktrees/sync-service-draft-1/supabase/migrations/00001_collab_tables.sql` | exact |
| `supabase/migrations/20260416000004_create_collab_updates.sql` | migration | DDL | `.worktrees/sync-service-draft-1/supabase/migrations/00001_collab_tables.sql` | exact |
| `supabase/migrations/20260416000005_create_shares.sql` | migration | DDL | `.worktrees/sync-service-draft-1/supabase/migrations/00001_collab_tables.sql` | exact |
| `supabase/seed.sql` | seed | test-data | (none in codebase) | no-analog |
| `supabase/config.toml` | config | config | `.worktrees/sync-service-draft-1/supabase/config.toml` | exact |

## Pattern Assignments

### `supabase/migrations/*` (migration, DDL)

**Analog:** `.worktrees/sync-service-draft-1/supabase/migrations/00001_collab_tables.sql`

**Table creation pattern** (lines 1-11):
```sql
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
```

**Update history table pattern** (lines 13-22):
```sql
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
```

**Share token table pattern** (lines 24-31):
```sql
-- shares: access grants for documents
create table shares (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references sync_documents(id) on delete cascade,
    token text not null unique default encode(gen_random_bytes(16), 'hex'),
    email text,
    permission text not null default 'view' check (permission in ('view', 'comment', 'edit')),
    created_at timestamptz not null default now()
);
```

**Index creation pattern** (lines 33-36):
```sql
-- Index for fast lookups
create index collab_updates_doc_version on collab_updates(document_id, version);
create index shares_token on shares(token);
create index sync_documents_owner on sync_documents(owner_id);
```

**RLS enable pattern** (lines 38-41):
```sql
-- RLS: enable but keep policies simple for now (relay uses service role)
alter table sync_documents enable row level security;
alter table collab_updates enable row level security;
alter table shares enable row level security;
```

**RLS policy pattern (for reference, D-09 defers policies)** (lines 43-56):
```sql
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
```

---

### `supabase/config.toml` (config, config)

**Analog:** `.worktrees/sync-service-draft-1/supabase/config.toml`

**Project ID and API config** (lines 1-18):
```toml
# For detailed configuration reference documentation, visit:
# https://supabase.com/docs/guides/local-development/cli/config
# A string used to distinguish different Supabase projects on the same host. Defaults to the
# working directory name when running `supabase init`.
project_id = "sync-service-draft-1"

[api]
enabled = true
# Port to use for the API URL.
port = 54321
# Schemas to expose in your API. Tables, views and stored procedures in this schema will get API
# endpoints. `public` and `graphql_public` schemas are included by default.
schemas = ["public", "graphql_public"]
# Extra schemas to add to the search_path of every request.
extra_search_path = ["public", "extensions"]
# The maximum number of rows returns from a view, table, or stored procedure. Limits payload size
# for accidental or malicious requests.
max_rows = 1000
```

**Database settings** (lines 27-37):
```toml
[db]
# Port to use for the local database URL.
port = 54322
# Port used by db diff command to initialize the shadow database.
shadow_port = 54320
# Maximum amount of time to wait for health check when starting the local database.
health_timeout = "2m"
# The database major version to use. This has to be the same as your remote database's. Run `SHOW
# server_version;` on the remote database to check.
major_version = 17
```

**Migrations and seed config** (lines 53-66):
```toml
[db.migrations]
# If disabled, migrations will be skipped during a db push or reset.
enabled = true
# Specifies an ordered list of schema files that describe your database.
# Supports glob patterns relative to supabase directory: "./schemas/*.sql"
schema_paths = []

[db.seed]
# If enabled, seeds the database after migrations during a db reset.
enabled = true
# Specifies an ordered list of seed files to load during db reset.
# Supports glob patterns relative to supabase directory: "./seeds/*.sql"
sql_paths = ["./seed.sql"]
```

---

## Shared Patterns

### Naming Conventions (from local SQLite schema)

**Source:** `src-tauri/src/db/schema.rs`
**Apply to:** All migration files

The local SQLite schema demonstrates project naming conventions:
```sql
-- Table names: snake_case, plural (documents, drafts, events, snapshots)
-- Column names: snake_case (created_at, updated_at, draft_id)
-- Index names: idx_{table}_{column} pattern (idx_events_draft, idx_snapshots_draft)
-- Primary keys: id column
-- Foreign keys: {related_table}_id pattern (document_id, draft_id)
-- Timestamps: INTEGER in local SQLite, timestamptz in Supabase
```

### Supabase-Specific Conventions (from RESEARCH.md)

**Apply to:** All migration files

Per RESEARCH.md patterns:
- Always use `timestamptz` (not `timestamp`) for timezone safety
- Always use `gen_random_uuid()` for UUID generation (database-side)
- Always `alter table X enable row level security` even with no policies
- Use `bigint generated always as identity` for auto-increment IDs
- Use `jsonb` for JSON columns (not `json` or `text`)
- Foreign keys: `references {table}(id) on delete cascade`

### Phase-Specific Decisions (from CONTEXT.md)

**Apply to:** All migration files

| Decision | Implementation |
|----------|----------------|
| D-01: No avatars | `users` table has `display_name text` only |
| D-03: Single link per doc | `shares` table has `unique (document_id)` |
| D-04: Anyone with link can join | No permission checking on share_token lookup |
| D-05: Token reset capability | `share_token uuid` is a separate column, resettable |
| D-07: One row per message | `collab_updates` stores one update per row |
| D-08: Version assigned by relay | `version bigint not null` with unique constraint |
| D-09: Zero RLS | Enable RLS but no policies (defer to production) |

### moddatetime Extension Pattern (from RESEARCH.md)

**Source:** RESEARCH.md Pattern 4
**Apply to:** users, sync_documents, shares tables

```sql
-- Enable moddatetime extension (in first migration)
create extension if not exists moddatetime schema extensions;

-- Apply to each table with updated_at column
create trigger handle_updated_at before update on public.users
  for each row execute procedure extensions.moddatetime (updated_at);
```

### User Profile Trigger Pattern (from RESEARCH.md)

**Source:** RESEARCH.md Pattern 1
**Apply to:** users table migration

```sql
-- Auto-create profile on signup
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.users (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'Anonymous'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

---

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `supabase/seed.sql` | seed | test-data | No seed files exist in codebase; create minimal test data |

**Recommendation for seed.sql:** Create minimal test data for local development. Include:
- 1-2 test users (for manual testing)
- 1-2 test documents (for verifying queries)
- No collab_updates (these are created by relay)
- 1 share record (for testing share link flow)

---

## Differences from Worktree Analog

The existing `.worktrees/sync-service-draft-1/supabase/migrations/00001_collab_tables.sql` is a good starting point but needs adjustments per CONTEXT.md decisions:

| Worktree Pattern | Phase 1 Adjustment | Reason |
|------------------|-------------------|--------|
| No `users` table | Add `users` table | DATA-01 requires user profiles |
| `sync_documents.content text` | Remove `content` column | Doc content stored locally, only metadata syncs |
| `sync_documents.version integer` | Consider removing | Version tracking is per-update, not per-document |
| `shares.token text` | Change to `share_token uuid` | D-03 uses UUID for Google Docs-style links |
| `shares.email text` | Remove | D-04 says anyone with link can join |
| RLS policies included | Remove policies | D-09 defers RLS to production |
| Single migration file | Split into 5 files | RESEARCH.md recommends modular migrations |
| No moddatetime | Add moddatetime triggers | RESEARCH.md Pattern 4 |
| No user signup trigger | Add signup trigger | RESEARCH.md Pattern 1 |

---

## Metadata

**Analog search scope:** 
- `/Users/bryanhu/Developer/current/Quillium/**/*.sql`
- `/Users/bryanhu/Developer/current/Quillium/src-tauri/src/db/**/*.rs`
- `/Users/bryanhu/Developer/current/Quillium/.worktrees/sync-service-draft-1/supabase/`

**Files scanned:** 8
**Pattern extraction date:** 2026-04-16
