# Harper Grammar Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Harper (WASM grammar checker) into Quillium's editor with squiggly underlines and click-to-fix popovers.

**Architecture:** Vendor Harper's Obsidian plugin lint infrastructure (CM6-native), wire it to a `WorkerLinter` running in a Web Worker, render spelling errors as red squiggles and grammar errors as blue squiggles. Settings (enable/disable, dialect) live in `appSettings` under the Editor section. A `Compartment` allows toggling the extension at runtime.

**Tech Stack:** `harper.js` (WASM), CodeMirror 6, Svelte 5, Tauri

---

### File Structure

**New files:**
- `src/lib/editor/harper/lint.ts` — vendored from Harper's Obsidian plugin (`packages/obsidian-plugin/src/lint.ts`). CM6 lint infrastructure: `StateField<LintState>`, `Decoration.mark`, tooltip rendering, keyboard navigation, action dispatch. We will adapt this to remove Obsidian-specific imports and fit Quillium's styling.
- `src/lib/editor/harper/lintKindColor.ts` — vendored from Harper's Obsidian plugin (`packages/obsidian-plugin/src/lintKindColor.ts`). Maps lint kind strings to CSS classes. We will simplify to two categories: spelling (red) and grammar (blue).
- `src/lib/editor/harper/harperLinter.ts` — Harper-specific linting source. Initializes `WorkerLinter`, calls `organizedLints()`, maps `Lint` → `Diagnostic`, builds suggestion actions.
- `src/lib/editor/harper/harper.css` — squiggle + tooltip styles.

**Modified files:**
- `src/lib/editor/extensions.ts` — add Harper extension via a `Compartment` for runtime toggle.
- `src/lib/settings.svelte.ts` — add `grammarCheckEnabled` and `grammarDialect` fields.
- `src/lib/settings/SettingsModal.svelte` — add grammar toggle + dialect dropdown to Editor section.
- `package.json` — add `harper.js` dependency.

---

### Task 1: Install harper.js

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run: `bun add harper.js`

- [ ] **Step 2: Verify installation**

Run: `bun run check`
Expected: no new type errors

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb
```

Commit message: `:heavy_plus_sign: build(deps): add harper.js for grammar checking`

---

### Task 2: Vendor lint infrastructure from Harper's Obsidian plugin

**Files:**
- Create: `src/lib/editor/harper/lint.ts`
- Create: `src/lib/editor/harper/lintKindColor.ts`

- [ ] **Step 1: Download Harper's lint.ts and lintKindColor.ts**

```bash
gh api repos/Automattic/harper/contents/packages/obsidian-plugin/src/lint.ts --jq '.content' | base64 -d > src/lib/editor/harper/lint.ts
gh api repos/Automattic/harper/contents/packages/obsidian-plugin/src/lintKindColor.ts --jq '.content' | base64 -d > src/lib/editor/harper/lintKindColor.ts
```

- [ ] **Step 2: Remove Obsidian-specific code from lint.ts**

The vendored file imports from `obsidian` and uses Obsidian's `editorInfoField`. Remove these:

1. Remove the `import ... from 'obsidian'` line (if present — the file is mostly standalone CM6 code)
2. Remove references to `editorInfoField`
3. Replace `import elt from 'crelt'` — keep this dependency or inline it. Check if it's already in the project; if not, install `crelt` (`bun add crelt`) or replace with `document.createElement` calls.
4. Update import paths: change `'./lintKindColor'` to `'./lintKindColor'` (should already be correct)

- [ ] **Step 3: Simplify lintKindColor.ts to two categories**

Replace the contents of `lintKindColor.ts` with:

```typescript
/**
 * Maps Harper lint kind strings to CSS class names.
 * Two categories: spelling (red squiggle) and grammar (blue squiggle).
 */
export function lintKindClass(kind: string): string {
    if (kind === "Spelling") return "harper-spelling";
    return "harper-grammar";
}
```

- [ ] **Step 4: Run type check**

Run: `bun run check`
Expected: may have errors from lint.ts that need fixing — address any remaining Obsidian/crelt import issues.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/harper/lint.ts src/lib/editor/harper/lintKindColor.ts
```

