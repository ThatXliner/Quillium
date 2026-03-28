# Document Tabs — Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full test coverage for the DocumentTabs feature: unit tests for component UI logic, E2E tests for the full CRUD lifecycle, and a mock patch so all existing E2E tests handle tab commands properly.

**Architecture:** Three independent additions — (1) patch the shared `QuilliumPage` mock to handle tab IPC commands, (2) write a Vitest component test file for `DocumentTabs.svelte`, (3) write a Playwright E2E test file for the tab bar lifecycle. Each addition is independently committable.

**Tech Stack:** Vitest + @testing-library/svelte (unit), Playwright + QuilliumPage page-object (E2E), TypeScript.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `tests/e2e/QuilliumPage.ts` | Add `initialTabs` option + 6 tab command handlers to the Tauri mock |
| Create | `tests/documentTabs.test.ts` | Vitest unit tests for `DocumentTabs.svelte` component logic |
| Create | `tests/e2e/documentTabs.pw.ts` | Playwright E2E tests for tab bar CRUD via the browser |

---

## Task 1: Patch QuilliumPage mock with tab command handlers

**Files:**
- Modify: `tests/e2e/QuilliumPage.ts`

### Background

`QuilliumPage` is the shared page object used by every E2E test. Its `setup()` method injects a `__TAURI_INTERNALS__` mock that intercepts all `invoke()` calls. Currently, tab commands (`cmd_list_tabs`, `cmd_get_active_tab`, etc.) fall through to the `return null` default. The Editor mounts `DocumentTabs` which calls these commands on load — if they return `null` the tab bar either doesn't render or throws. We need to add proper handlers.

### Step 1: Read the file to understand current structure

Open `tests/e2e/QuilliumPage.ts` and locate:
- The `TauriMockOptions` type (around line 23)
- The `DEFAULT_OPTIONS` object (around line 42)
- The `invoke` mock switch block inside `addInitScript` (around line 121)
- The `payload` type annotation inside `addInitScript` (around line 92)

### Step 2: Add `initialTabs` to `TauriMockOptions` and `DEFAULT_OPTIONS`

In `TauriMockOptions`, add after the `snapshots` field:

```ts
/**
 * Pre-seeded tabs for cmd_list_tabs.
 * Defaults to one tab wired to draft-test-1.
 */
initialTabs?: Array<{
    id: string;
    documentId: string;
    label: string;
    draftId: string;
    position: number;
    createdAt: number;
}>;
```

In `DEFAULT_OPTIONS`, add:

```ts
initialTabs: [
    {
        id: "tab-test-1",
        documentId: "doc-test-1",
        label: "Tab 1",
        draftId: "draft-test-1",
        position: 0,
        createdAt: 0,
    },
],
```

### Step 3: Add `initialTabs` to the payload type annotation inside `addInitScript`

Locate the `payload:` type annotation on the function passed to `addInitScript` (the one that receives `apiKey`, `skipTutorial`, `settings`, `initialDoc`, `snapshots`). Add:

```ts
initialTabs: Array<{
    id: string;
    documentId: string;
    label: string;
    draftId: string;
    position: number;
    createdAt: number;
}>;
```

### Step 4: Add tab state variables inside the `addInitScript` callback

Directly before the `return` statement of the mock `invoke` function, add two mutable variables that hold tab state. These must be declared inside the `addInitScript` callback (so they are serialized into the page context) but outside the `invoke` function (so they persist across calls):

After the line `const invokeCalls: Array<{ cmd: string; args: unknown }> = [];`, add:

```ts
let tabs = payload.initialTabs.map((t) => ({ ...t }));
let activeTabId: string | null = tabs[0]?.id ?? null;
```

### Step 5: Add tab command handlers to the `invoke` mock

Find the last handler before the `// Tauri event plumbing` comment. Add the following block immediately before that comment:

```ts
// Tabs
if (cmd === "cmd_list_tabs") {
    const a = args as { docId: string };
    return tabs.filter((t) => t.documentId === a.docId);
}
if (cmd === "cmd_get_active_tab") {
    return activeTabId;
}
if (cmd === "cmd_set_active_tab") {
    const a = args as { docId: string; tabId: string };
    activeTabId = a.tabId;
    return null;
}
if (cmd === "cmd_create_tab") {
    const a = args as { docId: string; label: string };
    const newTab = {
        id: `tab-test-${tabs.length + 1}`,
        documentId: a.docId,
        label: a.label,
        draftId: `draft-test-${tabs.length + 1}`,
        position: tabs.length,
        createdAt: Date.now(),
    };
    tabs.push(newTab);
    return newTab;
}
if (cmd === "cmd_rename_tab") {
    const a = args as { tabId: string; label: string };
    const t = tabs.find((x) => x.id === a.tabId);
    if (t) t.label = a.label;
    return null;
}
if (cmd === "cmd_delete_tab") {
    const a = args as { tabId: string };
    tabs = tabs.filter((x) => x.id !== a.tabId);
    return null;
}
```

