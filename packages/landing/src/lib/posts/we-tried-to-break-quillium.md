---
title: "We Tried to Break Quillium"
description: "Quillium generates thousands of ways to corrupt a document, then checks whether the editor can put itself back together."
date: "2026-07-13"
author: "Bryan Hu"
featured: false
---

Clicking around an app for twenty minutes without finding a bug can inspire confidence, but it
proves very little.A short manual test can show that the obvious
parts of an app work under ordinary conditions, but it says very little about what happens when several complicated systems interact.

A writing app is easy to trust when you type a paragraph, make it bold, and close the window. The
interesting failures happen after you put a revision inside another revision, delete the sentence
around it, undo twice, switch versions, redo, close the app halfway through a write, and reopen it
from a snapshot created forty-seven edits ago. Although that sequence sounds absurd, it is a fairly
ordinary afternoon in Quillium's test suite.

Quillium lets a document contain comments, suggestions, alternate versions, and revisions nested
inside other revisions. Those objects move as the text around them changes, and they have histories
of their own. They must survive undo and redo, saving and loading, version switching, and
synchronization between two computers through [Quillium Omni](/omni).

When I say Quillium is robust, I do not mean that I have used it a lot and it seems fine. The
codebase defines explicit invariants, then attacks them with generated sequences of edits. At the
time of writing, the repository contains more than 150 test files and 1,500 test cases across the
desktop app, collaboration relay, shared renderer, and web preview. What those tests prove matters
more than the count.

## The hard part is not text

Plain text editing is a solved problem. The hard part is keeping everything Quillium adds attached
to that text, which requires us to treat a document as more than a string of characters.

Suppose you select a paragraph and create a revision with three alternate versions, one of which has
a comment while another contains a nested revision. If you then delete a few words before the
paragraph, every range must move by exactly the right amount. Deleting through one boundary changes
the required behavior, and undoing the deletion must restore the complete structure, not merely the
visible text.

That gives us useful properties to test:

- An annotation ID never collides with an existing ID.
- An annotation range never points outside the document.
- Serialization followed by deserialization preserves the same semantic state.
- Undo restores the previous text, annotations, revision versions, threads, and version groups.
- Redo restores the state that existed before undo.
- Restarting from a saved state, or from a snapshot plus its event tail, produces the same document.
- Two collaborating peers converge on the same text and annotation structure after receiving the
  same operations.

These are rules that must remain true across every path the editor can take.

## What example tests catch, and what fuzz tests catch

Quillium has conventional unit and integration tests. They cover known edge cases: deleting across
annotation boundaries, applying suggestions, switching revision versions, reopening documents,
copying annotated text, restoring backups, and repeatedly hammering undo and redo in a real browser.

Every bug gets a regression test, turning each discovered weakness into permanent coverage. A
regression test can only describe a failure somebody has already imagined, however, and the state
space of a non-linear editor is too large to enumerate by hand. Quillium therefore uses
property-based testing with `fast-check`: we describe valid documents and operations, then the test
runner generates cases and checks the invariants for each one.

For the annotation model, it generates arbitrary selections, annotation maps, comments,
suggestions, revisions, and serialized states. It looks for collisions, invalid ranges, lossy
clones, and round trips that change their meaning. Generated input is especially good at finding
the cases humans skip: an empty document, several selection ranges, annotations at position zero,
reversed selections, adjacent boundaries, or a deeply inconvenient combination of all five.

When a generated case fails, `fast-check` repeatedly simplifies it until it finds the smallest
sequence that still breaks the rule. A 200-step failure becomes a short, reproducible bug report
with a seed and replay path. Seeded generation and shrinking turn random testing into a practical
debugging tool.

## We fuzz the history, not just the functions

The most demanding test treats Quillium as a state machine. It begins with a document and generates
a sequence of commands: insert, delete, replace, add a comment, create a revision, edit inside it,
add or switch a version, apply or branch a suggestion, create a version group, rename it, undo,
redo, or restart the editor. After every command, an independent model records what the complete
state should be, and Quillium has to agree with that model after each step.

