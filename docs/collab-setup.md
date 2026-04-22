# Quillium Collab Setup Guide

Step-by-step developer documentation for setting up and running the Quillium real-time collaboration stack.

## Overview

The collab stack consists of three services:

1. **Quillium** (this repo) - Desktop app built with Tauri + SvelteKit
2. **Relay Server** (quillium-landing/relay) - Yjs WebSocket server that syncs CRDT updates
3. **Supabase** - Auth and Postgres for user management and update persistence

Two Quillium instances connect to the same relay server and see each other's edits in real-time.

## Prerequisites

Before starting, ensure you have:

- **bun** installed ([bun.sh](https://bun.sh))
- **Rust toolchain** (for Tauri) - install via [rustup.rs](https://rustup.rs)
- **Supabase CLI** - `bun add -g supabase` or an existing Supabase project
- **Fly.io CLI** (production only) - `curl -L https://fly.io/install.sh | sh`

## 1. Supabase Setup

You need a Supabase project for user auth and collab state persistence.

### Option A: Use an Existing Supabase Project

Get your credentials from the Supabase Dashboard:

1. Go to [app.supabase.com](https://app.supabase.com)
2. Select your project
3. Navigate to **Settings > API**
4. Copy these values:
   - **Project URL** (e.g., `https://abcdefgh.supabase.co`)
   - **anon/public key** (starts with `eyJ...`)
   - **service_role key** (starts with `eyJ...`, keep secret!)

### Option B: Create a New Supabase Project

```bash
supabase login
supabase projects create quillium-collab --org-id YOUR_ORG_ID
```

### Run Database Migrations

The collab system requires these tables:
- `users` - User profiles
- `sync_documents` - Document registry
- `collab_updates` - Update history (legacy OT, now Yjs)
- `collab_snapshots` - Periodic state snapshots
- `shares` - Document sharing config

From the Quillium repo root:

```bash
# Link to your Supabase project (if not already linked)
supabase link --project-ref YOUR_PROJECT_REF

# Push migrations to the database
supabase db push
```

Or run migrations manually via the SQL Editor in Supabase Dashboard using the files in `supabase/migrations/`.

## 2. Relay Server - Local Development

The relay server lives in the quillium-landing repository.

```bash
# Clone the quillium-landing repo (if you don't have it)
git clone https://github.com/ThatXliner/quillium-landing.git
cd quillium-landing/relay
```

### Configure Environment Variables

Create a `.env` file in the relay directory:

```bash
cp .env.example .env
```

Edit `.env` with your Supabase credentials:

```env
# Relay server environment variables
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...your-service-role-key
PORT=3001
```

Replace `YOUR_PROJECT_REF` and the service role key with your actual values from Supabase Dashboard > Settings > API.

### Start the Relay Server

```bash
bun install
bun run dev
```

Expected output:

```
[relay] WebSocket relay listening on port 3001
[relay] Health check: http://localhost:3001/health
```

Verify it's running:

```bash
curl http://localhost:3001/health
```

## 3. Quillium App - Local Development

Back in the Quillium repository:

### Configure Environment Variables

Create a `.env.local` file in the Quillium root:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Supabase client configuration
PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...your-anon-key

# Local relay server
PUBLIC_RELAY_URL=http://localhost:3001
```

Replace with your actual Supabase URL and anon key.

### Start Quillium

```bash
bun install
bun run tauri dev
```

This starts both the Vite dev server and the Tauri app window.

## 4. Testing the Collab Session

### Quick Start: Zellij Layout

The fastest way to run all three services:

```bash
cd Quillium
zellij --layout collab-dev.kdl
```

This opens 3 panes:
- **Quillium 1 (Owner)** — port 1420
- **Quillium 2 (Collaborator)** — port 1422, separate data dir
- **Relay Server** — port 3001

### Manual Setup (Three Terminal Windows)

**Terminal 1 - Relay Server:**
```bash
cd quillium-landing/relay
bun run dev
```

**Terminal 2 - First Quillium Instance:**
```bash
cd Quillium
bun run tauri dev
```

**Terminal 3 - Second Quillium Instance:**
```bash
cd Quillium
QUILLIUM_DATA_DIR=/tmp/quillium-collab2 bun run tauri:dev2
```

The `tauri:dev2` script runs Vite on port 1422 with a separate Tauri config, so both instances can run simultaneously without port conflicts.

### Connect and Collaborate

1. **Instance A (Owner):**
   - Sign up or log in with an email/password
   - Open or create a document
   - Click the **"Go Live"** button in the toolbar
   - Note the document ID shown in the connection status

2. **Instance B (Collaborator):**
   - Sign up or log in (can be a different account)
   - Click the **"..."** menu in the toolbar
   - Enter the document ID from Instance A
   - Click **Join**

3. **Verify:**
   - Type in either instance
   - Edits should appear in the other within ~100ms

## 5. Relay Server - Fly.io Deployment

For production use, deploy the relay server to Fly.io.

### Prerequisites

- Fly.io account ([fly.io/app/sign-up](https://fly.io/app/sign-up))
- Fly CLI installed and authenticated (`fly auth login`)

### Deploy

```bash
cd quillium-landing/relay

# Initialize Fly app (first time only)
fly launch --no-deploy

# Set secrets (never commit these!)
fly secrets set SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
fly secrets set SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...your-key

# Deploy
fly deploy
```

Expected output includes your app URL, e.g., `https://quillium-relay.fly.dev`.

### Update Quillium for Production Relay

In your Quillium `.env.local` (or production build config):

```env
PUBLIC_RELAY_URL=wss://quillium-relay.fly.dev
```

Note the `wss://` protocol for secure WebSockets in production.

## Environment Variable Reference

| Variable | Where Used | Where to Get It | Example |
|----------|------------|-----------------|---------|
| `PUBLIC_SUPABASE_URL` | Quillium client | Supabase Dashboard > Settings > API > Project URL | `https://abc123.supabase.co` |
| `PUBLIC_SUPABASE_PUBLISHABLE_ANON_KEY` | Quillium client | Supabase Dashboard > Settings > API > anon/public | `eyJhbGci...` |
| `PUBLIC_RELAY_URL` | Quillium client | Your relay server URL | `http://localhost:3001` or `wss://your-relay.fly.dev` |
| `SUPABASE_URL` | Relay server | Supabase Dashboard > Settings > API > Project URL | `https://abc123.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Relay server | Supabase Dashboard > Settings > API > service_role | `eyJhbGci...` |
| `PORT` | Relay server | Choose any available port | `3001` |

## Troubleshooting

### "Couldn't connect to relay server"

- Check that `PUBLIC_RELAY_URL` is set in your `.env.local`
- Verify the relay server is running: `curl http://localhost:3001/health`
- For production: ensure you're using `wss://` not `ws://`

### "Not authenticated" or connection rejected

- Ensure you're logged in to Quillium (check for user email in the UI)
- Verify `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_ANON_KEY` are set correctly
- Check that the relay's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` match your project

### "Document not found" when joining

- The document must be registered in `sync_documents` table first
- The owner must have clicked "Go Live" to create the sync entry
- Run Supabase migrations if you haven't: `supabase db push`

### Relay server shows "Supabase not configured"

- Create `.env` file in the relay directory (not `.env.local`)
- Verify both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set
- Restart the relay after changing environment variables

### TypeScript errors in relay

```bash
cd quillium-landing/relay
bun run typecheck
```

### Two Tauri instances conflict

This shouldn't happen - each Tauri dev instance uses its own SQLite database in a separate app data directory. If you see issues:

```bash
# Check that TAURI_APP_DATA is not manually set
echo $TAURI_APP_DATA
```

### Changes not syncing between instances

- Check browser console for WebSocket errors
- Verify both instances are connected (look for "connected" state in UI)
- Check relay server logs for error messages
- Try refreshing both instances

## Database Schema

The collab system uses these Postgres tables (created by migrations):

```sql
-- User profiles (extends auth.users)
public.users (id, display_name, subscription_status, created_at, updated_at)

-- Document registry (no content - stored locally)
public.sync_documents (id, owner_id, title, created_at, updated_at)

-- Yjs CRDT updates (replaces legacy OT)
public.yjs_updates (id, document_id, update_data, created_at)

-- Periodic snapshots for fast state reconstruction
public.collab_snapshots (id, document_id, version, state_json, created_at)

-- Share tokens for document sharing
public.shares (id, document_id, share_token, enabled, permission, created_at, updated_at)
```

Migrations are in `supabase/migrations/` and can be applied with `supabase db push`.