Commit message: `:truck: feat(harper): vendor lint infrastructure from Harper's Obsidian plugin`

---

### Task 3: Create harper.css squiggle and tooltip styles

**Files:**
- Create: `src/lib/editor/harper/harper.css`

- [ ] **Step 1: Create the CSS file**

```css
/* Harper grammar checker — squiggle underlines */
.harper-spelling {
    text-decoration: wavy underline #ef4444;
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
}

.harper-grammar {
    text-decoration: wavy underline #3b82f6;
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
}

/* Harper tooltip — styled to match DictionaryPopover */
.harper-tooltip {
    background: white;
    border-radius: 0.5rem;
    box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
    padding: 0.75rem;
    max-width: 320px;
    z-index: 100;
    font-family: var(--ui-font-family);
}

.harper-tooltip-category {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #9ca3af;
    margin-bottom: 4px;
}

.harper-tooltip-message {
    font-size: 13px;
    color: #374151;
    line-height: 1.4;
    margin-bottom: 8px;
}

.harper-tooltip-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}

.harper-tooltip-suggestion {
    padding: 2px 8px;
    font-size: 12px;
    border-radius: 9999px;
    border: 1px solid #e5e7eb;
    background: #f9fafb;
    color: #374151;
    cursor: pointer;
    transition: background-color 0.15s, border-color 0.15s;
}

.harper-tooltip-suggestion:hover {
    background: #3b82f6;
    border-color: #3b82f6;
    color: white;
}

.harper-tooltip-dictionary {
    padding: 2px 8px;
    font-size: 12px;
    border-radius: 9999px;
    border: 1px solid #e5e7eb;
    background: #f9fafb;
    color: #6b7280;
    cursor: pointer;
    transition: background-color 0.15s, border-color 0.15s;
}

.harper-tooltip-dictionary:hover {
    background: #f3f4f6;
    border-color: #d1d5db;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/editor/harper/harper.css
```

Commit message: `:lipstick: style(harper): add squiggle and tooltip styles`

---

### Task 4: Create the Harper linting source

**Files:**
- Create: `src/lib/editor/harper/harperLinter.ts`

- [ ] **Step 1: Create the linter source**

This file initializes Harper's `WorkerLinter` and provides the lint source function that the vendored `lint.ts` infrastructure calls on each debounced cycle.

