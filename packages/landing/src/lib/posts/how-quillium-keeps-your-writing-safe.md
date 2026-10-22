---
title: "How Quillium Keeps Your Writing Safe"
description: "How local saving, recovery snapshots, and undo protect your writing, and where their limits are."
date: "2026-04-07"
author: "Bryan Hu"
---

*Updated October 22, 2026 to clarify save failures and undo retention.*

The scariest thing about a writing tool isn't a missing feature; it's losing your work. Everyone who has written on a computer for long enough has been there. You're two thousand words into something good, the app freezes, and when you reopen it the work is gone, or half-gone, which is somehow worse because now you're staring at a fragment and trying to remember what the rest of the draft said.

Quillium saves edits automatically to a local database. Each edit enters a queue while you keep writing. An edit becomes durable only after its database write succeeds, so text visible in the editor can still be waiting to save.

If Quillium reports a save failure, keep the draft open and copy the current writing somewhere safe before restarting. Normal navigation waits for pending writes and stops on a save failure. Force-quitting can still lose edits that never reached the database.

Autosave only protects against one kind of disaster, though: the app closing unexpectedly. It does nothing about the other kind, the kind where the app is working perfectly and you are the one who just accidentally destroyed your own work.

## The disaster autosave can't prevent

You're seven chapters into your novel. You hit Cmd+A by accident, then press a key, and your entire manuscript is replaced with the letter "k." The app dutifully autosaves, and now your latest save is the letter "k." Or you're cleaning up and accidentally delete a section that contained three [revisions](./inline-branching-for-prose) you'd been developing for weeks, each with its own nested drafts, comments, and suggestions. Gone in one keypress, and autosaved.

Undo can recover a recent deletion, but it is not a substitute for saved recovery points. Quillium also records snapshots that you can inspect in Version History.

## Proactive recovery: snapshot *before* damage

Quillium checks edits for unusually large deletions and annotation loss. When a guard triggers, it attempts to save a snapshot of the state before the edit. Snapshot writes can fail too, so these guards reduce risk without guaranteeing recovery.

An amber warning links to Version History, where successful recovery snapshots appear with labels such as "Before large deletion (auto)" or "Before mass annotation removal (auto)." These snapshots contain the pre-edit state. The suspicious-change warning lets you continue editing; a database save failure separately prevents normal navigation away from the draft.

That's the difference between a tool that saves your work and a tool that **protects** your work. Autosave is reactive: it preserves whatever state the document happens to be in. Proactive recovery is preemptive: it recognizes that the state might be wrong and preserves the previous state before it's too late.

<details>
<summary>How the detection works</summary>

Three heuristics trigger the warning. The first catches large deletions: at least 100 characters removed *and* at least 20% of the document gone at once. Both thresholds must pass, which prevents false alarms on short documents while catching genuine disasters on long ones.

The second catches mass annotation removal: at least 3 annotations deleted *and* at least 25% of all annotations wiped simultaneously. Annotations are how Quillium stores revisions, comments, and suggestions internally, so losing them means losing your branching history.

The third catches deep annotation loss: if a single removed annotation contained more than 3 nested sub-annotations across its versions, or any sub-annotation that itself had nested content. A revision in Quillium can contain its own comments, suggestions, and even sub-revisions. Thus, deleting one top-level revision could silently destroy an entire tree of work which the mass-removal check wouldn't catch because it only sees one annotation disappearing.

</details>

## The recovery mechanisms

Recovery snapshots work alongside the event log, validation, restore, and undo.

### 1. Edits are queued in order

Quillium queues text and annotation changes in an append-only event log. A single event can contain both text changes and annotation operations.

On reopen, Quillium reconstructs the draft from a saved snapshot and later events. This recovers successfully persisted changes. It cannot recover an edit that failed to save merely because a later write succeeded.

<details>
<summary>How the event log works</summary>

This is an event-sourcing architecture backed by SQLite in WAL mode. The events and snapshots tables hold authoritative draft content. Search metadata is a derived copy, not the source used to restore the draft. Event types include `doc_change` (insertions/deletions + selection), `compound` (document changes combined with annotation events), and individual annotation operations like `annotation_add`, `annotation_remove`, and `annotation_update`.

