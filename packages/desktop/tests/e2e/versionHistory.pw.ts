/**
 * versionHistory.pw.ts — E2E tests for the Version History page.
 *
 * All Tauri IPC is intercepted by the QuilliumPage mock — no real SQLite.
 * Snapshots are seeded via the `snapshots` option and served in-memory.
 */

import { EditorSelection, EditorState } from "@codemirror/state";
import { expect, test } from "@playwright/test";
import { type GenericAnnotation, annotationField, versionGroupField } from "@quillium/share/core";
import { addAnnotation } from "@quillium/share/core/annotationField";
import { makeVersion } from "@quillium/share/core/models";
import { createVersionGroup } from "@quillium/share/core/versionGroupField";
import {
    type MockDocEvent,
    type MockDraft,
    type MockSnapshot,
    type MockTab,
    QuilliumPage,
} from "./QuilliumPage";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_TIME = Date.now();
const baseDate = new Date(BASE_TIME);
const PREVIOUS_CALENDAR_DAY = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() - 1,
    12,
).getTime();

function makeAnnotatedStateJson(doc = "The quick brown fox"): string {
    let state = EditorState.create({
        doc,
        extensions: [annotationField, versionGroupField],
    });

    const quick = makeVersion({ doc: "quick" });
    const swift = makeVersion({ doc: "swift" });
    const fox = makeVersion({ doc: "fox" });
    const hound = makeVersion({ doc: "hound" });
    const annotations: GenericAnnotation[] = [
        {
            id: 1,
            _type: "revision",
            thread: [],
            selection: EditorSelection.single(4, 9),
            activeVersionId: quick.id,
            versions: [quick, swift],
        },
        {
            id: 2,
            _type: "revision",
            thread: [],
            selection: EditorSelection.single(16, 19),
            activeVersionId: fox.id,
            versions: [fox, hound],
        },
        {
            id: 3,
            _type: "comment",
            thread: [{ author: "Reviewer", message: "Strong opener.", time: 1 }],
            selection: EditorSelection.single(0, 3),
        },
        {
            id: 4,
            _type: "suggestion",
            author: "AI",
            thread: [{ author: "AI", message: "Consider a richer color.", time: 2 }],
            selection: EditorSelection.single(10, 15),
            replacements: [{ text: "russet", rationale: "More specific" }],
        },
    ];

    state = state.update({
        effects: annotations.map((annotation) => addAnnotation.of(annotation)),
    }).state;
    const { spec } = createVersionGroup("Formal voice", [
        { revisionId: 1, versionId: swift.id },
        { revisionId: 2, versionId: hound.id },
    ]);
    state = state.update(spec).state;

    return JSON.stringify(state.toJSON({ annotationField, versionGroupField }));
}

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
            createdAt: PREVIOUS_CALENDAR_DAY,
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

