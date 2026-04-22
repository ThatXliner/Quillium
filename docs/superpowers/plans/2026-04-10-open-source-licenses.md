# Open Source Licenses Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Open Source Licenses" screen accessible from the native app menu (Quillium → Open Source Licenses…) that shows all direct JS and Rust dependencies with their license info.

**Architecture:** A build-time Bun script reads `package.json` (direct `dependencies` only) and `src-tauri/Cargo.toml` (direct `[dependencies]` only), writes `static/licenses.json`. The Rust app menu emits `menu:licenses` to the frontend; `+page.svelte` listens and toggles `licensesOpen`; `LicensesModal.svelte` fetches and renders the JSON.

**Tech Stack:** Bun (script), TypeScript, Svelte 5 runes, Tailwind CSS v4, Tauri 2 menu API, `@tauri-apps/plugin-opener`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/generate-licenses.ts` | Create | Read manifests → write `static/licenses.json` |
| `static/licenses.json` | Create (generated) | License data consumed by the modal |
| `package.json` | Modify | Add `"licenses"` script; prepend to `"build"` |
| `src-tauri/src/lib.rs` | Modify | Add menu item + emit `menu:licenses` event |
| `src/lib/ui/LicensesModal.svelte` | Create | Modal UI component |
| `src/routes/+page.svelte` | Modify | Listen for `menu:licenses`, render modal |

---

### Task 1: Write the license generation script

**Files:**
- Create: `scripts/generate-licenses.ts`

- [ ] **Step 1: Create the script**

```typescript
// scripts/generate-licenses.ts
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

type LicenseEntry = {
    name: string;
    version: string;
    license: string;
    url?: string;
    ecosystem: "js" | "rust";
};

