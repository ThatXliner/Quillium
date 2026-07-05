/**
 * versionHistory.pw.ts — E2E tests for the Version History page.
 *
 * All Tauri IPC is intercepted by the QuilliumPage mock — no real SQLite.
 * Snapshots are seeded via the `snapshots` option and served in-memory.
 */

import { expect, test } from "@playwright/test";
import {
    type MockDocEvent,
    type MockDraft,
    type MockSnapshot,
    type MockTab,
    QuilliumPage,
} from "./QuilliumPage";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_TIME = Date.now();

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

function makeDocEvents(): MockDocEvent[] {
    return [
        {
            id: 1,
            documentId: "doc-test-1",
            eventType: "draft_created",
            payload: JSON.stringify({ draftId: "draft-test-2", label: "take 2" }),
            createdAt: BASE_TIME - 1000 * 60 * 10,
        },
    ];
}

function makeTwoTabStructure(): { tabs: MockTab[]; drafts: MockDraft[] } {
    return {
        tabs: [
            {
                id: "tab-test-1",
                documentId: "doc-test-1",
                tabType: "draft",
                label: "Main",
                position: 0,
                createdAt: 0,
                deletedAt: null,
            },
            {
                id: "tab-test-2",
                documentId: "doc-test-1",
                tabType: "draft",
                label: "Tab 2",
                position: 1,
                createdAt: 0,
                deletedAt: null,
            },
        ],
        drafts: [
            {
                id: "draft-test-1",
                documentId: "doc-test-1",
                label: "main",
                createdAt: 0,
                isActive: true,
                tabId: "tab-test-1",
                parentDraftId: null,
                branchedFrom: null,
                locked: false,
                deletedAt: null,
            },
            {
                id: "draft-test-2",
                documentId: "doc-test-1",
                label: "take 2",
                createdAt: 0,
                isActive: true,
                tabId: "tab-test-2",
                parentDraftId: null,
                branchedFrom: null,
                locked: false,
                deletedAt: null,
            },
        ],
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("history page renders version list with date groups", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    // Both date groups should be visible
    await expect(page.getByText("Today")).toBeVisible();
    await expect(page.getByText("Yesterday")).toBeVisible();

    // Named snapshots show their labels (scoped to the list to avoid breadcrumb matches)
    const list = page.locator("#versions-panel");
    await expect(list.getByText("Before refactor")).toBeVisible();
    await expect(list.getByText("Initial draft")).toBeVisible();
});

test("history page renders document activity inside the same timeline", async ({ page }) => {
    const qp = new QuilliumPage(page, {
        snapshots: makeSnapshots(),
        docEvents: makeDocEvents(),
    });
    await qp.initHistory();

    const timeline = page.locator("#versions-panel").getByRole("list", {
        name: "History timeline",
    });
    await expect(timeline.getByText("Before refactor")).toBeVisible();
    await expect(timeline.getByText("Created draft “take 2”")).toBeVisible();
    await expect(page.locator('#versions-panel [aria-label="Document activity"]')).toHaveCount(0);
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
    await expect
        .poll(() =>
            page.locator(".version-preview .cm-content").evaluate((el) => el.textContent ?? ""),
        )
        .toContain("Third version");

    // Click the auto-saved entry (snapshot id=2, no label) in the Today group
    const unselected = page.locator("[aria-selected='false']").first();
    await unselected.click();

    await expect
        .poll(() =>
            page.locator(".version-preview .cm-content").evaluate((el) => el.textContent ?? ""),
        )
        .toContain("Second version");
});

test("history preview uses the configured document typography", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    const style = await page.locator(".version-preview .cm-content").evaluate((el) => {
        const computed = getComputedStyle(el);
        return {
            fontFamily: computed.fontFamily,
            fontSize: computed.fontSize,
            textIndent: computed.textIndent,
        };
    });

    expect(style.fontFamily).toContain("Georgia");
    expect(style.fontSize).toBe("18px");
    expect(style.textIndent).toBe("36px");
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

test("draft activity selects its owning tab by default", async ({ page }) => {
    const structure = makeTwoTabStructure();
    const qp = new QuilliumPage(page, {
        ...structure,
        snapshots: [
            {
                id: 1,
                draftId: "draft-test-1",
                tabId: "tab-test-1",
                draftLabel: "main",
                upToEventId: 10,
                createdAt: BASE_TIME - 3000,
                label: null,
                doc: "Main tab text.",
            },
            {
                id: 2,
                draftId: "draft-test-2",
                tabId: "tab-test-2",
                draftLabel: "take 2",
                upToEventId: 20,
                createdAt: BASE_TIME - 2000,
                label: null,
                doc: "Second tab text.",
            },
        ],
        docEvents: [
            {
                id: 2,
                documentId: "doc-test-1",
                eventType: "draft_unlocked",
                payload: JSON.stringify({ draftId: "draft-test-2", label: "take 2" }),
                createdAt: BASE_TIME - 1000,
            },
        ],
    });
    await qp.initHistory();

    await expect(page.getByRole("button", { name: "Tab 2" })).toHaveClass(/bg-blue-50/);
    await expect
        .poll(() =>
            page.locator(".version-preview .cm-content").evaluate((el) => el.textContent ?? ""),
        )
        .toContain("Second tab text");
});

test("empty state renders when there is no history", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: [] });
    await qp.initHistory();

    await expect(page.getByText("No history yet.")).toBeVisible();
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

test("Restore button requires confirmation before calling cmd_restore_to_coordinate", async ({
    page,
}) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    const restoreBtn = page.getByRole("button", { name: /restore to here/i });
    await expect(restoreBtn).toBeVisible();

    // First click — should ask for confirmation, not call the command yet
    await restoreBtn.click();
    await expect(page.getByRole("button", { name: /confirm restore/i })).toBeVisible();

    const cmdsBefore = await qp.getInvokedCommands();
    expect(cmdsBefore).not.toContain("cmd_restore_to_coordinate");

    // Second click — confirms, calls the command and navigates away
    await page.getByRole("button", { name: /confirm restore/i }).click();

    await expect.poll(() => qp.getInvokedCommands()).toContain("cmd_restore_to_coordinate");
    await expect(qp.editor).toBeVisible({ timeout: 10_000 });
});

