/** publicSharePayload.test.ts. Checks parsed RPC data with the share renderer. */
import { ReadonlyShareView, type SerializedAnnotation } from "@quillium/share";
import { serializeFromState } from "@quillium/share/core";
import { render, waitFor } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { parsePublicShare } from "../../landing/src/lib/server/publicSharePayload";
import { buildFixtureState, serializeFixtureWire } from "./fixtures";

const token = "d5a823ef-1f5a-4b16-8d87-f4c676f5ad3a";
const comment: SerializedAnnotation = {
    id: "comment",
    type: "comment",
    from: 0,
    to: 5,
    selectedText: "Hello",
    thread: [{ author: "Writer", message: "A note", time: 1 }],
};
const legacyRow = {
    published_title: "A public draft",
    preview_text: "Hello world",
    published_content: "Hello world",
    published_annotations: [comment],
    published_state: null,
    author_name: null,
    published_at: null,
};
const envelope = {
    kind: "quillium-readonly-share",
    version: 2,
    activeTabId: "tab-1",
    tabs: [{ id: "tab-1", label: "Draft", draftId: "draft-1", state: { doc: "Hello world" } }],
};

describe("public share RPC parsing", () => {
    it.each([
        null,
        {},
        { ...legacyRow, published_title: 5 },
        { ...legacyRow, preview_text: null },
        { ...legacyRow, published_content: [] },
        { ...legacyRow, author_name: {} },
        { ...legacyRow, published_at: "not a date" },
        { ...legacyRow, published_at: "2026-99-99" },
        { ...legacyRow, published_annotations: [null] },
        { ...legacyRow, published_annotations: [{ ...comment, type: "unknown" }] },
        { ...legacyRow, published_annotations: [{ ...comment, thread: [null] }] },
        {
            ...legacyRow,
            published_annotations: [{ ...comment, type: "suggestion", replacements: [null] }],
        },
        { ...legacyRow, published_state: { ...envelope, tabs: [null] } },
        {
            ...legacyRow,
            published_state: { ...envelope, tabs: [null], doc: "Not a legacy escape" },
        },
        { ...legacyRow, published_state: { ...envelope, version: 3, doc: "Not a legacy escape" } },
        { ...legacyRow, published_state: { ...envelope, scope: "unrecognized" } },
        { ...legacyRow, published_state: { doc: 3 } },
        { ...legacyRow, published_state: { doc: "Hello", annotationField: { 0: null } } },
        { ...legacyRow, published_state: { doc: "Hello", versionGroupField: { group: null } } },
    ])("returns unavailable for malformed public data %j", (row) => {
        expect(parsePublicShare(row, token)).toBeNull();
    });

    it("validates every nested flat annotation", () => {
        const revision = {
            ...comment,
            type: "revision",
            activeVersionIndex: 0,
            versions: [{ index: 0, text: "Hello", annotations: [comment] }],
        };
        const nested = {
            ...revision,
            versions: [{ index: 0, text: "Hello", annotations: [revision] }],
        };
        expect(
            parsePublicShare({ ...legacyRow, published_annotations: [nested] }, token),
        ).not.toBeNull();
        const invalidRevision = {
            ...revision,
            versions: [{ index: 0, text: "Hello", annotations: [{ ...comment, thread: [null] }] }],
        };
        const invalidNested = {
            ...nested,
            versions: [{ index: 0, text: "Hello", annotations: [invalidRevision] }],
        };
        expect(
            parsePublicShare({ ...legacyRow, published_annotations: [invalidNested] }, token),
        ).toBeNull();
    });

    it.each([{ annotationField: { 0: null } }, { versionGroupField: { group: null } }])(
        "rejects malformed recognized fields inside revision versions %j",
        (fields) => {
            const revision = {
                id: 0,
                _type: "revision",
                thread: [],
                selection: { ranges: [{ anchor: 0, head: 5 }] },
                activeVersionIndex: 0,
                versions: [{ doc: "Hello", ...fields }],
            };
            const state = {
                doc: "Hello",
                annotationField: {
                    0: {
                        ...revision,
                        versions: [{ doc: "Hello", annotationField: { 0: revision } }],
                    },
                },
            };
            expect(parsePublicShare({ ...legacyRow, published_state: state }, token)).toBeNull();
        },
    );

    it("preserves optional published revision metadata", () => {
        const aiProvenance = {
            requestId: "request-1",
            task: "local-rewrite",
            provider: "provider",
            model: "model",
            createdAt: 1,
        };
        const revision = {
            ...comment,
            type: "revision",
            aiProvenance,
            activeVersionIndex: 0,
            versions: [
                {
                    index: 0,
                    versionId: "version-1",
                    text: "Hello",
                    label: "Original",
                    provenance: "mixed",
                    aiProvenance,
                    group: { id: "group-1", label: "Voice", memberCount: 2, color: "#123456" },
                    annotations: [comment],
                },
            ],
        };
        expect(
            parsePublicShare({ ...legacyRow, published_annotations: [revision] }, token)
                ?.annotations,
        ).toEqual([revision]);
    });

    it("keeps null annotations and blank title compatibility", () => {
        expect(
            parsePublicShare(
                { ...legacyRow, published_title: "", published_annotations: null },
                token,
            ),
        ).toMatchObject({
            title: "Untitled",
            annotations: [],
            state: null,
        });
    });

    it.each([undefined, "current-tab", "all-tabs"])(
        "renders producer-generated v2 data with scope %s",
        async (scope) => {
            const { state } = buildFixtureState();
            const flat = serializeFromState(state);
            const wire = serializeFixtureWire(state);
            const share = parsePublicShare(
                {
                    ...legacyRow,
                    published_content: flat.content,
                    published_annotations: flat.annotations,
                    published_at: "2026-07-09T12:00:00.000Z",
                    published_state: {
                        ...envelope,
                        scope,
                        tabs: [
                            {
                                ...envelope.tabs[0],
                                state: { ...wire, futureExtension: { preserved: true } },
                            },
                        ],
                    },
                },
                token,
            );
            expect(share).not.toBeNull();
            if (!share) throw new Error("Expected a valid producer payload");
            expect(share.state).toMatchObject({
                tabs: [{ state: { futureExtension: { preserved: true } } }],
            });
            const { container } = render(ReadonlyShareView, { props: { share } });
            await waitFor(() => {
                expect(container.querySelector(".cm-content")?.textContent).toContain(
                    "The quick brown fox",
                );
                expect(container.querySelectorAll("[data-annotation-card-view]")).toHaveLength(4);
            });
            expect(container.querySelector(".mount-error")).toBeNull();
        },
    );

    it("renders validated pre-envelope serialized editor states", async () => {
        const { state } = buildFixtureState();
        const share = parsePublicShare(
            { ...legacyRow, published_state: serializeFixtureWire(state) },
            token,
        );
        if (!share) throw new Error("Expected a valid pre-envelope payload");
        const { container } = render(ReadonlyShareView, { props: { share } });
        await waitFor(() =>
            expect(container.querySelector(".cm-content")?.textContent).toContain(
                "The quick brown fox",
            ),
        );
    });

    it.each([null, { ...envelope, activeTabId: null, tabs: [] }])(
        "renders validated flat content for legacy or empty envelopes %j",
        async (publishedState) => {
            const share = parsePublicShare(
                { ...legacyRow, published_state: publishedState },
                token,
            );
            if (!share) throw new Error("Expected a valid flat payload");
            const { container, getByText } = render(ReadonlyShareView, { props: { share } });
            expect(
                container.querySelector('[data-readonly-renderer="legacy-static"]'),
            ).not.toBeNull();
            expect(container.querySelector(".cm-editor")).toBeNull();
            expect(getByText("A note")).toBeTruthy();
        },
    );
});
