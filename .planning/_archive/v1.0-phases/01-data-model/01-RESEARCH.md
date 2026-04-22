# Phase 1: Data Model - Research

**Researched:** 2026-04-16
**Domain:** Supabase Postgres schema design for real-time collaboration
**Confidence:** HIGH

## Summary

This phase creates the foundational Supabase Postgres tables for Quillium Omni: user profiles, document registry, collaborative updates, and share tokens. The data model must support @codemirror/collab's version-ordered update storage and Google Docs-style sharing with persistent links.

Supabase provides a managed Postgres instance with built-in auth (auth.users table), Row-Level Security (RLS), and timestamptz handling. The standard pattern is to create a `public.profiles` table that references `auth.users(id)` via foreign key, populated by a database trigger on signup. For collaboration, updates need sequential version numbers assigned by the relay server, stored in `collab_updates`. Share tokens use UUIDs stored in a `shares` table.

**Primary recommendation:** Use Supabase CLI migrations (`supabase migration new`) to create four tables (`users`, `sync_documents`, `collab_updates`, `shares`) with timestamptz columns, UUID primary keys, appropriate foreign keys, and the moddatetime extension for automatic `updated_at` tracking. Defer RLS policies to a future phase as decided in CONTEXT.md.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** `users` table stores display names only (no avatars stored)
- **D-02:** Avatars auto-generated from display name (client-side, e.g., initials or identicon)
- **D-03:** Google Docs style sharing — single persistent link per document
- **D-04:** Anyone with the link can join (no granular permission levels for v1)
- **D-05:** Owner can reset token (invalidates old link) or disable sharing entirely
- **D-06:** No expiry on share links for v1
- **D-07:** One `collab_updates` row per WebSocket message (natural batching from @codemirror/collab)
- **D-08:** Each row = one version number assigned by relay
- **D-09:** Zero RLS for prototype — all tables publicly accessible with valid Supabase auth

### Claude's Discretion
- Exact column types and nullable fields
- Index strategy beyond required foreign keys
- Migration file organization

### Deferred Ideas (OUT OF SCOPE)
- Granular share permissions (view/comment/edit) — v2 feature (SHAR-01)
- Share link expiry — not needed for dogfooding
- Row-level security — **CRITICAL: Must add before any production use**
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | `users` table for profiles and subscription status | Standard Supabase pattern: `public.users` with FK to `auth.users(id)`, trigger auto-populates on signup |
| DATA-02 | `sync_documents` table for document registry | UUID primary key, owner FK to users, title, timestamps, sharing state |
| DATA-03 | `collab_updates` table for ordered change history | Sequential version bigint, document FK, changes JSON, client_id for OT attribution |
| DATA-04 | `shares` table for access grants with tokens and permissions | UUID share_token, document FK, enabled flag, permission field (defer granular to v2) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Schema definition | Database / Storage | -- | Pure Postgres DDL, no application code |
| User profile storage | Database / Storage | -- | Extends auth.users, lives entirely in DB |
| Document registry | Database / Storage | -- | Metadata storage, queried by client/relay |
| Update history | Database / Storage | -- | Append-only log of OT changes |
| Share token validation | Database / Storage | API / Backend | DB stores tokens, relay validates on connect |
| Auto-timestamp updates | Database / Storage | -- | moddatetime extension handles it |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Supabase CLI | 2.92.0 | Migration management | [VERIFIED: npm registry] Official tooling for Supabase projects |
| @supabase/supabase-js | 2.103.3 | Client SDK (future phases) | [VERIFIED: npm registry] Required for client auth integration |
| PostgreSQL | 15+ | Database engine | [CITED: supabase.com/docs] Managed by Supabase, supports all required features |
| moddatetime | (extension) | Auto-update timestamps | [CITED: supabase.com/docs] Built-in Postgres extension for updated_at |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @codemirror/collab | 6.1.1 | OT collaboration | [VERIFIED: npm registry] Already decided in PROJECT.md, informs update storage |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| moddatetime | Custom trigger function | More control but more code to maintain |
| UUID PK | bigint identity | UUID enables offline key generation, better for distributed clients |
| timestamptz | timestamp | timestamptz handles timezone correctly, always use it |

**Installation:**
```bash
# Supabase CLI (for migrations)
bun add -D supabase

# Initialize Supabase locally (if not already)
bunx supabase init
```