The editor's persistence queue keeps writes in order and retains a failed-write state for the loaded draft. Later writes do not clear that failure. Navigation and checkpoint creation must pass the save barrier before proceeding.

</details>

### 2. Recover readable data


If a part of your history is corrupted—a mangled record, an annotation with invalid data—most apps would crash. Quillium handles every record individually instead. A corrupt event is skipped, a warning is logged, and replay continues with everything that came after it, so one bad record doesn't prevent recovery of the thousands of good ones. The same approach applies to annotations: if one fails validation on load, it's dropped (unless we can recover it—see the next section) and the rest load normally, and if an entire snapshot is corrupted, Quillium falls back to rebuilding from a fresh state.

Recovery is best-effort. Skipping a corrupt event can affect later events that depend on it, and an unreadable snapshot can contain state that later events cannot reconstruct. Keep separate backups of important work.

<details>
<summary>How validation works</summary>

Every annotation is validated against a schema on load. The schemas tolerate extra fields, but records that fail validation are skipped with a logged error. The rest of the annotation map continues loading. Extra-field tolerance does not guarantee compatibility with every future format.

During event replay, each event is processed in a try/catch. If a single event throws—malformed data, unknown type, out-of-range position—it's skipped with a warning and replay continues.

</details>

### 3. Restore should heal, not just paste

Restoring from a backup isn't just dumping text back into the editor. In case of something going wrong, Quillium performs a "healing restore" that recovers your annotations—revisions, comments, suggestions—alongside the text itself.

It works by remembering the actual text content at each annotation's position, not just the position. After the document is restored, it searches for each of those text fragments in the new document. If found, the annotation is re-attached at its correct position. If not found, it's placed at the beginning with a warning rather than silently dropped. For revisions with nested content, the healing process goes deeper, validating and re-anchoring at every level.

One subtle detail: the restore is specially tagged so the suspicious-change detector doesn't trigger on it. Without that tag, restoring a backup would look like a massive deletion and create a circular loop of warnings.

### 4. Browse saved history

Periodic snapshots, named checkpoints, and recovery snapshots build a timeline of saved writing. The periodic policy requests a snapshot after 50 events or when an event arrives at least two minutes after the previous snapshot. It is not a timer that saves an idle editor every two minutes.

Version History reconstructs a selected snapshot in a read-only editor so you can inspect it before restoring. The first click on Restore arms confirmation. The second confirms the restore.

Named checkpoints are never auto-pruned, and only unlabeled automatic snapshots get cleaned up. If storage grows large, Quillium warns you at 1 GB and lets you prune by count or by age.

You can browse retained history and preview the state before restoring it. Available history depends on what was successfully saved and retained.

## Undo

Undo covers text and annotation edits within the editor. Cross-session undo is a per-document option and is off by default for new documents. When enabled, Quillium restores saved undo only if its effects can be decoded completely. Otherwise, it starts a fresh undo stack. Tab and draft deletion undo lasts only for the editor session.

But most importantly, if you're using undo for the kind of thing most writers use undo for, you mostly don't need it in Quillium. I've [written before about why the undo button is a lie](./why-the-undo-button-is-a-lie), though that post takes a philosophical angle where this one is about reliability.

The practical detail here is that Quillium's undo and redo work across annotation changes, version switches, and even implicit deletions.

<details>
<summary>How annotation undo works</summary>

The annotation system generates inverted effects for every operation: adding an annotation generates a remove on undo, updating a comment thread restores the previous version, switching a revision's active version switches it back. For implicit deletions—where typing collapses an annotation's range to zero width—the system detects the disappearance by diffing old and new state, and generates a restore effect with special handling for collapsed ranges.

Guards prevent undo from generating its own undo entries during replays, internal revision edits, and nested editor operations.

</details>

## Why this matters

If you can't trust a word processor to reliably save your work, you can't trust it to do anything else either.

Roughly half of the development time spent on Quillium's [public beta](./public-beta) went into reliability alone, rather than into features, UI polish, or any ["aI iNtEgRaTIOn"](./ai-is-not-the-point).

A writing tool that loses your writing isn't really a tool; it's a liability with a text editor bolted on.

[Try Quillium.](/#download)