### Step 6: Pass `initialTabs` in the `addInitScript` call

Find where `setup()` calls `this.page.addInitScript(fn, { apiKey, skipTutorial, settings, initialDoc, snapshots })`. Add `initialTabs: opts.initialTabs ?? DEFAULT_OPTIONS.initialTabs` to that object.

### Step 7: Run existing E2E tests to verify no regressions

```bash
bun run test:e2e
```

Expected: all previously passing tests still pass. The tab mock now handles tab commands instead of returning null.

### Step 8: Commit

```bash
git add tests/e2e/QuilliumPage.ts
git commit -m "test(e2e): add tab command handlers to QuilliumPage mock"
```

---

## Task 2: Vitest unit tests for DocumentTabs.svelte

**Files:**
- Create: `tests/documentTabs.test.ts`
- Reference (read-only): `src/lib/editor/DocumentTabs.svelte`
- Reference (read-only): `src/lib/db/types.ts` (for `TabMeta` type)

### Background

`@testing-library/svelte` is already installed (see `package.json`). The Vitest config (`vite.config.js`) includes `tests/**/*.{test,spec}.{js,ts}` and uses `jsdom` with `tests/setup.ts` as setup file. `@testing-library/jest-dom` matchers are available.

The component receives five props: `tabs: TabMeta[]`, `activeTabId: string | null`, `ontabselect`, `ontabcreate`, `ontabrename`, `ontabdelete`. It manages internal rename state (`renamingTabId`, `renameValue`).

`TabMeta` shape (from `src/lib/db/types.ts`):
```ts
{ id: string; documentId: string; label: string; position: number; draftId: string; createdAt: number }
```

### Step 1: Write the test file

Create `tests/documentTabs.test.ts` with the full content below. The tests use `render` from `@testing-library/svelte`, `fireEvent` for interactions, and `vi.fn()` for callback spies.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/svelte";
import DocumentTabs from "$lib/editor/DocumentTabs.svelte";
import type { TabMeta } from "$lib/db/types";

function makeTab(overrides: Partial<TabMeta> = {}): TabMeta {
    return {
        id: "tab-1",
        documentId: "doc-1",
        label: "Tab 1",
        position: 0,
        draftId: "draft-1",
        createdAt: 0,
        ...overrides,
    };
}

const tab1 = makeTab({ id: "tab-1", label: "Tab 1" });
const tab2 = makeTab({ id: "tab-2", label: "Tab 2", position: 1 });

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        tabs: [tab1],
        activeTabId: "tab-1",
        ontabselect: vi.fn(),
        ontabcreate: vi.fn(),
        ontabrename: vi.fn(),
        ontabdelete: vi.fn(),
        ...overrides,
    };
}

