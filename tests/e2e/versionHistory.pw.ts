/**
 * versionHistory.pw.ts — E2E tests for the Version History page.
 *
 * All Tauri IPC is intercepted by the QuilliumPage mock — no real SQLite.
 * Snapshots are seeded via the `snapshots` option and served in-memory.
 */

import { test, expect } from "@playwright/test";
import { QuilliumPage, type MockSnapshot } from "./QuilliumPage";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_TIME = new Date("2026-03-24T10:00:00").getTime();

function makeSnapshots(): MockSnapshot[] {
    return [
        {
            id: 3,
            draftId: "draft-test-1",
            upToEventId: 30,
            createdAt: BASE_TIME - 1000 * 60 * 5, // 5 min ago — "Today"
            label: "Before refactor",
            doc: "Third version of the document.",
        },
        {
            id: 2,
            draftId: "draft-test-1",
            upToEventId: 20,
            createdAt: BASE_TIME - 1000 * 60 * 30, // 30 min ago — "Today"
            label: null,
            doc: "Second version of the document.",
        },
        {
            id: 1,
            draftId: "draft-test-1",
            upToEventId: 10,
            createdAt: BASE_TIME - 1000 * 60 * 60 * 25, // 25 h ago — "Yesterday"
            label: "Initial draft",
            doc: "First version of the document.",
        },
    ];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("history page renders version list with date groups", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    // Both date groups should be visible
    await expect(page.getByText("Today")).toBeVisible();
    await expect(page.getByText("Yesterday")).toBeVisible();

    // Named snapshots show their labels
    await expect(page.getByText("Before refactor")).toBeVisible();
    await expect(page.getByText("Initial draft")).toBeVisible();
});

test("history page navigates here from status bar History button", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.init();

    await qp.openHistoryFromStatusBar();
    expect(page.url()).toContain("/history");
    await expect(page.getByText("Version History")).toBeVisible();
});

test("selecting a snapshot loads its document text in the preview", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    // First snapshot (most recent) is selected by default — its doc should appear
    await expect.poll(() =>
        page.locator(".version-preview .cm-content").evaluate((el) => el.textContent ?? "")
    ).toContain("Third version");

    // Click the auto-saved entry (snapshot id=2, no label) in the Today group
    const unselected = page.locator("[aria-selected='false']").first();
    await unselected.click();

    await expect.poll(() =>
        page.locator(".version-preview .cm-content").evaluate((el) => el.textContent ?? "")
    ).toContain("Second version");
});

test("most recent snapshot is selected by default", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    // The most recent snapshot is ID 3, labelled "Before refactor"
    // Its entry should be marked selected (blue border class applied)
    const selected = page.locator("[aria-selected='true']");
    await expect(selected).toBeVisible();
    await expect(selected).toContainText("Before refactor");
});

test("empty state renders when there are no snapshots", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: [] });
    await qp.initHistory();

    await expect(page.getByText("No versions yet.")).toBeVisible();
    await expect(page.getByText("Versions are saved automatically")).toBeVisible();
});

test("Back button navigates to the editor", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    await page.getByRole("button", { name: /back/i }).click();
    await expect(qp.editor).toBeVisible({ timeout: 10_000 });
    expect(page.url()).not.toContain("/history");
});

test("Escape key navigates back to the editor", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    await page.keyboard.press("Escape");
    await expect(qp.editor).toBeVisible({ timeout: 10_000 });
    expect(page.url()).not.toContain("/history");
});

test("Restore button requires confirmation before calling cmd_restore_to_snapshot", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    const restoreBtn = page.getByRole("button", { name: /restore this version/i });
    await expect(restoreBtn).toBeVisible();

    // First click — should ask for confirmation, not call the command yet
    await restoreBtn.click();
    await expect(page.getByRole("button", { name: /confirm restore/i })).toBeVisible();

    const cmdsBefore = await qp.getInvokedCommands();
    expect(cmdsBefore).not.toContain("cmd_restore_to_snapshot");

    // Second click — confirms, calls the command and navigates away
    await page.getByRole("button", { name: /confirm restore/i }).click();

    await expect.poll(() => qp.getInvokedCommands()).toContain("cmd_restore_to_snapshot");
    await expect(qp.editor).toBeVisible({ timeout: 10_000 });
});

test("saving a named checkpoint calls cmd_create_named_snapshot and adds it to the list", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    // Type in the editor first so lastPersistedEventId > -1, enabling the Save button
    await qp.init();
    await qp.typeInEditor("hello");
    await qp.openHistoryFromStatusBar();

    const input = page.getByPlaceholder("Name this version…");
    await input.fill("My checkpoint");
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect.poll(() => qp.getInvokedCommands()).toContain("cmd_create_named_snapshot");
    // The new checkpoint should appear in the list after reload
    await expect(page.getByText("My checkpoint")).toBeVisible({ timeout: 5_000 });
});

test("inline label editing calls cmd_label_snapshot", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    // Click the pencil icon on the "Before refactor" entry to enter edit mode
    const entry = page.locator("[aria-selected='true']");
    await entry.locator("button[title='']").first().click();

    const labelInput = entry.locator("input[type='text']");
    await expect(labelInput).toBeVisible();
    await labelInput.fill("Renamed checkpoint");
    await labelInput.press("Enter");

    await expect.poll(() => qp.getInvokedCommands()).toContain("cmd_label_snapshot");
    await expect(page.getByText("Renamed checkpoint")).toBeVisible();
});

test("cmd_list_snapshots is called on page load", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    const cmds = await qp.getInvokedCommands();
    expect(cmds).toContain("cmd_list_snapshots");
});