```typescript
/**
 * harperLinter.ts — Harper-specific linting source for CodeMirror.
 *
 * Initializes a WorkerLinter with WASM, calls organizedLints(),
 * and maps Harper Lint objects into the vendored Diagnostic format.
 */
import type { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { type Dialect, WorkerLinter, SuggestionKind } from "harper.js";
import { slimBinaryInlined } from "harper.js/slimBinaryInlined";
import { linter, type Diagnostic, type Action } from "./lint";
import { lintKindClass } from "./lintKindColor";

const HARPER_DICTIONARY_KEY = "harper-dictionary";
const DEFAULT_DELAY = 750;

let harperInstance: InstanceType<typeof WorkerLinter> | null = null;

function getHarper(dialect?: Dialect): InstanceType<typeof WorkerLinter> {
    if (!harperInstance) {
        harperInstance = new WorkerLinter({
            binary: slimBinaryInlined,
            dialect,
        });
    }
    return harperInstance;
}

/** Dispose the current linter (call when dialect changes). */
export function resetHarper(dialect?: Dialect): void {
    if (harperInstance) {
        harperInstance.dispose();
        harperInstance = null;
    }
    getHarper(dialect);
}

/** Load user dictionary words from localStorage into Harper. */
export async function loadUserDictionary(): Promise<void> {
    const harper = getHarper();
    try {
        const raw = localStorage.getItem(HARPER_DICTIONARY_KEY);
        if (raw) {
            const words: string[] = JSON.parse(raw);
            if (words.length > 0) {
                await harper.importWords(words);
            }
        }
    } catch {}
}

/** Save a word to the user dictionary and re-lint. */
async function addToDictionary(word: string): Promise<void> {
    const harper = getHarper();
    await harper.importWords([word]);
    try {
        const raw = localStorage.getItem(HARPER_DICTIONARY_KEY);
        const words: string[] = raw ? JSON.parse(raw) : [];
        if (!words.includes(word)) {
            words.push(word);
            localStorage.setItem(HARPER_DICTIONARY_KEY, JSON.stringify(words));
        }
    } catch {}
}

function suggestionToLabel(sug: any): string {
    const kind = sug.kind();
    if (kind === SuggestionKind.Remove) return "Remove";
    if (kind === SuggestionKind.InsertAfter) return `Insert "${sug.get_replacement_text()}"`;
    return `Replace with "${sug.get_replacement_text()}"`;
}

/** Build the CM6 linter extension powered by Harper. */
export function harperExtension(): Extension {
    return linter(
        async (view: EditorView) => {
            const harper = getHarper();
            const text = view.state.doc.sliceString(0);
            const lints = await harper.organizedLints(text);

            return Object.entries(lints).flatMap(([linterName, lintList]) =>
                (lintList as any[]).map((lint): Diagnostic => {
                    const span = lint.span();

                    const actions: Action[] = lint.suggestions().map((sug: any) => ({
                        kind: "suggestion" as const,
                        name:
                            sug.kind() === SuggestionKind.Replace
                                ? sug.get_replacement_text()
                                : suggestionToLabel(sug),
                        title: suggestionToLabel(sug),
                        apply: (view: EditorView, from: number, to: number) => {
                            if (sug.kind() === SuggestionKind.Remove) {
                                view.dispatch({
                                    changes: { from, to, insert: "" },
                                    selection: { anchor: from },
                                });
                            } else if (sug.kind() === SuggestionKind.Replace) {
                                const replacement = sug.get_replacement_text();
                                view.dispatch({
                                    changes: { from, to, insert: replacement },
                                    selection: { anchor: from + replacement.length },
                                });
                            } else if (sug.kind() === SuggestionKind.InsertAfter) {
                                const replacement = sug.get_replacement_text();
                                view.dispatch({
                                    changes: { from: to, to, insert: replacement },
                                    selection: { anchor: to + replacement.length },
                                });
                            }
                        },
                    }));

                    if (lint.lint_kind() === "Spelling") {
                        const word = lint.get_problem_text();
                        actions.push({
                            kind: "dictionary",
                            name: "Add to dictionary",
                            title: `Add "${word}" to your dictionary`,
                            apply: (_view: EditorView) => {
                                addToDictionary(word);
                            },
                        });
                    }

                    return {
                        from: span.start,
                        to: span.end,
                        source: linterName,
                        severity: "warning",
                        markClass: lintKindClass(lint.lint_kind()),
                        title: lint.lint_kind_pretty(),
                        message: lint.message(),
                        renderMessage: () => {
                            const container = document.createElement("div");
                            container.className = "harper-tooltip";

                            const category = document.createElement("div");
                            category.className = "harper-tooltip-category";
                            category.textContent = lint.lint_kind_pretty();
                            container.appendChild(category);

                            const msg = document.createElement("div");
                            msg.className = "harper-tooltip-message";
                            msg.innerHTML = lint.message_html();
                            container.appendChild(msg);

                            if (actions.length > 0) {
                                const actionsDiv = document.createElement("div");
                                actionsDiv.className = "harper-tooltip-actions";
                                container.appendChild(actionsDiv);
                            }

                            return container;
                        },
                        actions,
                    };
                }),
            );
        },
        { delay: DEFAULT_DELAY },
    );
}
```

- [ ] **Step 2: Run type check**

