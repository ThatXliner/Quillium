# Open Source Licenses Screen

**Date:** 2026-04-10
**Status:** Approved

## Overview

Add an "Open Source Licenses" screen to Quillium, accessible via the native app menu. A build-time script generates the license data; a modal displays it. This satisfies attribution obligations for publicly distributed software.

## 1. License generation script

**File:** `scripts/generate-licenses.ts`

Reads two sources at build time:

- **JS:** direct `dependencies` (not `devDependencies`) from `package.json`. For each package, reads `node_modules/<name>/package.json` and extracts `name`, `version`, `license`, and `repository` (or `homepage`).
- **Rust:** direct `[dependencies]` (not `[dev-dependencies]`) from `src-tauri/Cargo.toml`. License info is hardcoded for the known stable set: `serde` (MIT/Apache-2.0), `serde_json` (MIT/Apache-2.0), `keyring` (MIT), `rusqlite` (MIT), `uuid` (MIT/Apache-2.0), plus Tauri and its plugins (MIT/Apache-2.0).

Output: `static/licenses.json` — an array of objects sorted alphabetically by name:

```ts
type LicenseEntry = {
    name: string;
    version: string;
    license: string;
    url?: string;       // repo or homepage URL, if available
    ecosystem: "js" | "rust";
};
```

**Script is run via:** `bun run licenses`

**Integrated into build:** `"build"` script in `package.json` is updated to `"bun run licenses && vite build"` so the file is always fresh before bundling.

## 2. Menu wiring

**Rust (`src-tauri/src/lib.rs`):**

Add a `"licenses"` `MenuItemBuilder` item to the Quillium submenu, placed after the Settings item and before the next separator. No accelerator needed.

The `on_menu_event` match arm is extended to include `"licenses"` alongside `"settings"`, `"history"`, `"library"` — it emits `menu:licenses` to the frontend window.

**Frontend (`src/routes/+page.svelte`):**

Add a `licensesOpen` boolean state variable. Add a `menu:licenses` Tauri listener in the existing listener block (same pattern as `menu:settings`). When fired, toggle `licensesOpen`. Render `<LicensesModal>` when `licensesOpen` is true.

## 3. LicensesModal.svelte

**File:** `src/lib/ui/LicensesModal.svelte`

Modeled after `ChangelogModal.svelte`:
- Fixed full-screen overlay (`z-[9999]`) with `bg-black/55` backdrop; clicking backdrop dismisses
- Centered card: `w-[520px] max-h-[75vh]`, scrollable body
- Header: title "Open Source Licenses", X button
- Body: two sections — **JavaScript** and **Rust** — each a list of entries
- Each entry: package name (linked to `url` if present, opens via `@tauri-apps/plugin-opener`), version in muted text, license badge/label
- Fetches `/licenses.json` on mount; shows a brief loading state while fetching

Props: `ondismiss: () => void`

## Files changed

| File | Change |
|------|--------|
| `scripts/generate-licenses.ts` | New — license generation script |
| `static/licenses.json` | New — generated output, committed to repo |
| `package.json` | Add `"licenses"` script; prepend to `"build"` |
| `src-tauri/src/lib.rs` | Add menu item + event handler |
| `src/lib/ui/LicensesModal.svelte` | New modal component |
| `src/routes/+page.svelte` | Add listener + render modal |

## Out of scope

- Transitive (indirect) dependencies
- The landing website (quillium.bryanhu.com)
- Full license text display (just license name + link is sufficient)