test("saving a named checkpoint calls cmd_create_named_snapshot and adds it to the list", async ({
    page,
}) => {
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
    await entry.locator("button[aria-label='Edit label']").first().click();

    const labelInput = entry.locator("input[type='text']");
    await expect(labelInput).toBeVisible();
    await labelInput.fill("Renamed checkpoint");
    await labelInput.press("Enter");

    await expect.poll(() => qp.getInvokedCommands()).toContain("cmd_label_snapshot");
    await expect(page.locator("#versions-panel").getByText("Renamed checkpoint")).toBeVisible();
});

test("cmd_list_document_snapshots is called on page load", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    const cmds = await qp.getInvokedCommands();
    expect(cmds).toContain("cmd_list_document_snapshots");
});

// ── Storage management ────────────────────────────────────────────────────────

test("storage size is displayed in the versions panel header", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    // Size should appear as a button in the panel header (e.g. "123 B" / "1.2 KB")
    const sizeBtn = page.locator("#versions-panel button[title='Manage storage']");
    await expect(sizeBtn).toBeVisible();
    // Text should be a formatted byte size — just check it's non-empty and numeric-ish
    const text = await sizeBtn.textContent();
    expect(text?.trim()).toMatch(/\d/);
});

test("clicking the storage size button toggles the manage storage panel", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    const sizeBtn = page.locator("#versions-panel button[title='Manage storage']");
    await expect(page.getByText("Manage storage")).not.toBeVisible();

    await sizeBtn.click();
    await expect(page.getByText("Manage storage")).toBeVisible();

    await sizeBtn.click();
    await expect(page.getByText("Manage storage")).not.toBeVisible();
});

