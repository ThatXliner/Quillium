import { webcrypto } from "node:crypto";
import { captureContextRetrieval } from "$lib/ai/contextRetrieval";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import type {
    Annotations,
    GenericAnnotation,
    VersionState,
} from "$lib/editor/plugins/annotations/models";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const views: EditorView[] = [];

beforeEach(() => vi.stubGlobal("crypto", webcrypto));

afterEach(() => {
    vi.unstubAllGlobals();
    for (const view of views.splice(0)) view.destroy();
});

function comment(
    id: number,
    message: string,
    documentLength: number,
    time = id,
): GenericAnnotation {
    return {
        id,
        _type: "comment",
        status: "active",
        selection: EditorSelection.single(0, documentLength),
        thread: [{ author: "Writer", message, time }],
    };
}

function rawAnnotations(annotations: Annotations): Record<string, unknown> {
    return Object.fromEntries(
        Object.values(annotations).map((annotation) => [
            annotation.id,
            { ...annotation, selection: annotation.selection.toJSON() },
        ]),
    );
}

function version(
    id: string,
    doc: string,
    annotations?: Annotations,
    extra: Record<string, unknown> = {},
): VersionState {
    return {
        id,
        doc,
        ...(annotations ? { annotationField: rawAnnotations(annotations) } : {}),
        ...extra,
    } as VersionState;
}

function revision(
    id: number,
    versions: VersionState[],
    activeVersionId = versions[0]?.id ?? "",
    documentLength = 1,
): GenericAnnotation {
    return {
        id,
        _type: "revision",
        status: "active",
        selection: EditorSelection.single(0, documentLength),
        thread: [],
        activeVersionId,
        versions,
    };
}

function createView(documentContent: string, annotations: Annotations): EditorView {
    const view = new EditorView({
        state: EditorState.fromJSON(
            {
                doc: documentContent,
                selection: EditorSelection.single(0).toJSON(),
                annotationField: rawAnnotations(annotations),
            },
            { extensions: [annotationField] },
            { annotationField },
        ),
        parent: document.body,
    });
    views.push(view);
    return view;
}

function readAllThread(
    snapshot: ReturnType<typeof captureContextRetrieval>,
    threadReference: string,
): string {
    let offset = 0;
    let content = "";
    for (let page = 0; page < 10; page++) {
        const result = snapshot.readAnnotationThread({ threadReference, offset });
        expect(result.available).toBe(true);
        if (!result.available) break;
        expect(result.content.length).toBeLessThanOrEqual(12_000);
        content += result.content;
        if (result.nextOffset === null) return content;
        offset = result.nextOffset;
    }
    throw new Error("thread pagination did not terminate");
}

