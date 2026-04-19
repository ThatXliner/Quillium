---
phase: 02
slug: auth-foundation
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-17
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.4 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `bun run test:run src/lib/auth/` |
| **Full suite command** | `bun run test:run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test:run src/lib/auth/`
- **After every plan wave:** Run `bun run test:run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | — | grep | `grep @supabase/supabase-js package.json` | ✅ | ⬜ pending |
| 02-01-02 | 01 | 1 | — | grep | `grep PUBLIC_SUPABASE .env.example` | ✅ | ⬜ pending |
| 02-01-03 | 01 | 1 | AUTH-01,02,03,04 | grep | `grep "signUp\|signIn\|signOut" src/lib/auth/auth.svelte.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | — | grep | `grep initials src/lib/auth/avatarUtils.ts` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | AUTH-01,02 | grep | `grep AuthModal src/lib/auth/AuthModal.svelte` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 2 | AUTH-04 | grep | `grep AvatarDropdown src/lib/auth/AuthButton.svelte` | ❌ W0 | ⬜ pending |
| 02-02-04 | 02 | 2 | AUTH-01,02,03,04 | grep | `grep AuthButton src/routes/+page.svelte` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/auth/auth.test.ts` — unit tests for signUp, signIn, signOut (mocked Supabase client)
- [ ] `src/lib/auth/__mocks__/supabase.ts` — mock Supabase client for testing

*Note: Wave 0 test scaffolding is optional for prototype phase. Manual E2E verification with real Supabase is the primary gate.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Session persists across app restart | AUTH-03 | Requires full Tauri app lifecycle | 1. Sign in, 2. Quit app completely, 3. Reopen, 4. Verify still logged in |
| Sign up creates user with display name | AUTH-01 | Requires real Supabase backend | 1. Sign up with test email, 2. Check Supabase dashboard for user, 3. Verify display_name in users table |
| Login/logout UI works | AUTH-02,04 | Visual verification | 1. Click Sign In, 2. Log in, 3. Verify avatar appears, 4. Click dropdown, 5. Log out, 6. Verify Sign In button returns |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