test("prune keep-last-N requires confirmation then calls cmd_prune_snapshots_keep_last_n", async ({
    page,
}) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    await page.locator("#versions-panel button[title='Manage storage']").click();
    await expect(page.getByText("Manage storage")).toBeVisible();

    // First click shows confirm state
    const pruneBtn = page.locator("button", { hasText: /^Prune$/ }).first();
    await pruneBtn.click();
    await expect(page.locator("button", { hasText: /confirm\?/i }).first()).toBeVisible();

    const cmdsBefore = await qp.getInvokedCommands();
    expect(cmdsBefore).not.toContain("cmd_prune_snapshots_keep_last_n");

    // Second click confirms and calls the command
    await page
        .locator("button", { hasText: /confirm\?/i })
        .first()
        .click();
    await expect.poll(() => qp.getInvokedCommands()).toContain("cmd_prune_snapshots_keep_last_n");
});

test("prune older-than requires confirmation then calls cmd_prune_snapshots_older_than", async ({
    page,
}) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    await page.locator("#versions-panel button[title='Manage storage']").click();
    await expect(page.getByText("Manage storage")).toBeVisible();

    // Second "Prune" button is the "older than" one
    const pruneBtn = page.locator("button", { hasText: /^Prune$/ }).nth(1);
    await pruneBtn.click();
    await expect(page.locator("button", { hasText: /confirm\?/i }).first()).toBeVisible();

    const cmdsBefore = await qp.getInvokedCommands();
    expect(cmdsBefore).not.toContain("cmd_prune_snapshots_older_than");

    await page
        .locator("button", { hasText: /confirm\?/i })
        .first()
        .click();
    await expect.poll(() => qp.getInvokedCommands()).toContain("cmd_prune_snapshots_older_than");
});

test("prune shows deleted count and refreshes the snapshot list", async ({ page }) => {
    // makeSnapshots() has one unlabeled snapshot (id=2). Setting keepN=0 will delete it.
    const snaps = makeSnapshots();
    const qp = new QuilliumPage(page, { snapshots: snaps });
    await qp.initHistory();

    await page.locator("#versions-panel button[title='Manage storage']").click();

    // Set keepN to 0 to delete the one unlabeled snapshot
    const keepNInput = page.locator("input[type='number']").first();
    await keepNInput.fill("0");

    await page
        .locator("button", { hasText: /^Prune$/ })
        .first()
        .click();
    await page
        .locator("button", { hasText: /confirm\?/i })
        .first()
        .click();

    // Deleted count feedback appears
    await expect(page.getByText(/deleted \d+ snapshot/i)).toBeVisible({ timeout: 5_000 });
    // cmd_list_document_snapshots is called again after pruning
    const cmds = await qp.getInvokedCommands();
    expect(cmds.filter((c) => c === "cmd_list_document_snapshots").length).toBeGreaterThan(1);
});

test("named checkpoints are never deleted by keep-last-N prune", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    await page.locator("#versions-panel button[title='Manage storage']").click();

    // Set keepN to 0 (would delete all unlabeled)
    const keepNInput = page.locator("input[type='number']").first();
    await keepNInput.fill("0");

    await page
        .locator("button", { hasText: /^Prune$/ })
        .first()
        .click();
    await page
        .locator("button", { hasText: /confirm\?/i })
        .first()
        .click();

    await expect.poll(() => qp.getInvokedCommands()).toContain("cmd_prune_snapshots_keep_last_n");

    // Labeled snapshots should still be in the list (scoped to avoid breadcrumb matches)
    const list = page.locator("#versions-panel");
    await expect(list.getByText("Before refactor")).toBeVisible();
    await expect(list.getByText("Initial draft")).toBeVisible();
});
