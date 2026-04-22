# Phase 3: Anonymous Auth - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 03-anonymous-auth
**Areas discussed:** Anonymous identity, Session lifecycle, Account upgrade

---

## Anonymous Identity

| Option | Description | Selected |
|--------|-------------|----------|
| Google Docs style | Random animal names ("Anonymous Panda", "Anonymous Narwhal") | |
| Numbered guests | "Guest 1234" (simpler) | |
| Self-selected | Prompt for a name when joining (no account, but they type one) | ✓ |

**User's choice:** Self-selected display name
**Notes:** User wants it to work "just like Google Docs" for identity, but with self-selected names rather than random animals.

---

## Session Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| On app load | Always get anonymous token if not logged in | |
| On shared doc join | Only trigger when joining a shared document | ✓ |

**User's choice:** Only when joining a shared doc
**Notes:** Anonymous auth is specifically for the collaboration use case, not a general fallback.

---

## Account Upgrade

| Option | Description | Selected |
|--------|-------------|----------|
| Re-attribute edits | Anonymous edits get linked to new account | |
| Stay anonymous | Edits made while anonymous stay attributed to anonymous identity | ✓ |

**User's choice:** Stay anonymously attributed
**Notes:** User can sign in while viewing a shared doc — session switches to authenticated, but past anonymous edits remain anonymous.

---

## Claude's Discretion

- Name entry UI design
- Name validation rules
- Anonymous session expiry
- Supabase metadata storage details
