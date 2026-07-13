---
title: "We Tried to Break Quillium"
description: "Quillium generates thousands of ways to corrupt a document, then checks whether the editor can put itself back together."
date: "2026-07-13"
author: "Bryan Hu"
featured: false
---

There is a particular kind of confidence that comes from clicking around an app for twenty minutes
without finding a bug, but it is almost worthless. A short manual test can show that the obvious
parts of an app work under ordinary conditions; it says very little about what happens when several
complicated systems interact.

A writing app is easy to trust when you type a paragraph, make it bold, and close the window. The
interesting failures happen after you put a revision inside another revision, delete the sentence
around it, undo twice, switch versions, redo, close the app halfway through a write, and reopen it
from a snapshot created forty-seven edits ago. Although that sequence sounds absurd, it is a fairly
ordinary afternoon in Quillium's test suite.

Quillium lets a document contain comments, suggestions, alternate versions, and revisions nested
inside other revisions. Those objects move as the text around them changes, and they have histories
of their own. They must survive undo and redo, saving and loading, version switching, and
synchronization between two computers through [Quillium Omni](/omni).

When I say Quillium is robust, I do not mean that I have used it a lot and it seems fine; I mean the
codebase is built around explicit invariants, then attacked with generated sequences of edits
designed to violate them.

At the time of writing, the repository contains more than 150 test files and more than 1,500
explicit test cases across the desktop app, the collaboration relay, the shared renderer, and the
web preview. Although the number is reassuring, the kinds of things those tests prove matter much
more.

## The hard part is not text

Plain text editing is a solved problem, while the hard part is everything Quillium promises will
remain attached to that text. Testing those promises requires us to treat a document as more than a
string of characters.

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

These properties are not screenshots of one happy path; they are rules that must remain true for
every path the editor can take.

## What example tests catch, and what fuzz tests catch

Quillium has conventional unit and integration tests. They cover known edge cases: deleting across
annotation boundaries, applying suggestions, switching revision versions, reopening documents,
copying annotated text, restoring backups, and repeatedly hammering undo and redo in a real browser.

Every bug gets a regression test so that its exact failure cannot return unnoticed. This practice
turns each discovered weakness into permanent coverage, although it cannot reveal failures that
nobody has considered yet.

But a regression test can only describe a failure somebody already imagined. The state space of a
non-linear editor is too large to enumerate by hand, so Quillium also uses property-based testing
with `fast-check`. Instead of giving a test one carefully chosen document, we describe the space of
valid documents and operations, after which the test runner generates cases from that space and
checks the invariants for each one.

For the annotation model, it generates arbitrary selections, annotation maps, comments,
suggestions, revisions, and serialized states. It looks for collisions, invalid ranges, lossy
clones, and round trips that change their meaning. Generated input is especially good at finding
the cases humans skip: an empty document, several selection ranges, annotations at position zero,
reversed selections, adjacent boundaries, or a deeply inconvenient combination of all five.

The clever part is shrinking: when a generated case fails, `fast-check` does not leave us with a
200-step pile of noise, because it repeatedly removes and simplifies operations until it finds the
smallest sequence that still breaks the rule. This process turns a mysterious randomized failure
into a short, reproducible bug report, complete with a seed and replay path. Random testing without
reproducibility is little more than a slot machine, whereas seeded generation and shrinking make it
a useful debugging tool.

## We fuzz the history, not just the functions

The most demanding test treats Quillium as a state machine. It begins with a document and generates
a sequence of commands: insert, delete, replace, add a comment, create a revision, edit inside it,
add or switch a version, apply or branch a suggestion, create a version group, rename it, undo,
redo, or restart the editor. After every command, an independent model records what the complete
state should be, and Quillium has to agree with that model after each step.

The comparison includes the document text, every annotation and range, every revision version, and
every version group. Cursor position is deliberately excluded because CodeMirror does not promise
to replay command-provided cursor movement on redo; robustness also means knowing precisely what
the underlying platform does and does not guarantee.

The normal history fuzz run explores 150 generated command sequences of up to 60 operations each,
while stress runs can raise those limits to 1,000 sequences and 200 operations. Any failure can
then be replayed with its exact seed and shrink path.