Run: `bun run check`
Expected: PASS (or type errors from lint.ts vendored types that need aligning — fix any mismatches between our `Diagnostic` type and what `linter()` expects)

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/harper/harperLinter.ts
```

Commit message: `:sparkles: feat(harper): create Harper linting source with dictionary support`

---

### Task 5: Wire Harper into the extension stack

**Files:**
- Modify: `src/lib/editor/extensions.ts`

- [ ] **Step 1: Add Harper extension with a Compartment**

In `extensions.ts`, add imports and wire the Harper extension into `getExtensions`. Use a `Compartment` so it can be toggled at runtime from settings.

Add at the top of the file:

```typescript
import { Compartment } from "@codemirror/state";
import { harperExtension, loadUserDictionary } from "./harper/harperLinter";
import { appSettings } from "$lib/settings.svelte";
import "./harper/harper.css";
```

Add a compartment export:

```typescript
export const harperCompartment = new Compartment();
```

Inside `getExtensions`, add to the returned array (after `dictionaryExtension`), only for main editors (when `withHistory` is true — nested editors pass `history: false`):

```typescript
...(withHistory
    ? [harperCompartment.of(appSettings.grammarCheckEnabled ? harperExtension() : [])]
    : []),
```

- [ ] **Step 2: Initialize user dictionary on startup**

In `Editor.svelte`, after the editor is created in `onMount`, call `loadUserDictionary()`:

Add import:
```typescript
import { loadUserDictionary } from "./harper/harperLinter";
```

After the editor view is set up (after the `$editorView = view` line), add:
```typescript
loadUserDictionary();
```

- [ ] **Step 3: Run type check**

Run: `bun run check`
Expected: will fail because `grammarCheckEnabled` doesn't exist on `AppSettings` yet. That's expected — Task 6 adds it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/editor/extensions.ts src/lib/editor/Editor.svelte
```

Commit message: `:sparkles: feat(harper): wire grammar checker into editor extension stack`

---

### Task 6: Add settings fields and UI

**Files:**
- Modify: `src/lib/settings.svelte.ts`
- Modify: `src/lib/settings/SettingsModal.svelte`

- [ ] **Step 1: Add settings fields to AppSettings**

In `src/lib/settings.svelte.ts`, add to the `AppSettings` type:

```typescript
grammarCheckEnabled: boolean;
grammarDialect: "american" | "british" | "australian";
```

Add to `DEFAULTS`:

```typescript
grammarCheckEnabled: true,
grammarDialect: "american",
```

- [ ] **Step 2: Add grammar settings UI to SettingsModal**

In `src/lib/settings/SettingsModal.svelte`, add the following after the existing Editor section's last setting row (after the word count display mode row), still within the Editor section:

```svelte
<!-- Grammar check toggle -->
<div class="setting-row">
    <div class="setting-meta">
        <div class="setting-title">Grammar & spell check</div>
        <div class="setting-desc">Highlight spelling and grammar errors with squiggly underlines</div>
    </div>
    <div class="flex items-center gap-2 shrink-0">
    {#if !draft.grammarCheckEnabled}
        <button
            type="button"
            onclick={() => { draft.grammarCheckEnabled = true; handleChange(); }}
            class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
        >Reset</button>
    {/if}
    <button
        role="switch"
        aria-checked={draft.grammarCheckEnabled}
        aria-label="Toggle grammar check"
        class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
            {draft.grammarCheckEnabled ? 'bg-blue-500' : 'bg-black/[0.15]'}"
        onclick={() => {
            draft.grammarCheckEnabled = !draft.grammarCheckEnabled;
            handleChange();
        }}
    >
        <span
            class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                transition-transform duration-200
                {draft.grammarCheckEnabled ? 'translate-x-4' : 'translate-x-0'}"
        ></span>
    </button>
    </div>
</div>

<!-- English dialect dropdown -->
<div class="setting-row {!draft.grammarCheckEnabled ? 'opacity-40 pointer-events-none' : ''}">
    <div class="setting-meta">
        <div class="setting-title">English dialect</div>
        <div class="setting-desc">Which English spelling and grammar rules to use</div>
    </div>
    <div class="shrink-0">
        <select
            class="text-sm bg-white/60 border border-black/10 rounded-md px-2 py-1 cursor-pointer"
            value={draft.grammarDialect}
            onchange={(e) => {
                draft.grammarDialect = e.currentTarget.value as typeof draft.grammarDialect;
                handleChange();
            }}
        >
            <option value="american">American English</option>
            <option value="british">British English</option>
            <option value="australian">Australian English</option>
        </select>
    </div>
</div>
```

