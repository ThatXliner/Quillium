---
phase: 4
slug: relay-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (relay lives in quillium-landing repo) |
| **Config file** | `quillium-landing/relay/vitest.config.ts` (Wave 0 creates) |
| **Quick run command** | `cd quillium-landing/relay && bun run test:run` |
| **Full suite command** | `cd quillium-landing/relay && bun run test:run --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test:run`
- **After every plan wave:** Run `bun run test:run --coverage`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 0 | — | — | N/A | scaffold | `test -f relay/package.json` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | RELY-01 | T-04-01 | Invalid JWT rejected with close code 4001 | unit | `bun run test:run auth.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | RELY-02 | T-04-02 | Permission denied closes with 4003 | unit | `bun run test:run auth.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | RELY-03 | — | N/A | unit | `bun run test:run room.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 2 | RELY-04 | — | N/A | unit | `bun run test:run room.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `relay/src/__tests__/auth.test.ts` — stubs for RELY-01, RELY-02
- [ ] `relay/src/__tests__/room.test.ts` — stubs for RELY-03, RELY-04
- [ ] `relay/vitest.config.ts` — test configuration
- [ ] `relay/package.json` — includes vitest, @types/node

*Wave 0 creates test infrastructure since relay/ is a new directory.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fly.io deployment | — | External service | Deploy via `fly deploy`, verify WebSocket connection via wscat |

*All core relay behaviors (auth, permission, OT, broadcast) have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