describe("DocumentTabs", () => {
    it("renders tab labels", () => {
        render(DocumentTabs, { props: defaultProps({ tabs: [tab1, tab2] }) });
        expect(screen.getByText("Tab 1")).toBeInTheDocument();
        expect(screen.getByText("Tab 2")).toBeInTheDocument();
    });

    it("calls ontabselect with the correct tabId on click", async () => {
        const ontabselect = vi.fn();
        render(DocumentTabs, { props: defaultProps({ tabs: [tab1, tab2], ontabselect }) });
        await fireEvent.click(screen.getByText("Tab 2").closest('[role="tab"]')!);
        expect(ontabselect).toHaveBeenCalledWith("tab-2");
    });

    it("hides close button when only one tab", () => {
        render(DocumentTabs, { props: defaultProps({ tabs: [tab1] }) });
        expect(screen.queryByRole("button", { name: "Close tab" })).not.toBeInTheDocument();
    });

    it("shows close buttons when more than one tab", () => {
        render(DocumentTabs, { props: defaultProps({ tabs: [tab1, tab2] }) });
        expect(screen.getAllByRole("button", { name: "Close tab" })).toHaveLength(2);
    });

    it("calls ontabdelete with correct tabId when × clicked", async () => {
        const ontabdelete = vi.fn();
        render(DocumentTabs, { props: defaultProps({ tabs: [tab1, tab2], ontabdelete }) });
        const closeButtons = screen.getAllByRole("button", { name: "Close tab" });
        await fireEvent.click(closeButtons[0]);
        expect(ontabdelete).toHaveBeenCalledWith("tab-1");
    });

    it("enters rename mode on double-click", async () => {
        render(DocumentTabs, { props: defaultProps({ tabs: [tab1] }) });
        await fireEvent.dblClick(screen.getByText("Tab 1").closest('[role="tab"]')!);
        expect(screen.getByRole("textbox", { name: "Rename tab" })).toBeInTheDocument();
    });

    it("commits rename on Enter and calls ontabrename", async () => {
        const ontabrename = vi.fn();
        render(DocumentTabs, { props: defaultProps({ tabs: [tab1], ontabrename }) });
        await fireEvent.dblClick(screen.getByText("Tab 1").closest('[role="tab"]')!);
        const input = screen.getByRole("textbox", { name: "Rename tab" });
        await fireEvent.input(input, { target: { value: "New Name" } });
        await fireEvent.keyDown(input, { key: "Enter" });
        expect(ontabrename).toHaveBeenCalledWith("tab-1", "New Name");
        expect(screen.queryByRole("textbox", { name: "Rename tab" })).not.toBeInTheDocument();
    });

    it("cancels rename on Escape without calling ontabrename", async () => {
        const ontabrename = vi.fn();
        render(DocumentTabs, { props: defaultProps({ tabs: [tab1], ontabrename }) });
        await fireEvent.dblClick(screen.getByText("Tab 1").closest('[role="tab"]')!);
        const input = screen.getByRole("textbox", { name: "Rename tab" });
        await fireEvent.keyDown(input, { key: "Escape" });
        expect(ontabrename).not.toHaveBeenCalled();
        expect(screen.queryByRole("textbox", { name: "Rename tab" })).not.toBeInTheDocument();
    });

    it("falls back to 'Tab' when rename value is empty", async () => {
        const ontabrename = vi.fn();
        render(DocumentTabs, { props: defaultProps({ tabs: [tab1], ontabrename }) });
        await fireEvent.dblClick(screen.getByText("Tab 1").closest('[role="tab"]')!);
        const input = screen.getByRole("textbox", { name: "Rename tab" });
        await fireEvent.input(input, { target: { value: "   " } });
        await fireEvent.keyDown(input, { key: "Enter" });
        expect(ontabrename).toHaveBeenCalledWith("tab-1", "Tab");
    });

    it("commits rename on blur", async () => {
        const ontabrename = vi.fn();
        render(DocumentTabs, { props: defaultProps({ tabs: [tab1], ontabrename }) });
        await fireEvent.dblClick(screen.getByText("Tab 1").closest('[role="tab"]')!);
        const input = screen.getByRole("textbox", { name: "Rename tab" });
        await fireEvent.input(input, { target: { value: "Blurred Name" } });
        await fireEvent.blur(input);
        expect(ontabrename).toHaveBeenCalledWith("tab-1", "Blurred Name");
    });

    it("calls ontabcreate when + button clicked", async () => {
        const ontabcreate = vi.fn();
        render(DocumentTabs, { props: defaultProps({ tabs: [tab1], ontabcreate }) });
        await fireEvent.click(screen.getByRole("button", { name: "New tab" }));
        expect(ontabcreate).toHaveBeenCalledOnce();
    });
});
```

### Step 2: Run only this test file to see it pass

```bash
bun run test:run tests/documentTabs.test.ts
```

Expected output:
```
✓ tests/documentTabs.test.ts (11 tests)
```

If any test fails, read the error. Common issues:
- `fireEvent.input` doesn't trigger Svelte's `bind:value` — use `fireEvent.change` instead if the input doesn't update
- `closest('[role="tab"]')` returns null if the text node isn't inside the role element — use `screen.getAllByRole("tab")[0]` instead

### Step 3: Run full test suite to confirm no regressions

```bash
bun run test:run
```

Expected: all 38+ test files pass.

### Step 4: Commit

```bash
git add tests/documentTabs.test.ts
git commit -m "test(unit): add DocumentTabs component unit tests"
```

---

## Task 3: Playwright E2E tests for tab bar CRUD

**Files:**
- Create: `tests/e2e/documentTabs.pw.ts`
- Reference (read-only): `tests/e2e/QuilliumPage.ts` (page object API)
- Reference (read-only): `tests/e2e/settingsAndUI.pw.ts` (test file pattern)

### Background

The E2E tests run against the SvelteKit dev server with the Tauri mock injected by `QuilliumPage`. After Task 1, the mock returns a default tab (`tab-test-1`, label `"Tab 1"`) for any `cmd_list_tabs` call. The Editor wires `DocumentTabs` with `ontabcreate`, `ontabrename`, `ontabdelete`, `ontabselect` — these handlers call the corresponding IPC commands.

Useful `QuilliumPage` helper methods:
- `q.init()` — setup mock + navigate to `/` + wait for editor
- `q.getInvokedCommands()` — returns `string[]` of all IPC command names called so far
- `q.countInvocations(cmd)` — returns number of times `cmd` was called

### Step 1: Write the test file

Create `tests/e2e/documentTabs.pw.ts`:

```ts
/**
 * E2E tests for DocumentTabs — tab bar CRUD lifecycle.
 */