describe("captureContextRetrieval", () => {
    it("searches and pages a complete long thread, including messages omitted automatically", () => {
        const documentContent = "A draft with a complete editorial discussion.";
        const longReply = "Long qualification ".repeat(900);
        const annotations: Annotations = {
            1: {
                id: 1,
                _type: "comment",
                status: "active",
                selection: EditorSelection.single(0, documentContent.length),
                thread: [
                    { author: "AI", message: "The claim needs support.", time: 1 },
                    { author: "Writer", message: longReply, time: 2 },
                    {
                        author: "AI",
                        message: "I withdraw the concern after the citation.",
                        time: 3,
                    },
                    {
                        author: "Writer",
                        message: "The citation is now part of the draft.",
                        time: 4,
                    },
                ],
            },
        };
        const rootView = createView(documentContent, annotations);
        const snapshot = captureContextRetrieval({
            rootView,
            documentId: "doc-1",
            tabId: "tab-1",
            draftId: "draft-1",
        });

        const listed = snapshot.listAnnotationThreads({ query: "withdraw" });
        expect(listed.threads).toHaveLength(1);
        expect(listed.threads[0]).toMatchObject({ id: 1, messageCount: 4 });
        const reference = listed.threads[0]?.threadReference;
        expect(reference).toBeTruthy();

        const content = readAllThread(snapshot, reference ?? "");
        expect(content).toContain(longReply);
        expect(content).toContain("I withdraw the concern after the citation.");
        const firstPage = snapshot.readAnnotationThread({ threadReference: reference ?? "" });
        expect(firstPage.available).toBe(true);
        if (!firstPage.available) throw new Error("Thread unavailable");
        expect(firstPage.totalChars).toBeGreaterThan(12_000);
        expect(firstPage.nextOffset).not.toBeNull();
    });

    it("pages searches and reports malformed nested scopes explicitly", () => {
        const documentContent = "Pagination fixture.";
        const annotations: Annotations = Object.fromEntries(
            Array.from({ length: 23 }, (_, index) => [
                index + 1,
                comment(index + 1, `pagination-${index + 1}`, documentContent.length, 100 + index),
            ]),
        );
        annotations[100] = revision(
            100,
            [
                version("broken", "Broken branch", undefined, {
                    annotationField: { bad: { invalid: true } },
                }),
            ],
            "broken",
            documentContent.length,
        );
        const snapshot = captureContextRetrieval({
            rootView: createView(documentContent, annotations),
            documentId: "doc-2",
            tabId: "tab-2",
            draftId: "draft-2",
        });

        const first = snapshot.listAnnotationThreads();
        expect(first.threads).toHaveLength(20);
        expect(first.total).toBe(24);
        expect(first.nextOffset).toBe(20);
        expect(first.unavailableScopeCount).toBe(1);
        expect(first.unavailableScopes[0]).toMatchObject({
            reason: "malformed-nested-state",
            branchPath: [{ revisionId: 100, versionId: "broken" }],
        });

        const second = snapshot.listAnnotationThreads({ offset: first.nextOffset ?? 0 });
        expect(second.threads).toHaveLength(4);
        expect(second.nextOffset).toBeNull();
        const search = snapshot.listAnnotationThreads({ query: "PAGINATION-22" });
        expect(search.threads).toHaveLength(1);
        expect(search.threads[0]?.latestMessageExcerpt).toContain("pagination-22");
    });

    it("isolates duplicate annotation IDs by root and revision path and rejects altered references", () => {
        const documentContent = "Root version text.";
        const rootComment = comment(9, "same-id root discussion", documentContent.length);
        const versionA = version("version-a", "Alternative A", {
            9: comment(9, "same-id version A discussion", "Alternative A".length),
        });
        const versionB = version("version-b", "Alternative B", {
            9: comment(9, "same-id version B discussion", "Alternative B".length),
        });
        const rootView = createView(documentContent, {
            9: rootComment,
            7: revision(7, [versionA, versionB], "version-a", documentContent.length),
        });
        const snapshot = captureContextRetrieval({
            rootView,
            documentId: "doc-3",
            tabId: "tab-3",
            draftId: "draft-3",
        });

        const listed = snapshot.listAnnotationThreads({ query: "same-id" });
        expect(listed.threads).toHaveLength(3);
        const byPath = new Map(
            listed.threads.map((thread) => [JSON.stringify(thread.branchPath), thread]),
        );
        expect(byPath.get("[]")).toMatchObject({ inCurrentDraft: true, active: true });
        expect(
            byPath.get(JSON.stringify([{ revisionId: 7, versionId: "version-a" }])),
        ).toMatchObject({
            inCurrentDraft: true,
            active: false,
        });
        expect(
            byPath.get(JSON.stringify([{ revisionId: 7, versionId: "version-b" }])),
        ).toMatchObject({
            inCurrentDraft: false,
            active: false,
        });

        for (const thread of listed.threads) {
            const result = snapshot.readAnnotationThread({
                threadReference: thread.threadReference,
            });
            expect(result).toMatchObject({ available: true, id: 9 });
            if (!result.available) throw new Error("Thread unavailable");
            expect(result.content).toContain(
                thread.branchPath.length === 0
                    ? "same-id root discussion"
                    : thread.branchPath[0]?.versionId === "version-a"
                      ? "same-id version A discussion"
                      : "same-id version B discussion",
            );
        }

        const reference = listed.threads[0]?.threadReference ?? "";
        const parsed = JSON.parse(reference) as Record<string, unknown>;
        expect(
            snapshot.readAnnotationThread({
                threadReference: JSON.stringify({ ...parsed, snapshotId: "other-snapshot" }),
            }),
        ).toMatchObject({ available: false, reason: "unknown-snapshot" });
        expect(
            snapshot.readAnnotationThread({
                threadReference: JSON.stringify({
                    ...parsed,
                    branchPath: [{ revisionId: 7, versionId: "missing" }],
                }),
            }),
        ).toMatchObject({ available: false, reason: "unknown-scope" });
        expect(
            snapshot.readAnnotationThread({
                threadReference: JSON.stringify({ ...parsed, draftId: "other-draft" }),
            }),
        ).toMatchObject({ available: false, reason: "unknown-thread" });
    });

    it("keeps a send snapshot immutable and refreshes on the next capture", () => {
        let current = true;
        const rootView = createView("Before the edit.", {
            1: comment(1, "before discussion", "Before the edit.".length),
        });
        const snapshot = captureContextRetrieval({
            rootView,
            documentId: "doc-4",
            tabId: "tab-4",
            draftId: "draft-4",
            isCurrent: () => current,
        });
        rootView.dispatch({
            changes: { from: 0, to: rootView.state.doc.length, insert: "After the edit." },
        });
        const refreshed = captureContextRetrieval({
            rootView,
            documentId: "doc-4",
            tabId: "tab-4",
            draftId: "draft-4",
            isCurrent: () => current,
        });

        const before = snapshot.readDraftContext();
        const after = refreshed.readDraftContext();
        expect(before.available).toBe(true);
        expect(after.available).toBe(true);
        if (!before.available || !after.available) throw new Error("Draft unavailable");
        expect(before.content).toContain("Before the edit.");
        expect(before.content).not.toContain("After the edit.");
        expect(after.content).toContain("After the edit.");
        current = false;
        expect(snapshot.listAnnotationThreads()).toMatchObject({
            available: false,
            reason: "context-switched",
        });
        expect(snapshot.readDraftContext()).toMatchObject({
            available: false,
            reason: "context-switched",
        });
    });
});

it("fingerprints full nested content and discussions without request identity noise", async () => {
    const capture = (reply: string, nestedText: string, draftId = "draft") =>
        captureContextRetrieval({
            rootView: createView("Root text", {
                1: revision(
                    1,
                    [version("v1", nestedText, { 9: comment(9, reply, nestedText.length) })],
                    "v1",
                    9,
                ),
            }),
            documentId: "doc",
            tabId: "tab",
            draftId,
        });
    const original = capture("Discuss this", "Nested text");
    const unchanged = capture("Discuss this", "Nested text");
    expect(original.snapshotId).not.toBe(unchanged.snapshotId);
    expect(await original.contentFingerprint()).toBe(await unchanged.contentFingerprint());
    expect(await original.contentFingerprint()).not.toBe(
        await capture("Concern withdrawn", "Nested text").contentFingerprint(),
    );
    expect(await original.contentFingerprint()).not.toBe(
        await capture("Discuss this", "Edited alternative").contentFingerprint(),
    );
    expect(await original.contentFingerprint()).not.toBe(
        await capture("Discuss this", "Nested text", "other-draft").contentFingerprint(),
    );
});
