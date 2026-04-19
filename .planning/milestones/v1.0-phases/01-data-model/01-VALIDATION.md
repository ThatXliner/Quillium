---
phase: 1
slug: data-model
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Supabase CLI + psql |
| **Config file** | supabase/config.toml |
| **Quick run command** | `bunx supabase db reset` |
| **Full suite command** | `bunx supabase db reset && bunx supabase test db` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bunx supabase db reset`
- **After every plan wave:** Run `bunx supabase db reset && bunx supabase test db`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | DATA-01 | — | N/A | integration | `bunx supabase db reset` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | DATA-02 | — | N/A | integration | `bunx supabase db reset` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 1 | DATA-03 | — | N/A | integration | `bunx supabase db reset` | ❌ W0 | ⬜ pending |
| 01-04-01 | 04 | 1 | DATA-04 | — | N/A | integration | `bunx supabase db reset` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/config.toml` — Supabase project configuration
- [ ] `supabase/migrations/` — Migration directory structure
- [ ] Supabase CLI: `bun add -D supabase`

*Wave 0 establishes Supabase CLI tooling before migrations are written.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tables visible in Supabase Dashboard | DATA-01-04 | Dashboard inspection | Open Supabase dashboard → Table Editor → verify all 4 tables visible |
| RLS enabled (no policies) | Security prep | Dashboard inspection | Each table should show "RLS enabled" badge |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