- [ ] **Step 3: Wire settings changes to the Harper compartment**

In `SettingsModal.svelte` (or in `extensions.ts` via a reactive effect), when grammar settings change we need to reconfigure the compartment. Add to `applySettings` in `settings.svelte.ts`:

In the save handler of `SettingsModal.svelte`, after `persistSettings()` is called, add logic to reconfigure Harper. Import what's needed:

```typescript
import { harperCompartment } from "$lib/editor/extensions";
import { harperExtension, resetHarper } from "$lib/editor/harper/harperLinter";
import { Dialect } from "harper.js";
import { editorView } from "$lib/stores";
import { get } from "svelte/store";
```

After `persistSettings()` in the save handler, add:

```typescript
// Reconfigure Harper grammar checker
const view = get(editorView);
if (view) {
    const dialectMap = {
        american: Dialect.American,
        british: Dialect.British,
        australian: Dialect.Australian,
    } as const;

    if (draft.grammarDialect !== oldDialect) {
        resetHarper(dialectMap[draft.grammarDialect]);
    }

    view.dispatch({
        effects: harperCompartment.reconfigure(
            draft.grammarCheckEnabled ? harperExtension() : [],
        ),
    });
}
```

Store `oldDialect` before the save: `const oldDialect = appSettings.grammarDialect;`

- [ ] **Step 4: Run type check**

Run: `bun run check`
Expected: PASS

- [ ] **Step 5: Run format and lint**

Run: `bun run biome`
Expected: PASS (fix any formatting issues)

- [ ] **Step 6: Commit**

```bash
git add src/lib/settings.svelte.ts src/lib/settings/SettingsModal.svelte
```

Commit message: `:sparkles: feat(harper): add grammar check toggle and dialect settings`

---

### Task 7: Manual integration test

- [ ] **Step 1: Start the dev server**

Run: `bun run dev`

- [ ] **Step 2: Verify squiggles appear**

Type text with intentional errors in the editor, e.g.:
- "This is a example" (grammar — should get blue squiggle on "a")
- "definately" (spelling — should get red squiggle)
- "there mistakes" (grammar — should get blue squiggle on "there")

Expected: squiggly underlines appear after ~750ms pause.

- [ ] **Step 3: Verify tooltip on click**

Click on a squiggle-underlined word.
Expected: popover appears with lint category, error message, and suggestion buttons.

- [ ] **Step 4: Verify applying a suggestion**

Click a suggestion button in the popover.
Expected: the word is replaced and the squiggle disappears.

- [ ] **Step 5: Verify "Add to dictionary"**

Click "Add to dictionary" on a spelling error.
Expected: squiggle disappears, word stays. Reload the page — the word should still not be flagged.

- [ ] **Step 6: Verify settings toggle**

Open Settings → Editor → toggle "Grammar & spell check" off.
Expected: all squiggles disappear immediately. Toggle back on — squiggles reappear.

- [ ] **Step 7: Verify dialect change**

Change dialect to British English. Type "color" (American spelling).
Expected: may flag "color" as a spelling error (depends on Harper's British dict). Change back to American — "color" should be accepted.

---

### Task 8: Final cleanup and commit

- [ ] **Step 1: Run full checks**

```bash
bun run check && bun run biome && bun run test:run
```

Expected: all pass

- [ ] **Step 2: Add license attribution**

Add a comment at the top of `src/lib/editor/harper/lint.ts`:

```typescript
/**
 * Vendored from Harper's Obsidian plugin (packages/obsidian-plugin/src/lint.ts).
 * Original source: https://github.com/Automattic/harper
 * License: Apache 2.0
 *
 * Adapted for Quillium: removed Obsidian-specific code, styled tooltips
 * to match Quillium's design language.
 */
```

- [ ] **Step 3: Final commit**

```bash
git add -A src/lib/editor/harper/
```

Commit message: `:memo: docs(harper): add license attribution to vendored code`
