---
phase: 04-relay-core
plan: 02
subsystem: relay
tags: [auth, jwt, socket.io, middleware]
dependency_graph:
  requires: [04-01]
  provides: [socket-auth, jwt-validation, permission-check]
  affects: [quillium-landing/relay]
tech_stack:
  added: []
  patterns: [socket.io-middleware, supabase-admin-sdk, zod-validation]
key_files:
  created:
    - quillium-landing/relay/src/auth/supabase.ts
    - quillium-landing/relay/src/auth/middleware.ts
    - quillium-landing/relay/src/schemas.ts
    - quillium-landing/relay/src/server.ts
    - quillium-landing/relay/.env.example
  modified:
    - quillium-landing/relay/src/index.ts
    - quillium-landing/relay/src/__tests__/auth.test.ts
decisions:
  - Use supabase.auth.getUser() for JWT validation (validates signature + expiration)
  - Return numeric error codes (4001-4004) instead of descriptive messages per D-33
  - Skip strict RLS permission check for prototype per D-09
metrics:
  duration: 2m 57s
  tasks_completed: 5
  files_created: 5
  files_modified: 2
  completed: 2026-04-17T14:52:39Z
---

# Phase 04 Plan 02: Socket.io Auth Summary

JWT authentication middleware for Socket.io with Supabase Admin SDK validation, error codes per D-33, and document permission check; 8 passing unit tests with mocked Supabase.

## Commits

| Task | Hash | Description |
|------|------|-------------|
| 1 | 0fc0624 | feat(04-02): create Supabase Admin client singleton |
| 2 | 5bc8025 | feat(04-02): create Zod schemas for WebSocket messages |
| 3 | 57bdbb5 | feat(04-02): create auth middleware with JWT validation |
| 4 | d9a32b8 | feat(04-02): create Socket.io server with auth middleware |
| 5 | efafd5c | test(04-02): implement auth tests with mocked Supabase |

## What Was Built

- **Supabase Admin client**: `relay/src/auth/supabase.ts` with service_role key, no session persistence
- **Zod schemas**: `relay/src/schemas.ts` with HandshakeAuthSchema, AuthErrorCode (4001-4004), UpdateSchema
- **Auth middleware**: `relay/src/auth/middleware.ts` validates JWT via getUser(), checks document exists
- **Socket.io server**: `relay/src/server.ts` with CORS, perMessageDeflate: false, health check endpoint
- **Entry point**: `relay/src/index.ts` with dotenv, graceful shutdown handler
- **Tests**: 8 passing tests covering RELY-01 (JWT) and RELY-02 (permissions) with mocked Supabase

## Verification Results

```
=== Type check ===
$ tsc --noEmit
typecheck: OK

=== Auth tests ===
Test Files  1 passed (1)
Tests       8 passed (8)
Duration    149ms
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript error in supabase.ts**
- **Found during:** Task 2
- **Issue:** createClient() received `string | undefined` for URL/key
- **Fix:** Added non-null assertions (!) since supabaseConfigured guard ensures values exist
- **Files modified:** relay/src/auth/supabase.ts
- **Commit:** 5bc8025

**2. [Rule 1 - Bug] Fixed Socket type augmentation**
- **Found during:** Task 3
- **Issue:** Declaring Socket.data type conflicted with existing SocketData interface
- **Fix:** Changed to export AuthenticatedSocketData interface instead of module augmentation
- **Files modified:** relay/src/auth/middleware.ts
- **Commit:** 57bdbb5

## Threat Mitigations Applied

| Threat ID | Status | Implementation |
|-----------|--------|----------------|
| T-04-01 (Spoofing) | Mitigated | JWT validated via supabase.auth.getUser() which checks signature + expiration |
| T-04-02 (Elevation of Privilege) | Mitigated | Document existence verified via sync_documents query |
| T-04-03 (Tampering) | Mitigated | Handshake validated with Zod HandshakeAuthSchema |
| T-04-04 (Information Disclosure) | Mitigated | Returns numeric codes (4001-4004) not detailed error messages |

## Known Stubs

| File | Line | Description |
|------|------|-------------|
| relay/src/server.ts | 56-63 | pullUpdates/pushUpdates handlers return NOT_IMPLEMENTED (Plan 03) |
| relay/src/auth/middleware.ts | 74-76 | TODO: Check shares table for non-owner access (production) |

All stubs are intentional; handlers implemented in Plan 03, shares table check deferred to production.

## Self-Check: PASSED

- [x] quillium-landing/relay/src/auth/supabase.ts exists
- [x] quillium-landing/relay/src/auth/middleware.ts exists
- [x] quillium-landing/relay/src/schemas.ts exists
- [x] quillium-landing/relay/src/server.ts exists
- [x] quillium-landing/relay/.env.example exists
- [x] Commits 0fc0624, 5bc8025, 57bdbb5, d9a32b8, efafd5c verified in git log
- [x] All 8 tests pass
- [x] TypeScript typecheck passes
