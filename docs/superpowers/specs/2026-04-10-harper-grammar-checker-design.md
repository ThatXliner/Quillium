# Harper Grammar Checker Integration

Integrate Harper (Rust-based, WASM grammar checker) into Quillium's CodeMirror editor with inline squiggly underlines and a click-to-fix popover.

## Architecture

A new CodeMirror extension that runs Harper's WASM engine in a Web Worker, renders squiggly underlines on errors, and shows a popover with suggestions on click.

### New files

- **`src/lib/editor/harper/lint.ts`** — vendored from Harper's Obsidian plugin. Custom CM6 lint infrastructure: manages `StateField<LintState>` for diagnostics, renders `Decoration.mark` squigglies, handles tooltip positioning, keyboard navigation between diagnostics, and action dispatch.
- **`src/lib/editor/harper/harperLinter.ts`** — Harper-specific linting source. Initializes `WorkerLinter` with `slimBinaryInlined` WASM, calls `organizedLints()`, maps Harper `Lint` objects into the vendored `Diagnostic` format with actions (replace, remove, add to dictionary).
- **`src/lib/editor/harper/harperTooltip.ts`** — custom tooltip renderer (DOM, not Svelte — matches how vendored lint.ts renders tooltips via `renderMessage`). Styled to match the dictionary popover's visual language.
- **`src/lib/editor/harper/harper.css`** — squiggle styles and tooltip styles.

### Modified files

- **`extensions.ts`** — add Harper extension to the stack (main editor only, not nested editors).
- **`settings.svelte`** — add grammar check toggle and dialect dropdown.
- **`package.json`** — add `harper.js` dependency.
- Settings modal UI — add grammar settings under the "Editor" section.

## Data Flow

```
User types → CM transaction → vendored lint.ts debounces (750ms default)
→ calls harperLinter source function(view)
→ WorkerLinter.organizedLints(docText) runs in Web Worker
→ returns Record<string, Lint[]>
→ maps each Lint to Diagnostic { from, to, severity, markClass, message, actions[] }
→ lint.ts StateField stores diagnostics as DecorationSet
→ Decoration.mark renders squiggles via CSS classes
→ Click on squiggle → tooltip with message + suggestion buttons
→ Click suggestion → view.dispatch({ changes: { from, to, insert: replacement } })
```

## Squiggle Rendering

Native CSS `text-decoration: wavy underline` with 2px thickness:

- **Spelling errors** — red (`#ef4444`), class `.harper-spelling`
- **Grammar errors** — blue (`#3b82f6`), class `.harper-grammar`

Harper's `lint_kind()` returns categories like `"Spelling"`, `"Repetition"`, `"Miscellaneous"`, etc. `"Spelling"` maps to red, everything else maps to blue.

## Tooltip Popover

Triggered on click (not hover), matching the dictionary popover interaction:

- Lint category label in small caps (e.g., "Spelling", "Grammar")
- Error message from `lint.message()`
- Suggestion pill buttons — click applies the fix via `view.dispatch`
- For spelling errors: additional "Add to dictionary" button
- Styled to match `DictionaryPopover.svelte`: white bg, rounded-lg, shadow, same font sizes, `z-[100]`
- Dismissed by clicking outside or pressing Escape

## User Dictionary

Harper supports a user dictionary via `linter.importWords()`.

When the user clicks "Add to dictionary" on a spelling error:
1. Word added to Harper's in-memory dictionary
2. Word persisted to `localStorage` under `harper-dictionary` key
3. Linter re-runs, squiggle disappears

On startup, saved words loaded back via `importWords()`.

## Settings

Two new settings in `appSettings`, displayed under the "Editor" section in the Settings modal:

- **Grammar check enabled** — boolean toggle, default `true`. When off, the Harper extension is inactive.
- **English dialect** — dropdown: American, British, Australian. Default American. Changing it re-initializes the linter.

## Dependencies

- `harper.js` — npm package, includes WASM binary via `slimBinaryInlined` import
- Vendored `lint.ts` from `packages/obsidian-plugin/src/lint.ts` in the Harper monorepo (MIT/Apache 2.0)

## Scope

- Main editor only — no grammar checking in nested editors (comment/revision modals)
- Inline squigglies + click popover only — no sidebar lint panel
- Harper-only — LLM-based style feedback stays in AutoAI/Reader Personas