Restarts are commands in the same generator. Some rebuild directly from serialized editor fields,
while others reconstruct the document the way the real app does by loading an earlier snapshot and
then replaying the exact event tail that followed it. This catches an entire class of bugs that
appears only when an edit works in memory but cannot survive a process boundary.

This is the distinction I care about most: Quillium does not merely test whether undo works, but
whether undo restores the entire meaning of a document after a generated chain of nested edits. The
same requirement must remain true after the app is torn down and rebuilt.

## The browser gets a turn too

A perfect data model can still produce a broken product, which is why Quillium tests at several
layers. Unit tests exercise pure rules quickly, integration tests mount real CodeMirror editor
states and dispatch real transactions, and Playwright tests drive the application through a
browser. Those browser tests select text, open revision modals, edit nested versions, traverse
breadcrumbs, switch themes and viewport sizes, and spam Cmd+Z and Cmd+Shift+Z.

The visual suites compare checked-in images for the desktop editor, Version History, and Omni's web
preview across wide, tablet, and mobile layouts. They cover nested modals and annotation-heavy
states, not just an empty homepage. Screenshot checks are paired with semantic assertions, because
pixels alone cannot prove that a button is accessible, a selection is correct, or the underlying
editor state matches what is visible.

Flaky tests do not quietly become green tests, because browser retries are finite and a test that
fails once before passing on retry still fails CI. A writing tool should not get to call
intermittent data loss “close enough.”

## Testing is only one layer of safety

Tests reduce the chance that bad code ships, but they cannot prevent a power loss, a damaged disk,
an unexpected platform bug, or a future mistake I have not written yet. The application itself
therefore has to assume that something will eventually go wrong.

Quillium records edits in an append-only SQLite event log using write-ahead logging and creates
periodic snapshots from that history. It reconstructs a document by loading a snapshot and
replaying the events after it, while new transaction records are verified by replaying them against
the state that existed before the edit and comparing the result with the state the user actually
saw.

When one historical event is malformed, replay skips it and continues instead of making the whole
document unreadable; when a snapshot is invalid, Quillium can fall back to rebuilding from the
event stream. A change that suddenly deletes a large part of a document or its annotation tree
triggers a named recovery snapshot of the state *before* the deletion. You can read the full design
in [How Quillium Keeps Your Writing Safe](/blog/how-quillium-keeps-your-writing-safe).

This is defense in depth:

1. Types and schemas reject invalid shapes.
2. Unit tests protect specific rules and past bugs.
3. Property tests generate inputs we did not think to write.
4. Stateful fuzzing explores long interactions between editing, history, and persistence.
5. Browser tests verify the product a writer actually touches.
6. The persistence and recovery systems limit the damage if every earlier layer misses something.

No single layer is enough, but together they make failures both less likely and less catastrophic.
The value lies in the overlap, because a failure missed by one layer can still be caught or
contained by another.

## So, how robust is Quillium actually?

Quillium is not bug-free, because no serious software is, and randomized testing would be a strange
thing to invest in if I believed otherwise. Robustness means understanding the remaining risks and
building systems that expose or contain them.

There are also boundaries I will not blur for marketing: the bounded collaboration property tests
run today, but the planned 10,000-operation, two-peer convergence campaign is still future work,
and the desktop app has far more battle testing than Omni's newer real-time collaboration path.
Those facts belong in an honest account of the product, especially when the subject is trust.

What I can say is this: Quillium's most dangerous operations are not protected by a handful of
handwritten happy paths. Its core editing model is checked against thousands of generated states
and long command sequences, while its history is verified as a complete semantic value. Its
persistence path is exercised across real teardown and reconstruction, and its browser suite
attacks the same interactions that tend to expose editor bugs in practice. The app keeps recovery
mechanisms behind all of those layers.

The purpose of all this is not to win an argument about test counts. It is to let you do something
far more important without thinking about any of it: write a sentence, tear it apart, try six other
versions, change your mind, close the app, and come back tomorrow with every idea still there. That
is the standard a writing tool should meet, and it is the standard Quillium's tests are designed to
enforce. [Try Quillium](/#download).
