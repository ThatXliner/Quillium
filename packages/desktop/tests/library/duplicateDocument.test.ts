import { remapDocumentStateIdentities } from "$lib/library/duplicateDocument";
import { describe, expect, it } from "vitest";

function revision(id: number, versionId: string, nested?: Record<string, unknown>) {
    return {
        id,
        _historyId: `old-history-${id}`,
        _type: "revision",
        thread: [],
        selection: { ranges: [{ anchor: 0, head: 1 }], main: 0 },
        activeVersionId: versionId,
        versions: [{ id: versionId, doc: "text", ...nested }],
    };
}

describe("document duplicate identity remapping", () => {
    it("remaps nested annotations, revision versions, and linked groups", () => {
        const source = {
            doc: "outer",
            annotationField: {
                1: revision(1, "old-v-a", {
                    annotationField: {
                        2: revision(2, "old-v-nested"),
                    },
                }),
                4: revision(4, "old-v-b"),
            },
            versionGroupField: {
                "old-group": {
                    id: "old-group",
                    label: "Linked",
                    members: [
                        { revisionId: 1, versionId: "old-v-a" },
                        { revisionId: 4, versionId: "old-v-b" },
                    ],
                },
            },
        };

        const [copy] = remapDocumentStateIdentities([source]);
        const annotations = copy.annotationField as Record<
            string,
            Record<string, unknown>
        >;
        const copiedRevisions = Object.values(annotations);
        const first = copiedRevisions.find((annotation) => {
            const versions = annotation.versions as Array<Record<string, unknown>>;
            return versions[0].doc === "text" && "annotationField" in versions[0];
        })!;
        const second = copiedRevisions.find((annotation) => annotation !== first)!;
        const firstVersion = (first.versions as Array<Record<string, unknown>>)[0];
        const nestedAnnotations = firstVersion.annotationField as Record<
            string,
            Record<string, unknown>
        >;
        const nested = Object.values(nestedAnnotations)[0];
        const nestedVersion = (nested.versions as Array<Record<string, unknown>>)[0];

        expect(first.id).not.toBe(1);
        expect(second.id).not.toBe(4);
        expect(nested.id).not.toBe(2);
        expect(new Set([first.id, second.id, nested.id]).size).toBe(3);
        expect(first._historyId).not.toBe("old-history-1");
        expect(firstVersion.id).not.toBe("old-v-a");
        expect(first.activeVersionId).toBe(firstVersion.id);
        expect(nestedVersion.id).not.toBe("old-v-nested");
        expect(nested.activeVersionId).toBe(nestedVersion.id);

        const groups = copy.versionGroupField as Record<string, Record<string, unknown>>;
        const [groupKey, group] = Object.entries(groups)[0];
        const members = group.members as Array<{ revisionId: number; versionId: string }>;
        expect(groupKey).not.toBe("old-group");
        expect(group.id).toBe(groupKey);
        expect(members).toEqual(
            expect.arrayContaining([
                { revisionId: first.id, versionId: firstVersion.id },
                {
                    revisionId: second.id,
                    versionId: (second.versions as Array<Record<string, unknown>>)[0].id,
                },
            ]),
        );
    });

    it("uses fresh annotation ids across every copied draft", () => {
        const states = [
            { doc: "a", annotationField: { 1: revision(1, "v-a") } },
            { doc: "b", annotationField: { 1: revision(1, "v-b") } },
        ];

        const copies = remapDocumentStateIdentities(states);
        const ids = copies.map((copy) =>
            Number(Object.keys(copy.annotationField as Record<string, unknown>)[0]),
        );

        expect(ids[0]).not.toBe(1);
        expect(ids[1]).not.toBe(1);
        expect(ids[0]).not.toBe(ids[1]);
    });
});