The comparison includes the text, every annotation and range, every revision version, and every
version group. It excludes cursor position because CodeMirror does not promise to replay
command-provided cursor movement on redo. Robustness also requires knowing what the underlying
platform does and does not guarantee.

The normal history fuzz run explores 150 generated command sequences of up to 60 operations each,
while stress runs can raise those limits to 1,000 sequences and 200 operations. Any failure can
then be replayed with its exact seed and shrink path.

Restarts are commands in the same generator. Some rebuild from serialized editor fields; others
follow the real app's recovery path by loading an earlier snapshot and replaying the events after
it. This catches edits that work in memory but fail across a process boundary.

This is the distinction I care about most: Quillium tests whether undo restores the entire meaning
of a document after a generated chain of nested edits, even after the app is torn down and rebuilt.

## The browser gets a turn too

A correct data model can still produce a broken product, so Quillium tests several layers. Unit
tests exercise pure rules, integration tests dispatch real CodeMirror transactions, and Playwright
tests drive the app through a browser. Those tests select text, open revision modals, edit nested
versions, traverse breadcrumbs, change viewport sizes, and spam Cmd+Z and Cmd+Shift+Z.

Visual suites compare the desktop editor, Version History, and Omni's web preview against
checked-in images at desktop, tablet, and mobile sizes. They cover nested modals and
annotation-heavy states. Each screenshot check has semantic assertions because pixels cannot prove
that a button is accessible, a selection is correct, or the editor state matches the screen.

Flaky tests do not quietly become green tests, because browser retries are finite and a test that
fails once before passing on retry still fails CI. A writing tool should not get to call
intermittent data loss “close enough.”

## Testing is only one layer of safety

Tests reduce the chance that bad code ships, but they cannot prevent power loss, disk damage,
platform bugs, or future mistakes. The application must assume that something will eventually go
wrong.

Quillium records edits in an append-only SQLite event log and creates periodic snapshots. It
reconstructs a document by loading a snapshot and replaying later events. Each new transaction is
also replayed against the prior state and checked against the state the user saw.

Replay skips a malformed historical event instead of making the whole document unreadable, and an
invalid snapshot can be rebuilt from the event stream. A sudden large deletion triggers a named
recovery snapshot of the state *before* the deletion. You can read the full design in
[How Quillium Keeps Your Writing Safe](/blog/how-quillium-keeps-your-writing-safe).

This is defense in depth:

1. Types and schemas reject invalid shapes.
2. Unit tests protect specific rules and past bugs.
3. Property tests generate inputs we did not think to write.
4. Stateful fuzzing explores long interactions between editing, history, and persistence.
5. Browser tests verify the product a writer actually touches.
6. The persistence and recovery systems limit the damage if every earlier layer misses something.

Together, these layers make failures less likely and less damaging. A problem missed by one layer
can still be caught or contained by another.

## So, how robust is Quillium actually?

Quillium is not bug-free, because no serious software is. Robustness means understanding the
remaining risks and building systems that expose or contain them.

There are boundaries I will not blur for marketing. Bounded collaboration property tests run today,
and an opt-in stress test now applies 10,000 seeded edits across two peers. That longer campaign
runs on demand rather than on every pull request because it is deliberately expensive. The desktop
app has still had far more real-world testing than Omni's newer collaboration path.

Quillium's most dangerous operations are not protected by a handful of handwritten happy paths.
Its editing model is checked against thousands of generated states and long command sequences. Its
history is verified as a complete semantic value, its persistence path is tested across real
teardown and reconstruction, and recovery mechanisms sit behind every layer.

The purpose is not to win an argument about test counts. It is to let you write a sentence, tear it
apart, try six other versions, change your mind, close the app, and return tomorrow with every idea
still there. That is the standard Quillium's tests are designed to enforce, and you can
[try Quillium](/#download) for yourself.