function makeNavigableHistoryFixture(): {
    tabs: MockTab[];
    drafts: MockDraft[];
    snapshots: MockSnapshot[];
} {
    const structure = makeTwoTabStructure();
    structure.tabs[1].label = "Notes";
    structure.drafts = [
        {
            ...structure.drafts[0],
            label: "main",
            locked: true,
        },
        {
            id: "draft-test-2",
            documentId: "doc-test-1",
            label: "second pass",
            createdAt: 1,
            isActive: true,
            tabId: "tab-test-1",
            parentDraftId: "draft-test-1",
            branchedFrom: null,
            locked: false,
            deletedAt: null,
        },
        {
            id: "draft-test-3",
            documentId: "doc-test-1",
            label: "notes",
            createdAt: 2,
            isActive: true,
            tabId: "tab-test-2",
            parentDraftId: null,
            branchedFrom: null,
            locked: false,
            deletedAt: null,
        },
    ];

    return {
        ...structure,
        snapshots: [
            {
                id: 4,
                draftId: "draft-test-1",
                tabId: "tab-test-1",
                draftLabel: "main",
                upToEventId: 40,
                createdAt: BASE_TIME - 1000,
                label: "Latest main",
                doc: "Main revised prose.",
            },
            {
                id: 3,
                draftId: "draft-test-3",
                tabId: "tab-test-2",
                draftLabel: "notes",
                upToEventId: 30,
                createdAt: BASE_TIME - 1500,
                label: null,
                doc: "Historical notes content.",
            },
            {
                id: 2,
                draftId: "draft-test-2",
                tabId: "tab-test-1",
                draftLabel: "second pass",
                upToEventId: -1,
                createdAt: BASE_TIME - 2000,
                label: "Branch point",
                doc: "A standalone second pass.",
            },
            {
                id: 1,
                draftId: "draft-test-1",
                tabId: "tab-test-1",
                draftLabel: "main",
                upToEventId: 10,
                createdAt: BASE_TIME - 3000,
                label: null,
                doc: "Main original prose.",
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
    await expect(page.getByText("Version History", { exact: true })).toBeVisible();
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
    const unselected = page.locator("#versions-panel [aria-selected='false']").first();
    await unselected.click();

    await expect
        .poll(() =>
            page.locator(".version-preview .cm-content").evaluate((el) => el.textContent ?? ""),
        )
        .toContain("Second version");
});

test("history reuses the live tab and draft components in read-only mode", async ({ page }) => {
    const qp = new QuilliumPage(page, makeNavigableHistoryFixture());
    await qp.initHistory();

    const tabShell = page.locator('[data-component="document-tabs"]');
    const draftShell = page.locator('[data-component="draft-tree-panel"]');
    await expect(tabShell).toHaveAttribute("data-read-only", "true");
    await expect(draftShell).toHaveAttribute("data-read-only", "true");
    await expect(tabShell.getByRole("tab", { name: "Main" })).toBeVisible();
    await expect(draftShell.getByRole("button", { name: "main" })).toBeVisible();
    await expect(tabShell.getByRole("tab", { name: "Main" })).toHaveAttribute(
        "aria-describedby",
        "document-tab-timeline-target",
    );
    await expect(draftShell.getByRole("button", { name: "main" })).toHaveAttribute(
        "aria-describedby",
        "draft-timeline-target",
    );
    await expect(draftShell.locator('[data-rail="run-continues"]')).toBeVisible();
    await expect(page.locator(".version-preview")).toHaveCSS("width", "816px");
    await expect(page.locator("#versions-panel").getByText("Branch point")).toHaveCount(0);

    await expect(tabShell.getByRole("button", { name: "New tab" })).toHaveCount(0);
    await expect(tabShell.getByRole("button", { name: "Close tab" })).toHaveCount(0);
    await expect(draftShell.getByRole("button", { name: /^Delete / })).toHaveCount(0);
    await expect(draftShell.getByRole("button", { name: /^Iterate / })).toHaveCount(0);
    await expect(draftShell.getByRole("button", { name: /^Branch from / })).toHaveCount(0);
    await expect(draftShell.getByRole("button", { name: /^(?:Lock|Unlock) / })).toHaveCount(0);

    await tabShell.getByRole("tab", { name: "Main" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabShell.getByRole("tab", { name: "Notes" })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await page.keyboard.press("ArrowLeft");
    await expect(tabShell.getByRole("tab", { name: "Main" })).toHaveAttribute(
        "aria-selected",
        "true",
    );

    await tabShell.getByRole("tab", { name: "Main" }).dblclick();
    await draftShell.getByRole("button", { name: "main" }).dblclick();
    await expect(page.getByRole("textbox", { name: "Rename tab" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Rename draft" })).toHaveCount(0);
});

test("historical tab and draft navigation loads exact content with comparable diffs only", async ({
    page,
}) => {
    const qp = new QuilliumPage(page, makeNavigableHistoryFixture());
    await qp.initHistory();

    const preview = page.locator(".version-preview");
    const tabShell = page.getByRole("tablist", { name: "Document tabs" });
    const draftShell = page.locator('[data-component="draft-tree-panel"]');

    const projectedText = () =>
        preview.locator(".cm-content").evaluate((element) => {
            const projection = element.cloneNode(true) as HTMLElement;
            for (const deletion of projection.querySelectorAll(".cm-history-diff-del")) {
                deletion.remove();
            }
            return projection.textContent ?? "";
        });

    await expect.poll(projectedText).toContain("Main revised prose.");
    await expect(page.getByText("Compared with the previous version")).toBeVisible();
    await expect.poll(() => preview.locator(".cm-history-diff-add").count()).toBeGreaterThan(0);
    await expect.poll(() => preview.locator(".cm-history-diff-del").count()).toBeGreaterThan(0);

    await draftShell.getByRole("button", { name: "second pass" }).click();
    await expect(draftShell.getByRole("button", { name: "second pass" })).toHaveAttribute(
        "aria-current",
        "true",
    );
    await expect(draftShell.locator('[data-draft-id="draft-test-1"]')).toHaveAttribute(
        "data-highlighted",
        "true",
    );
    await expect.poll(projectedText).toContain("A standalone second pass.");
    await expect(page.getByText("Compared with the previous version")).toHaveCount(0);
    await expect(page.getByText("No differences at this point")).toBeVisible();
    await expect(page.getByRole("group", { name: "Diff layout" })).toHaveCount(0);
    await expect(preview.locator(".cm-history-diff-add")).toHaveCount(0);
    await expect(preview.locator(".cm-history-diff-del")).toHaveCount(0);

    await tabShell.getByRole("tab", { name: "Notes" }).click();
    await expect(tabShell.getByRole("tab", { name: "Notes" })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect.poll(projectedText).toContain("Historical notes content.");

    await tabShell.getByRole("tab", { name: "Main" }).click();
    await expect.poll(projectedText).toContain("Main revised prose.");

    const mutationCommands = [
        "cmd_set_active_tab",
        "cmd_set_active_draft",
        "cmd_create_tab",
        "cmd_rename_tab",
        "cmd_reorder_tabs",
        "cmd_delete_tab",
        "cmd_iterate_draft",
        "cmd_branch_draft",
        "cmd_rename_draft",
        "cmd_delete_draft",
        "cmd_set_draft_locked",
    ];
    for (const command of mutationCommands) {
        expect(await qp.countInvocations(command), command).toBe(0);
    }
});

test("history diff switches between inline and side-by-side layouts", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    const layout = page.getByRole("group", { name: "Diff layout" });
    const inline = layout.getByRole("button", { name: "Inline" });
    const sideBySide = layout.getByRole("button", { name: "Side by side" });
    await expect(inline).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-diff-layout="inline"]')).toHaveCount(1);

    const comparisonBar = page.getByText("Compared with the previous version").locator("..");
    const tabStrip = page.locator('[data-component="document-tabs"]');
    await expect
        .poll(async () => {
            const [barBox, tabsBox] = await Promise.all([
                comparisonBar.boundingBox(),
                tabStrip.boundingBox(),
            ]);
            return barBox && tabsBox ? barBox.y + barBox.height <= tabsBox.y + 1 : false;
        })
        .toBe(true);

    await sideBySide.click();
    await expect(sideBySide).toHaveAttribute("aria-pressed", "true");

    const previous = page.locator('[data-diff-pane="previous"]');
    const selected = page.locator('[data-diff-pane="selected"]');
    await expect(previous.getByRole("heading", { name: "Previous version" })).toBeVisible();
    await expect(selected.getByRole("heading", { name: "Selected version" })).toBeVisible();
    await expect(previous.locator(".cm-content")).toHaveText("Second version of the document.");
    await expect(selected.locator(".cm-content")).toHaveText("Third version of the document.");
    await expect(previous.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
    await expect(selected.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
    await expect(previous.locator(".cm-history-diff-del")).not.toHaveCount(0);
    await expect(previous.locator(".cm-history-diff-add")).toHaveCount(0);
    await expect(selected.locator(".cm-history-diff-add")).not.toHaveCount(0);
    await expect(selected.locator(".cm-history-diff-del")).toHaveCount(0);

    // Keep split mode mounted while changing coordinates. Both pane payloads
    // and their decorations must advance together rather than retaining the
    // selected text from the previous EditorView.
    await page.locator("#versions-panel [aria-selected='false']").first().click();
    await expect(previous.locator(".cm-content")).toHaveText("First version of the document.");
    await expect(selected.locator(".cm-content")).toHaveText("Second version of the document.");
    await expect(previous.locator(".cm-history-diff-del")).not.toHaveCount(0);
    await expect(selected.locator(".cm-history-diff-add")).not.toHaveCount(0);

    await inline.click();
    await expect(page.locator('[data-diff-layout="inline"]')).toHaveCount(1);
    await expect(page.locator('[data-diff-pane="previous"]')).toHaveCount(0);
    await expect(page.locator(".version-preview .cm-history-diff-add")).not.toHaveCount(0);
    await expect(page.locator(".version-preview .cm-history-diff-del")).not.toHaveCount(0);
});

test("side-by-side mode explains when no earlier version exists", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    await page.getByRole("button", { name: "Side by side" }).click();
    await page.locator("#versions-panel [role='option']").last().click();

    await expect(page.getByText("No earlier version to compare", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Diff layout" })).toHaveCount(0);
    await expect(page.locator('[data-diff-pane="previous"]')).toHaveCount(0);
    await expect(page.locator('[data-diff-layout="inline"]')).toHaveCount(1);
    await expect(page.locator('[data-diff-pane="selected"] .cm-history-diff-add')).toHaveCount(0);
});

test("side-by-side mode shows annotations for both historical versions", async ({ page }) => {
    const qp = new QuilliumPage(page, {
        snapshots: [
            {
                id: 2,
                draftId: "draft-test-1",
                upToEventId: 20,
                createdAt: BASE_TIME - 1000,
                label: "Selected annotations",
                doc: "The quick brown fox",
                stateJson: makeAnnotatedStateJson(),
            },
            {
                id: 1,
                draftId: "draft-test-1",
                upToEventId: 10,
                createdAt: BASE_TIME - 2000,
                label: "Previous annotations",
                doc: "The slow brown fox",
                stateJson: makeAnnotatedStateJson("The slow brown fox"),
            },
        ],
    });
    await qp.initHistory();
    await page.getByRole("button", { name: "Side by side" }).click();

    const previousAnnotations = page.getByRole("complementary", {
        name: "Previous version annotations",
    });
    const selectedAnnotations = page.getByRole("complementary", {
        name: "Selected version annotations",
    });
    await expect(
        previousAnnotations.getByRole("heading", { name: "Previous annotations" }),
    ).toBeVisible();
    await expect(
        selectedAnnotations.getByRole("heading", { name: "Selected annotations" }),
    ).toBeVisible();
    await expect(previousAnnotations.locator("[data-annotation-card]")).toHaveCount(4);
    await expect(selectedAnnotations.locator("[data-annotation-card]")).toHaveCount(4);
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

test("history preview renders linked annotations read-only and explores grouped versions", async ({
    page,
}) => {
    const stateJson = makeAnnotatedStateJson();
    const qp = new QuilliumPage(page, {
        snapshots: [
            {
                id: 2,
                draftId: "draft-test-1",
                upToEventId: 20,
                createdAt: BASE_TIME - 1000,
                label: "Annotated draft",
                doc: "The quick brown fox",
                stateJson,
            },
            {
                id: 1,
                draftId: "draft-test-1",
                upToEventId: 10,
                createdAt: BASE_TIME - 2000,
                label: null,
                doc: "The quick brown fox",
            },
        ],
    });
    await qp.initHistory();

    const preview = page.locator(".version-preview");
    await expect(preview.locator(".cm-content")).toHaveAttribute("contenteditable", "false");

    const cards = page.getByRole("complementary", { name: "Snapshot annotations" });
    await expect(cards.locator("[data-annotation-card]")).toHaveCount(4);
    await expect(cards.getByRole("heading", { name: "Revision" })).toHaveCount(2);
    await expect(cards.getByRole("heading", { name: "Comment" })).toHaveCount(1);
    await expect(cards.getByRole("heading", { name: "AI Suggestion" })).toHaveCount(1);
    await expect(cards.getByText("Strong opener.")).toBeVisible();

    const linked = cards.locator("[title='Linked — group \"Formal voice\" (2 versions)']");
    await expect(linked).toHaveCount(2);
    const groupColors = await linked.evaluateAll((elements) =>
        elements.map((element) => {
            const dot = element.querySelector("span");
            return dot ? getComputedStyle(dot).backgroundColor : "";
        }),
    );
    expect(groupColors[0]).not.toBe("");
    expect(new Set(groupColors).size).toBe(1);

    await expect(cards.getByRole("button", { name: "Link version" })).toHaveCount(0);
    await expect(cards.getByRole("button", { name: "Delete comment" })).toHaveCount(0);
    await expect(cards.getByRole("button", { name: "Delete suggestion" })).toHaveCount(0);
    await expect(cards.getByTitle("Delete entire revision")).toHaveCount(0);
    await expect(cards.locator('[title^="Delete version"]')).toHaveCount(0);
    await expect(cards.getByText("New Version", { exact: true })).toHaveCount(0);
    await expect(cards.getByRole("button", { name: "Branch instead" })).toHaveCount(0);
    await expect(cards.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
    await expect(cards.getByRole("textbox")).toHaveCount(0);

    const suggestionCard = cards.locator('[data-annotation-id="4"]');
    await suggestionCard.getByRole("button", { name: /russet/ }).click();
    await suggestionCard.getByRole("button", { name: "View changes" }).click();
    await expect(suggestionCard.locator('[data-suggestion-diff="delete"]')).toHaveText("brown");
    await expect(suggestionCard.locator('[data-suggestion-diff="insert"]')).toHaveText("russet");

    await expect(page.getByText("Compared with the previous version")).toHaveCount(0);
    await expect(page.getByText("No differences at this point")).toBeVisible();
    await expect(page.getByRole("group", { name: "Diff layout" })).toHaveCount(0);
    await expect(preview.locator(".cm-history-diff-add")).toHaveCount(0);
    await expect(preview.locator(".cm-history-diff-del")).toHaveCount(0);

    await cards.getByRole("button", { name: /^swift, linked in / }).click();
    await expect
        .poll(() =>
            preview.locator(".cm-content").evaluate((element) => {
                const projection = element.cloneNode(true) as HTMLElement;
                for (const deletion of projection.querySelectorAll(".cm-history-diff-del")) {
                    deletion.remove();
                }
                return projection.textContent;
            }),
        )
        .toBe("The swift brown hound");
    await expect(cards.getByRole("button", { name: /^swift, linked in / })).toBeDisabled();
    await expect(cards.getByRole("button", { name: /^hound, linked in / })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Annotations" })).toBeVisible();
    await expect(page.getByText("4 annotations in this version")).toBeVisible();
    await expect(page.getByText("Selected pane")).toHaveCount(0);
    await expect(page.getByText("Revision alternatives preview")).toHaveCount(0);
    await expect(page.getByText("No differences at this point")).toBeVisible();
    await expect(page.getByRole("group", { name: "Diff layout" })).toHaveCount(0);
    await expect(preview.locator(".cm-history-diff-add")).toHaveCount(0);
    await expect(preview.locator(".cm-history-diff-del")).toHaveCount(0);

    // Clicking annotated prose updates the card focus from the actual editor
    // selection, just as it does in the writable editor.
    await preview.locator(".cm-suggestion").first().click();
    await expect(cards.locator('[data-annotation-id="4"]')).toHaveAttribute("data-active", "true");
    await expect(cards.locator('[data-annotation-id="3"]')).toHaveAttribute("data-active", "false");

    // Reverting both independent originals removes the live diff and legend;
    // the overlay cannot remain frozen at the initially-mounted projection.
    await cards.getByRole("button", { name: "quick", exact: true }).click();
    await cards.getByRole("button", { name: "fox", exact: true }).click();
    await expect(preview.locator(".cm-content")).toHaveText("The quick brown fox");
    await expect(preview.locator(".cm-history-diff-add")).toHaveCount(0);
    await expect(preview.locator(".cm-history-diff-del")).toHaveCount(0);
    await expect(page.getByText("Compared with the previous version")).toHaveCount(0);
});

test("history annotation layout responds to the remaining preview pane width", async ({ page }) => {
    const stateJson = makeAnnotatedStateJson();
    const qp = new QuilliumPage(page, {
        snapshots: [
            {
                id: 1,
                draftId: "draft-test-1",
                upToEventId: 10,
                createdAt: BASE_TIME - 1000,
                label: "Annotated draft",
                doc: "The quick brown fox",
                stateJson,
            },
        ],
    });

    await page.setViewportSize({ width: 2000, height: 1000 });
    await qp.initHistory();
    const stage = page.locator(".history-preview-stage");
    await expect(stage).toHaveCSS("flex-direction", "row");

    // The viewport is still desktop-sized, but the structure and timeline
    // sidebars leave too little width for an editor plus card column.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(stage).toHaveCSS("flex-direction", "column");
});

test("most recent snapshot is selected by default", async ({ page }) => {
    const qp = new QuilliumPage(page, { snapshots: makeSnapshots() });
    await qp.initHistory();

    // The most recent snapshot is ID 3, labelled "Before refactor"
    // Its entry should be marked selected (blue border class applied)
    const selected = page.locator("#versions-panel [aria-selected='true']");
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

    await expect(
        page.getByRole("tablist", { name: "Document tabs" }).getByRole("tab", { name: "Tab 2" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect
        .poll(() =>
            page.locator(".version-preview .cm-content").evaluate((el) => el.textContent ?? ""),
        )
        .toContain("Second tab text");
});

test("deleted tab history shows its last state without leaking into later entries", async ({
    page,
}) => {
    const structure = makeTwoTabStructure();
    const qp = new QuilliumPage(page, {
        ...structure,
        snapshots: [
            {
                id: 3,
                draftId: "draft-test-1",
                tabId: "tab-test-1",
                draftLabel: "main",
                upToEventId: 30,
                createdAt: BASE_TIME - 1000,
                label: "After deletion",
                doc: "Main tab after deletion.",
            },
            {
                id: 2,
                draftId: "draft-test-2",
                tabId: "tab-test-2",
                draftLabel: "take 2",
                upToEventId: 20,
                createdAt: BASE_TIME - 3000,
                label: "Before deletion",
                doc: "Deleted tab's last text.",
            },
        ],
        docEvents: [
            {
                id: 1,
                documentId: "doc-test-1",
                eventType: "tab_deleted",
                payload: JSON.stringify({ tabId: "tab-test-2", label: "Tab 2" }),
                createdAt: BASE_TIME - 2000,
            },
        ],
    });
    await qp.initHistory();

    const tabs = page.getByRole("tablist", { name: "Document tabs" });
    await expect(tabs.getByRole("tab", { name: "Main" })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: "Tab 2" })).toHaveCount(0);

    await page.getByText("Deleted tab “Tab 2”").click();

    await expect(tabs.getByRole("tab", { name: "Tab 2" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Deleted tab · historical state")).toBeVisible();
    await expect(page.getByText("showing its last available state")).toBeVisible();
    await expect
        .poll(() =>
            page.locator(".version-preview .cm-content").evaluate((el) => el.textContent ?? ""),
        )
        .toContain("Deleted tab's last text.");
    await expect(page.getByRole("button", { name: "New tab" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close tab" })).toHaveCount(0);

    await page.getByText("Before deletion").click();
    await expect(page.getByText("Deleted tab · historical state")).toHaveCount(0);
    await expect(tabs.getByRole("tab", { name: "Tab 2" })).toHaveAttribute("aria-selected", "true");
    expect(await qp.countInvocations("cmd_set_active_tab")).toBe(0);
    expect(await qp.countInvocations("cmd_set_active_draft")).toBe(0);
    expect(await qp.countInvocations("cmd_restore_to_coordinate")).toBe(0);
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
    const entry = page.locator("#versions-panel [aria-selected='true']");
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