**Version verification:**
- `supabase` CLI: 2.92.0 (verified 2026-04-16)
- `@supabase/supabase-js`: 2.103.3 (verified 2026-04-16)
- `@codemirror/collab`: 6.1.1 (verified 2026-04-16)

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Supabase Postgres                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────────┐                       │
│  │  auth.users  │◄───│  public.users    │                       │
│  │  (managed)   │ FK │  (profiles)      │                       │
│  └──────────────┘    └────────┬─────────┘                       │
│                               │                                 │
│                               │ FK (owner_id)                   │
│                               ▼                                 │
│                    ┌──────────────────┐                         │
│                    │  sync_documents  │                         │
│                    │  (doc registry)  │                         │
│                    └────────┬─────────┘                         │
│                             │                                   │
│              ┌──────────────┼──────────────┐                    │
│              │ FK           │              │ FK                 │
│              ▼              │              ▼                    │
│   ┌──────────────────┐      │     ┌──────────────────┐          │
│   │  collab_updates  │      │     │     shares       │          │
│   │  (OT changes)    │      │     │  (share tokens)  │          │
│   └──────────────────┘      │     └──────────────────┘          │
│                             │                                   │
│                             │ (trigger on auth.users insert)    │
│                             │                                   │
│   ┌─────────────────────────┴───────────────────────────────┐   │
│   │  handle_new_user() - auto-populates public.users        │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
supabase/
├── migrations/
│   ├── 20260416000001_enable_extensions.sql
│   ├── 20260416000002_create_users.sql
│   ├── 20260416000003_create_sync_documents.sql
│   ├── 20260416000004_create_collab_updates.sql
│   └── 20260416000005_create_shares.sql
├── seed.sql                    # Test data for local dev
└── config.toml                 # Supabase project config
```

### Pattern 1: User Profile with Auth FK

**What:** Create a `public.users` table that references `auth.users(id)` with cascade delete, auto-populated via trigger.

**When to use:** Always when extending Supabase Auth with custom profile data.

**Example:**
```sql
-- Source: https://supabase.com/docs/guides/auth/managing-user-data

-- Enable UUID extension if not already
create extension if not exists "uuid-ossp";

create table public.users (
  id uuid not null references auth.users on delete cascade,
  display_name text,
  subscription_status text default 'free',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  primary key (id)
);