// ── JS dependencies ───────────────────────────────────────────────
const pkgJson = JSON.parse(readFileSync("package.json", "utf-8"));
const jsDeps: LicenseEntry[] = Object.keys(pkgJson.dependencies ?? {}).flatMap((name) => {
    try {
        const depPkg = JSON.parse(
            readFileSync(join("node_modules", name, "package.json"), "utf-8"),
        );
        const repo = depPkg.repository;
        let url: string | undefined;
        if (typeof repo === "string") {
            url = repo.startsWith("https://") ? repo : `https://github.com/${repo.replace(/^github:/, "")}`;
        } else if (typeof repo === "object" && repo?.url) {
            url = repo.url
                .replace(/^git\+/, "")
                .replace(/^git:\/\//, "https://")
                .replace(/\.git$/, "");
        } else if (depPkg.homepage) {
            url = depPkg.homepage;
        }
        return [
            {
                name: depPkg.name ?? name,
                version: depPkg.version ?? pkgJson.dependencies[name],
                license: depPkg.license ?? "Unknown",
                url,
                ecosystem: "js" as const,
            },
        ];
    } catch {
        // Package not found in node_modules — skip silently.
        return [];
    }
});

// ── Rust dependencies ─────────────────────────────────────────────
// Hardcoded because Cargo.toml has a small, stable set of direct deps
// and cargo-about requires a separate toolchain setup.
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf-8");

// Parse [dependencies] section: name = "version" or name = { version = "x", ... }
const depSection = cargoToml.split(/\[(?:dev-)?dependencies\]/)[1] ?? "";
const versionMap: Record<string, string> = {};
for (const line of depSection.split("\n")) {
    const simple = line.match(/^(\S+)\s*=\s*"([^"]+)"/);
    if (simple) {
        versionMap[simple[1]] = simple[2];
        continue;
    }
    const table = line.match(/^(\S+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/);
    if (table) versionMap[table[1]] = table[2];
}

const RUST_LICENSES: Record<string, { license: string; url: string }> = {
    tauri:                { license: "MIT/Apache-2.0", url: "https://github.com/tauri-apps/tauri" },
    "tauri-plugin-opener":  { license: "MIT/Apache-2.0", url: "https://github.com/tauri-apps/plugins-workspace" },
    "tauri-plugin-updater": { license: "MIT/Apache-2.0", url: "https://github.com/tauri-apps/plugins-workspace" },
    "tauri-plugin-process": { license: "MIT/Apache-2.0", url: "https://github.com/tauri-apps/plugins-workspace" },
    serde:               { license: "MIT/Apache-2.0", url: "https://github.com/serde-rs/serde" },
    serde_json:          { license: "MIT/Apache-2.0", url: "https://github.com/serde-rs/json" },
    keyring:             { license: "MIT",             url: "https://github.com/hwchen/keyring-rs" },
    rusqlite:            { license: "MIT",             url: "https://github.com/rusqlite/rusqlite" },
    uuid:                { license: "MIT/Apache-2.0", url: "https://github.com/uuid-rs/uuid" },
};

const rustDeps: LicenseEntry[] = Object.keys(versionMap)
    .filter((name) => name in RUST_LICENSES)
    .map((name) => ({
        name,
        version: versionMap[name],
        license: RUST_LICENSES[name].license,
        url: RUST_LICENSES[name].url,
        ecosystem: "rust" as const,
    }));

// ── Merge, sort, write ────────────────────────────────────────────
const all: LicenseEntry[] = [...jsDeps, ...rustDeps].sort((a, b) =>
    a.name.localeCompare(b.name),
);

writeFileSync("static/licenses.json", JSON.stringify(all, null, 2) + "\n");
console.log(`Generated static/licenses.json (${all.length} entries)`);
```

- [ ] **Step 2: Run the script to verify it works**

```bash
bun scripts/generate-licenses.ts
```

Expected: output like `Generated static/licenses.json (38 entries)` and a new `static/licenses.json` file with entries for both `"ecosystem": "js"` and `"ecosystem": "rust"` packages. Spot-check that `@codemirror/state`, `svelte`, `tauri`, and `rusqlite` are present.

- [ ] **Step 3: Add scripts to `package.json`**

In `package.json`, add `"licenses"` to scripts and prepend it to `"build"`:

```json
"licenses": "bun scripts/generate-licenses.ts",
"build": "bun run licenses && vite build",
```

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-licenses.ts static/licenses.json package.json
```

Then use `/x-commit`.

---

### Task 2: Add the Licenses menu item in Rust

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the menu item to the Quillium submenu**

In `src-tauri/src/lib.rs`, locate the `app_menu` block (around line 341). After the Settings item and its `.separator()`, add the Licenses item before the `.services()` line:

```rust
let app_menu = SubmenuBuilder::new(app, "Quillium")
    .about(None)
    .separator()
    .item(
        &MenuItemBuilder::with_id("settings", "Settings…")
            .accelerator("CmdOrCtrl+,")
            .build(app)?,
    )
    .item(
        &MenuItemBuilder::with_id("licenses", "Open Source Licenses…")
            .build(app)?,
    )
    .separator()
    .services()
    .separator()
    .hide()
    .hide_others()
    .show_all()
    .separator()
    .quit()
    .build()?;
```

- [ ] **Step 2: Handle the `licenses` event**

In the `on_menu_event` match arm (around line 400), add `"licenses"` to the existing pattern:

```rust
"settings" | "history" | "library" | "licenses" => {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.emit(&format!("menu:{id}"), ());
    }
}
```

- [ ] **Step 3: Verify the Rust code compiles**

```bash
cd src-tauri && cargo check 2>&1 | tail -20
```

Expected: `Finished` with no errors. (Warnings are fine.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
```

Then use `/x-commit`.

---

### Task 3: Create LicensesModal.svelte

**Files:**
- Create: `src/lib/ui/LicensesModal.svelte`

- [ ] **Step 1: Create the component**

```svelte
<!--
    LicensesModal.svelte — Open Source Licenses overlay.

    Fetches /licenses.json at mount and renders direct JS and Rust
    dependencies grouped by ecosystem.

    Props:
      ondismiss — called when the user closes the modal
-->
<script lang="ts">
import { X } from "lucide-svelte";
import { openUrl } from "@tauri-apps/plugin-opener";
import { onMount } from "svelte";

type LicenseEntry = {
    name: string;
    version: string;
    license: string;
    url?: string;
    ecosystem: "js" | "rust";
};

const { ondismiss }: { ondismiss: () => void } = $props();

let entries = $state<LicenseEntry[]>([]);
let loading = $state(true);

onMount(async () => {
    const res = await fetch("/licenses.json");
    entries = await res.json();
    loading = false;
});

const jsEntries = $derived(entries.filter((e) => e.ecosystem === "js"));
const rustEntries = $derived(entries.filter((e) => e.ecosystem === "rust"));

function openLink(url: string) {
    openUrl(url);
}
</script>

<div class="fixed inset-0 z-[9999]" role="dialog" aria-modal="true" aria-label="Open Source Licenses">
    <button
        type="button"
        class="absolute inset-0 bg-black/55 border-0 p-0 cursor-default"
        aria-label="Close"
        tabindex="-1"
        onclick={ondismiss}
    ></button>

    <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-h-[75vh] bg-white shadow-2xl rounded-2xl flex flex-col overflow-hidden border border-black/[0.06]"
        role="document"
    >
        <!-- Header -->
        <div class="flex items-start justify-between px-7 pt-7 pb-0 shrink-0">
            <div>
                <h3 class="text-xl font-bold text-black/85 leading-tight">Open Source Licenses</h3>
                <p class="text-xs text-black/35 mt-1">Libraries that make Quillium possible</p>
            </div>
            <button
                onclick={ondismiss}
                aria-label="Close"
                class="flex items-center justify-center w-8 h-8 rounded-lg bg-black/[0.05] text-black/35 hover:text-black/60 hover:bg-black/[0.1] transition-colors"
            >
                <X size={16} />
            </button>
        </div>

        <!-- Scrollable content -->
        <div class="flex-1 overflow-y-auto px-7 pt-5 pb-7">
            {#if loading}
                <p class="text-sm text-black/35">Loading…</p>
            {:else}
                {#each [{ label: "JavaScript", items: jsEntries }, { label: "Rust", items: rustEntries }] as section}
                    {#if section.items.length > 0}
                        <h4 class="text-xs font-semibold uppercase tracking-wider text-black/30 mb-3 mt-5 first:mt-0">
                            {section.label}
                        </h4>
                        <ul class="space-y-2">
                            {#each section.items as entry}
                                <li class="flex items-center justify-between gap-4">
                                    <div class="flex items-center gap-2 min-w-0">
                                        {#if entry.url}
                                            <button
                                                type="button"
                                                class="text-sm font-medium text-black/75 hover:text-black truncate cursor-pointer bg-transparent border-0 p-0 text-left"
                                                onclick={() => openLink(entry.url!)}
                                            >
                                                {entry.name}
                                            </button>
                                        {:else}
                                            <span class="text-sm font-medium text-black/75 truncate">{entry.name}</span>
                                        {/if}
                                        <span class="text-xs text-black/30 shrink-0">{entry.version}</span>
                                    </div>
                                    <span class="text-xs text-black/40 bg-black/[0.04] rounded px-2 py-0.5 shrink-0 font-mono">
                                        {entry.license}
                                    </span>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                {/each}
            {/if}
        </div>
    </div>
</div>
```

- [ ] **Step 2: Type-check**

```bash
bun run check
```

Expected: no errors in `LicensesModal.svelte`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ui/LicensesModal.svelte
```

Then use `/x-commit`.

---

### Task 4: Wire up the modal in +page.svelte

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Import the modal**

At the top of `+page.svelte`, add the import alongside the other `$lib/ui` imports (around line 52):

```typescript
import LicensesModal from "$lib/ui/LicensesModal.svelte";
```

- [ ] **Step 2: Add state variable**

Near the other boolean state variables (around line 56, alongside `showBetaDisclaimer`, `showChangelog`):

```typescript
let licensesOpen = $state(false);
```

- [ ] **Step 3: Add the menu listener**

In the `onMount` block where the other `menu:*` listeners are (around line 252), add after the `menu:library` listener:

```typescript
listen("menu:licenses", () => {
    if (!destroyed) licensesOpen = !licensesOpen;
}).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));
```

- [ ] **Step 4: Render the modal**

In the template section, after the `{#if showChangelog}` block (around line 403):

```svelte
<!-- Open Source Licenses modal -->
{#if licensesOpen}
    <LicensesModal ondismiss={() => (licensesOpen = false)} />
{/if}
```

- [ ] **Step 5: Type-check**

```bash
bun run check
```

Expected: no errors.

- [ ] **Step 6: Smoke-test manually**

```bash
bun run tauri dev
```

Open the app, go to the Quillium menu, click "Open Source Licenses…". Expected: modal opens, lists JS and Rust dependencies in two sections, clicking a package name opens its URL in the browser, X and backdrop click dismiss the modal.

- [ ] **Step 7: Commit**

```bash
git add src/routes/+page.svelte
```

Then use `/x-commit`.
