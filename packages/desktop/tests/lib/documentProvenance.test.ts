import {
    createDocument,
    duplicateDocument,
    getDocumentMeta,
    listDocuments,
    listTrashedDocuments,
    searchDocuments,
} from "$lib/db";
import type { DocumentMeta, DuplicateDraftState, SearchHit } from "$lib/db/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";

function metadata(id: string, createdWithVersion: string | null): DocumentMeta {
    return {
        id,
        title: id,
        createdAt: 1,
        updatedAt: 2,
        wordCount: 3,
        previewText: "Preview",
        tags: "[]",
        deletedAt: null,
        persistHistory: false,
        createdWithVersion,
    };
}

describe("document creator provenance", () => {
    it("keeps document creation arguments limited to backend-owned metadata", async () => {
        const calls: Array<{ command: string; args: unknown }> = [];
        mockIPC((command, args) => {
            calls.push({ command, args });
            return "new-document";
        });

        await createDocument("Draft", true);

        expect(calls).toEqual([
            {
                command: "cmd_create_document",
                args: { title: "Draft", persistHistory: true },
            },
        ]);
    });

    it("round-trips exact and unknown creator versions through document and search metadata", async () => {
        const known = metadata("known", "0.24.4-dev.7+sha.abc123");
        const unknown = metadata("unknown", null);
        const live = [known, unknown];
        const searchHit: SearchHit = {
            ...known,
            snippet: "Preview",
            matchType: "keyword",
            score: 1,
        };
        const unknownSearchHit: SearchHit = {
            ...unknown,
            snippet: "Preview",
            matchType: "keyword",
            score: 0.5,
        };
        mockIPC((command, args) => {
            if (command === "cmd_list_documents") return live;
            if (command === "cmd_get_document") {
                return live.find((document) => document.id === (args as { id: string }).id) ?? null;
            }
            if (command === "cmd_list_trashed_documents") return [known];
            if (command === "cmd_search_documents") return [searchHit, unknownSearchHit];
            return null;
        });

        expect((await listDocuments()).map((document) => document.createdWithVersion)).toEqual([
            "0.24.4-dev.7+sha.abc123",
            null,
        ]);
        expect((await getDocumentMeta("known"))?.createdWithVersion).toBe(
            "0.24.4-dev.7+sha.abc123",
        );
        expect((await getDocumentMeta("unknown"))?.createdWithVersion).toBeNull();
        expect((await listTrashedDocuments())[0].createdWithVersion).toBe(
            "0.24.4-dev.7+sha.abc123",
        );
        expect((await searchDocuments("Preview")).map((hit) => hit.createdWithVersion)).toEqual([
            "0.24.4-dev.7+sha.abc123",
            null,
        ]);
    });

    it("does not restamp a duplicate in the frontend command payload", async () => {
        const draftStates: DuplicateDraftState[] = [
            { sourceDraftId: "draft", sourceEventId: 4, stateJson: '{"doc":"text"}' },
        ];
        let call: { command: string; args: unknown } | undefined;
        mockIPC((command, args) => {
            call = { command, args };
            return "copy";
        });

        await duplicateDocument("source", draftStates);

        expect(call).toEqual({
            command: "cmd_duplicate_document",
            args: { sourceDocumentId: "source", draftStates },
        });
    });

    it("preserves known and unknown creator versions in document metadata JSON", () => {
        for (const createdWithVersion of ["0.24.4-rc.1", null]) {
            const decoded = JSON.parse(
                JSON.stringify(metadata("wire", createdWithVersion)),
            ) as DocumentMeta;
            expect(decoded.createdWithVersion).toBe(createdWithVersion);
        }
    });
});