-- Trigger to auto-create profile on signup
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.users (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

### Pattern 2: Version-Ordered Updates for OT

**What:** Store each @codemirror/collab update with a sequential version number for replay.

**When to use:** Storing collaborative editing changes with deterministic ordering.

**Example:**
```sql
-- Source: https://codemirror.net/examples/collab/

create table public.collab_updates (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.sync_documents on delete cascade,
  version bigint not null,  -- assigned by relay, monotonic per document
  client_id text not null,  -- from @codemirror/collab clientID
  changes jsonb not null,   -- serialized ChangeSet
  created_at timestamptz default now() not null,
  
  unique (document_id, version)  -- enforce version uniqueness per doc
);

create index idx_collab_updates_doc_version 
  on public.collab_updates (document_id, version);
```

### Pattern 3: Share Token (Google Docs Style)

**What:** Single persistent UUID token per document, owner can reset or disable.

**When to use:** Implementing "anyone with link can join" sharing.

**Example:**
```sql
-- Source: https://github.com/orgs/supabase/discussions/13352

create table public.shares (
  id uuid default gen_random_uuid() primary key,
  document_id uuid not null references public.sync_documents on delete cascade,
  share_token uuid default gen_random_uuid() not null,  -- the shareable link token
  enabled boolean default true not null,
  permission text default 'edit' not null,  -- for v2 granularity
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  
  unique (document_id)  -- one share config per document
);

create index idx_shares_token on public.shares (share_token) where enabled = true;
```

### Pattern 4: Automatic updated_at with moddatetime

**What:** Use Postgres moddatetime extension to auto-update `updated_at` on row changes.

**When to use:** Any table with an `updated_at` column.

**Example:**
```sql
-- Source: https://dev.to/paullaros/updating-timestamps-automatically-in-supabase-5f5o

create extension if not exists moddatetime schema extensions;

-- Apply to each table
create trigger handle_updated_at before update on public.users
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at before update on public.sync_documents
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at before update on public.shares
  for each row execute procedure extensions.moddatetime (updated_at);
```

### Anti-Patterns to Avoid

- **Modifying auth.users directly:** Supabase manages this table internally. Always create a separate public table with FK reference. [CITED: supabase.com/docs/guides/auth/managing-user-data]
- **Using timestamp instead of timestamptz:** Always use `timestamptz` for proper timezone handling in Postgres. [CITED: supabase.com/docs/guides/database/tables]
- **Storing updates without version ordering:** @codemirror/collab requires sequential version numbers for OT to work. Random IDs won't work. [CITED: codemirror.net/examples/collab/]
- **Skipping RLS enable even with no policies:** Always `alter table X enable row level security` even if deferring policies. Tables without RLS enabled are publicly accessible via Supabase API. [CITED: supabase.com/docs/guides/database/postgres/row-level-security]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Updated timestamps | Custom application code | moddatetime extension | Database handles it atomically, no client coordination |
| User profile creation | Application signup handler | Postgres trigger | Guarantees profile exists, no race conditions |
| UUID generation | Client-side UUID libs | `gen_random_uuid()` | Database generates, no import needed |
| Version number assignment | Client-generated versions | Relay-assigned bigint | Central authority required for OT ordering |

**Key insight:** Supabase Postgres is the authority for data integrity. Push constraints, triggers, and automation into the database layer rather than application code.

## Common Pitfalls

### Pitfall 1: Forgetting to Enable RLS
**What goes wrong:** Tables are publicly accessible via Supabase API even with zero policies.
**Why it happens:** Developers assume "no policies = no access" but Postgres default is open.
**How to avoid:** Always run `alter table X enable row level security` immediately after creating any table.
**Warning signs:** Data visible in Supabase dashboard API explorer without authentication.

### Pitfall 2: Using timestamp Instead of timestamptz
**What goes wrong:** Time comparisons fail across timezones, daylight saving bugs.
**Why it happens:** `timestamp` is shorter to type, seems equivalent.
**How to avoid:** Always use `timestamptz` for any time column. Add to code review checklist.
**Warning signs:** Times off by hours when comparing client/server or across regions.

### Pitfall 3: Missing Index on Foreign Key Columns
**What goes wrong:** Slow joins and cascade deletes as data grows.
**Why it happens:** Postgres doesn't auto-index FK columns (unlike primary keys).
**How to avoid:** Create index on every FK column used in JOINs or WHERE clauses.
**Warning signs:** Query plans show sequential scans on large tables.

### Pitfall 4: Nullable Version Numbers
**What goes wrong:** OT rebase fails with null comparisons.
**Why it happens:** Forgetting `not null` constraint on version column.
**How to avoid:** Always `bigint not null` for version columns, with unique constraint per document.
**Warning signs:** `Cannot read property of null` errors in relay version comparison.

### Pitfall 5: Mixing Schema Namespaces
**What goes wrong:** RLS policies don't apply, unexpected access patterns.
**Why it happens:** Creating tables in `auth` schema instead of `public`.
**How to avoid:** Always create application tables in `public` schema, never modify `auth` schema.
**Warning signs:** Tables visible in auth schema in dashboard.

## Code Examples

### Complete Migration: users table

```sql
-- Migration: 20260416000002_create_users.sql
-- Source: https://supabase.com/docs/guides/auth/managing-user-data

create table public.users (
  id uuid not null references auth.users on delete cascade,
  display_name text,
  subscription_status text default 'free' not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  primary key (id)
);

-- Enable RLS (no policies for prototype per D-09)
alter table public.users enable row level security;

-- Auto-update timestamps
create trigger handle_updated_at before update on public.users
  for each row execute procedure extensions.moddatetime (updated_at);

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

comment on table public.users is 'User profiles extending auth.users';
```

### Complete Migration: sync_documents table

```sql
-- Migration: 20260416000003_create_sync_documents.sql

create table public.sync_documents (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid not null references public.users on delete cascade,
  title text default 'Untitled' not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Enable RLS
alter table public.sync_documents enable row level security;

-- Auto-update timestamps
create trigger handle_updated_at before update on public.sync_documents
  for each row execute procedure extensions.moddatetime (updated_at);

-- Index for owner queries
create index idx_sync_documents_owner on public.sync_documents (owner_id);

comment on table public.sync_documents is 'Registry of documents available for sync';
```

### Complete Migration: collab_updates table

```sql
-- Migration: 20260416000004_create_collab_updates.sql
-- Source: https://codemirror.net/examples/collab/

create table public.collab_updates (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.sync_documents on delete cascade,
  version bigint not null,
  client_id text not null,
  changes jsonb not null,
  created_at timestamptz default now() not null,
  
  unique (document_id, version)
);

-- Enable RLS
alter table public.collab_updates enable row level security;

-- Critical index for version queries (relay hot path)
create index idx_collab_updates_doc_version 
  on public.collab_updates (document_id, version);

comment on table public.collab_updates is 'Ordered OT updates from @codemirror/collab';
comment on column public.collab_updates.version is 'Monotonic version assigned by relay server';
comment on column public.collab_updates.changes is 'Serialized ChangeSet JSON from CodeMirror';
```

### Complete Migration: shares table

```sql
-- Migration: 20260416000005_create_shares.sql
-- Source: https://github.com/orgs/supabase/discussions/13352

create table public.shares (
  id uuid default gen_random_uuid() primary key,
  document_id uuid not null references public.sync_documents on delete cascade,
  share_token uuid default gen_random_uuid() not null,
  enabled boolean default true not null,
  permission text default 'edit' not null,  -- reserved for v2
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  
  unique (document_id)
);

-- Enable RLS
alter table public.shares enable row level security;

-- Auto-update timestamps
create trigger handle_updated_at before update on public.shares
  for each row execute procedure extensions.moddatetime (updated_at);

-- Token lookup index (partial for enabled only)
create index idx_shares_token on public.shares (share_token) where enabled = true;

comment on table public.shares is 'Share tokens for document access (Google Docs style)';
comment on column public.shares.share_token is 'UUID token used in share links, resetable by owner';
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Trigger functions inline | `security definer set search_path = ''` | 2023 | Prevents search_path injection attacks |
| Manual updated_at triggers | moddatetime extension | 2022 | Less boilerplate, built-in support |
| text for JSON | jsonb | 2020+ | Native indexing, operators, better performance |
| timestamp | timestamptz | Always | Timezone safety is non-negotiable |

**Deprecated/outdated:**
- Supabase GoTrue v1 API: Replaced by v2 in @supabase/supabase-js 2.x
- `auth.uid()` without SELECT wrapper: Performance regression in RLS (wrap with `(select auth.uid())`)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Anonymous users get auto-created profile via same trigger | Pattern 1 | Anonymous users may not have profile row, breaks FK constraints |
| A2 | jsonb is adequate for ChangeSet serialization | Pattern 2 | May need to store as text if ChangeSet format incompatible |
| A3 | Single share row per document sufficient | Pattern 3 | May need multiple tokens for different permission levels in v2 |

## Open Questions (RESOLVED)

1. **Anonymous User Profile Handling**
   - What we know: `signInAnonymously()` creates an `auth.users` row with `is_anonymous` claim
   - What's unclear: Should trigger create profile for anonymous users or skip them?
   - Recommendation: Create profile for all users, use `is_anonymous` claim in future RLS policies
   - **RESOLVED:** Trigger creates profile for ALL users including anonymous. The `handle_new_user()` trigger fires on any `auth.users` insert, providing a consistent profile row. Anonymous users get display_name defaulted to 'Anonymous' via `coalesce()`. Future RLS policies can check `is_anonymous` claim when needed.

2. **ChangeSet Serialization Format**
   - What we know: @codemirror/collab uses `Update` objects with `changes` field
   - What's unclear: Exact JSON structure, whether `jsonb` operators will be useful
   - Recommendation: Store as `jsonb` for flexibility, can always cast to text if needed
   - **RESOLVED:** Use `jsonb` for the `changes` column. CodeMirror's `ChangeSet.toJSON()` produces a JSON-serializable array format that Postgres jsonb handles correctly. If relay needs to inspect changes (unlikely for v1), jsonb operators are available. Text fallback remains possible via `changes::text` cast if ever needed.

3. **Version Number Reset Strategy**
   - What we know: Versions are monotonic per document
   - What's unclear: What happens if relay restarts mid-document? Does it query max(version)?
   - Recommendation: Relay must query `max(version)` from DB on document load (Phase 4/5 concern)
   - **RESOLVED:** Relay queries `SELECT COALESCE(MAX(version), 0) FROM collab_updates WHERE document_id = $1` on document load. This is a Phase 4/5 implementation detail but the schema supports it via the `idx_collab_updates_doc_version` index which makes this query efficient. Version continuity is guaranteed by the unique constraint.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI | Migration management | Needs install | 2.92.0 | Manual SQL via dashboard |
| Supabase Project | All tables | User must create | -- | Local supabase via Docker |
| bun | Package manager | Assumed yes | -- | npm/yarn |

**Missing dependencies with no fallback:**
- Supabase project must exist (create via supabase.com or local Docker)

**Missing dependencies with fallback:**
- Supabase CLI can be skipped; migrations can be run via dashboard SQL editor

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Supabase CLI + psql |
| Config file | supabase/config.toml |
| Quick run command | `bunx supabase db reset` |
| Full suite command | `bunx supabase db reset && bunx supabase test db` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-01 | users table exists with FK to auth.users | integration | `bunx supabase db reset` (migration applies) | Wave 0 |
| DATA-02 | sync_documents table with owner FK | integration | `bunx supabase db reset` | Wave 0 |
| DATA-03 | collab_updates with version unique constraint | integration | `bunx supabase db reset` | Wave 0 |
| DATA-04 | shares table with share_token | integration | `bunx supabase db reset` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bunx supabase db reset` (resets and reapplies all migrations)
- **Per wave merge:** Full reset + manual inspection via dashboard
- **Phase gate:** All migrations apply cleanly, tables visible in Supabase dashboard

### Wave 0 Gaps
- [ ] `supabase/migrations/*` — all migration files (this phase creates them)
- [ ] `supabase/config.toml` — project configuration
- [ ] Supabase CLI install: `bun add -D supabase`

## Security Domain

> Note: D-09 defers RLS policies to post-prototype. This section documents what MUST be added before production.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes (deferred) | Supabase Auth manages auth.users |
| V3 Session Management | Yes (deferred) | Supabase handles JWT sessions |
| V4 Access Control | Yes (DEFERRED) | RLS policies per table |
| V5 Input Validation | Yes | Postgres column constraints, jsonb validation |
| V6 Cryptography | No | No encryption columns in this phase |

### Known Threat Patterns for Supabase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Direct table access via API | Information Disclosure | RLS policies (DEFERRED) |
| Share token guessing | Information Disclosure | UUID tokens are 128-bit random, practically unguessable |
| SQL injection in migrations | Tampering | Parameterized queries, no user input in migrations |
| Trigger privilege escalation | Elevation of Privilege | `security definer set search_path = ''` |

**CRITICAL PRE-PRODUCTION REQUIREMENT:**
Before any production use, these RLS policies MUST be implemented:
1. `users`: Only owner can read/write own profile
2. `sync_documents`: Owner full access, collaborators via share token
3. `collab_updates`: Read/write for document participants only
4. `shares`: Only document owner can modify

## Sources

### Primary (HIGH confidence)
- [Supabase Tables and Data](https://supabase.com/docs/guides/database/tables) - Column types, FK syntax
- [Supabase User Management](https://supabase.com/docs/guides/auth/managing-user-data) - Profile table pattern, trigger example
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) - Policy syntax, performance tips
- [Supabase Migrations](https://supabase.com/docs/guides/deployment/database-migrations) - CLI workflow, naming conventions
- [CodeMirror Collab Example](https://codemirror.net/examples/collab/) - Update storage requirements

### Secondary (MEDIUM confidence)
- [Supabase Share Links Discussion](https://github.com/orgs/supabase/discussions/13352) - UUID token pattern
- [Supabase moddatetime](https://dev.to/paullaros/updating-timestamps-automatically-in-supabase-5f5o) - Timestamp automation
- [Supabase Anonymous Auth](https://supabase.com/docs/guides/auth/auth-anonymous) - is_anonymous claim

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official Supabase docs verified
- Architecture: HIGH - Follows documented patterns exactly
- Pitfalls: HIGH - Based on official docs and common issues

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (30 days - Supabase stable, patterns well-established)