import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

test.describe("DocumentTabs", () => {
    test("tab bar renders the default tab on load", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const tablist = page.locator('[role="tablist"]');
        await expect(tablist).toBeVisible();
        await expect(tablist.getByRole("tab", { name: "Tab 1" })).toBeVisible();
    });

    test("clicking + creates a new tab", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        await page.getByRole("button", { name: "New tab" }).click();

        // A second tab should appear
        const tablist = page.locator('[role="tablist"]');
        await expect(tablist.getByRole("tab")).toHaveCount(2);

        // IPC command was called
        expect(await q.countInvocations("cmd_create_tab")).toBeGreaterThan(0);
    });

    test("clicking a non-active tab calls cmd_set_active_tab", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        // Create a second tab first
        await page.getByRole("button", { name: "New tab" }).click();
        const tablist = page.locator('[role="tablist"]');
        await expect(tablist.getByRole("tab")).toHaveCount(2);

        // Click the first tab (currently active), then the second
        const tabs = tablist.getByRole("tab");
        await tabs.nth(1).click();

        expect(await q.countInvocations("cmd_set_active_tab")).toBeGreaterThan(0);
    });

    test("double-clicking a tab label and pressing Enter renames it", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const tablist = page.locator('[role="tablist"]');
        const tab = tablist.getByRole("tab", { name: "Tab 1" });

        await tab.dblclick();

        const input = page.getByRole("textbox", { name: "Rename tab" });
        await expect(input).toBeVisible();
        await input.fill("My Doc");
        await page.keyboard.press("Enter");

        await expect(tablist.getByRole("tab", { name: "My Doc" })).toBeVisible();
        expect(await q.countInvocations("cmd_rename_tab")).toBeGreaterThan(0);
    });

    test("clicking × removes the tab", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        // Need 2 tabs first (close button is hidden with 1)
        await page.getByRole("button", { name: "New tab" }).click();
        const tablist = page.locator('[role="tablist"]');
        await expect(tablist.getByRole("tab")).toHaveCount(2);

        // Hover first tab to reveal the close button, then click it
        const firstTab = tablist.getByRole("tab").first();
        await firstTab.hover();
        await page.getByRole("button", { name: "Close tab" }).first().click();

        await expect(tablist.getByRole("tab")).toHaveCount(1);
        expect(await q.countInvocations("cmd_delete_tab")).toBeGreaterThan(0);
    });

    test("close button is absent when only one tab remains", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        // Only one tab by default — close button should not exist
        const tablist = page.locator('[role="tablist"]');
        await expect(tablist.getByRole("tab")).toHaveCount(1);

        // Hover to ensure it would show if it existed
        await tablist.getByRole("tab").first().hover();
        await expect(page.getByRole("button", { name: "Close tab" })).not.toBeVisible();
    });
});
```

### Step 2: Run only these E2E tests

```bash
bun run test:e2e -- --grep "DocumentTabs"
```

Expected: 5 passing tests.

If a test fails:
- "tab bar renders" failing → the mock isn't returning tabs; verify Task 1 changes were committed and the dev server restarted
- "rename" failing → `dblclick` may need to target the `<span>` inside the tab, not the tab div: use `tab.locator("span").first().dblclick()`
- "close button not visible" → the opacity-0 CSS means Playwright's `not.toBeVisible()` passes by default; if the test is wrong, use `not.toBeAttached()` instead

### Step 3: Run full E2E suite

```bash
bun run test:e2e
```

Expected: all E2E tests pass.

### Step 4: Commit

```bash
git add tests/e2e/documentTabs.pw.ts
git commit -m "test(e2e): add DocumentTabs E2E tests for tab bar CRUD"
```

---

## Final Verification

Run all tests together:

```bash
bun run test:run && bun run test:e2e
```

Expected:
- Vitest: 38+ test files, 593+ tests passing (11 new unit tests added)
- Playwright: all E2E suites passing including 5 new tab tests
