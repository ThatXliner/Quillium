# Auth

Quillium uses Supabase Auth for Omni identity. Publishing and Live Rooms require
a session; reading a public Web Preview does not. Local writing remains usable
without an account or network connection. See the
[identity decision](adr/0007-supabase-collaboration-identity.md).

## Configuration and storage

The desktop reads `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` at
build time. Empty values disable auth. Define both names even for offline local
development, as described in the [quickstart](quickstart.md). Service-role keys
belong only on the server.

[`supabase.ts`](../packages/desktop/src/lib/auth/supabase.ts) creates the desktop
client with localStorage session persistence, automatic token refresh, and URL
session detection disabled. `processLock` serializes auth operations inside a
window without the cross-window Web Lock used by the default client. Each
request has a 15-second timeout so a stalled token refresh can release its lock.

The hosted landing app handles auth redirects separately. Its
[environment example](../packages/landing/.env.example) records the callback,
confirmation, and password-reset URLs.

## Connection and recovery

The editor page calls `initAuth()` on mount.
[`auth.svelte.ts`](../packages/desktop/src/lib/auth/auth.svelte.ts) owns the
reactive user, session, loading flag, and connection state:

1. Probe `/auth/v1/health`, with up to three attempts.
2. Read the stored session with a bounded wait.
3. Subscribe to auth-state changes.

An unreachable server or session-read timeout leaves a retryable `offline`
state. `reconnectAuth()` starts a new attempt. The state can be `online` without
a signed-in user.

`signOut()` attempts server sign-out with a five-second limit, then clears local
session storage and reactive state even if the server fails. It invalidates
older reconnect attempts so they cannot restore the cleared session.
`hasAuthStateToReset()` includes persisted sessions that failed to load; the
offline UI can therefore still offer sign-out.

## Accounts and identity

`AuthModal.svelte` validates email/password login and signup through
`schemas.ts`. Production signup links to the waitlist. Development builds show
the signup tab unless the debug waitlist mode is enabled.

Opening a Live Room invitation while signed out prompts for a display name.
The desktop calls `signInAnonymously(displayName)` before resolving a link
invitation. Email invitations require a permanent account with a confirmed
matching email. Invalid, expired, revoked, wrong-account, and owner-offline
results remain distinct in the join dialog.

Display names come from user metadata, with email and `"User"` fallbacks. They
are presentation data, not authorization data. Access checks use verified user
IDs and table ownership. Anonymous Supabase users also have the `authenticated`
Postgres role, so that role alone does not distinguish permanent accounts.

When a non-anonymous session loads, auth links the PostHog identity to the user
ID. Sign-out resets that identity. Event conventions live in the
[analytics guide](posthog-events.md).

## Consumers and verification

The share dialog requires a session to publish or enter rooms. Anonymous sessions
can enter link invitations; only permanent document owners manage grants. `yjsProvider.ts`
sends its access token to the relay, which verifies it before checking room
access. `share.ts` supplies auth and author-name information to
`shareRepository.ts`. See [collaboration](collaboration.md) for those boundaries.

Form and avatar tests live in
[`packages/desktop/tests/lib/auth`](../packages/desktop/tests/lib/auth/).
The [cross-package E2E suite](../packages/e2e/README.md) checks real authentication
and database access for publishing and relay clients.
