# Document Tabs Redesign

**Date:** 2026-03-29
**Status:** Approved

## Problem

The current tab bar uses a browser-style underline/bottom-border design that floats visually disconnected from the document card. It doesn't match Quillium's warm, notebook-like aesthetic. Additionally, the outer editor wrapper's `overflow-y: auto` produces an unwanted scrollbar.

## Design Decision

**Option A — Tabs flush with the document top edge.**

Tabs appear to grow from the document card itself. The active tab is white and seamless with the card surface (no bottom border, no gap). Inactive tabs are translucent glass, slightly shorter. The document card's top-left corner becomes square where the active tab meets it.

## Visual Spec

### Tab strip

- Container: `w-[816px] mx-auto flex items-end gap-0.5 pl-3 select-none`
- **Active tab:** `bg-white rounded-t-lg px-3 py-1.5 text-sm font-semibold text-black/90 shadow-[0_-2px_6px_rgba(0,0,0,0.06)] relative z-10 cursor-default`
- **Inactive tab:** `bg-white/45 backdrop-blur-sm rounded-t-lg px-3 py-1 text-sm text-black/50 hover:text-black/70 hover:bg-white/60 transition-colors cursor-pointer relative z-[1]`
- **+ button:** small, low-contrast, sits to the right of tabs; `mb-1 ml-1 p-1 rounded text-black/30 hover:text-black/60 hover:bg-white/40 transition-colors`
- **× button:** appears on hover only (`opacity-0 group-hover:opacity-100`); hidden when `tabs.length === 1`

### Document card

Change from `rounded-lg` to `rounded-tr-lg rounded-b-lg` — removes top-left radius so the active tab meets the card edge cleanly.

### Scrollbar fix

Remove `overflow-y: auto` (or change to `overflow-y: visible`) from the outer editor wrapper div in `Editor.svelte`. The page should scroll naturally without a constrained inner scroll container.

## Behavior (unchanged)

- Double-click a tab label to rename inline; Enter/blur commits, Escape cancels
- × hidden when only one tab exists
- Tab bar always visible (even with a single tab) so + is always accessible

## Files to Change

1. `src/lib/editor/DocumentTabs.svelte` — restyle tab strip and individual tab classes
2. `src/lib/editor/Editor.svelte` — change document card corner radius; fix outer wrapper overflow
