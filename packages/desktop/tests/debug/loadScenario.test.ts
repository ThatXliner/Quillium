import { loadScenario } from "$lib/debug/loadScenario";
import type { Scenario } from "$lib/debug/scenarios";
import { savedFields } from "$lib/editor/extensions";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation } from "$lib/editor/plugins/annotations/models";
import { currentDocumentId, currentDocumentTitle, currentDraftId } from "$lib/stores";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { mockIPC } from "@tauri-apps/api/mocks";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scenario: Scenario = {
    id: "test-scenario",
    label: "A scenario",
    description: "Tests the shared DEV save/load path",
    category: "debug",
    group: "Comments",
    doc: "Hello",
    setup(view) {
        view.dispatch({ changes: { from: 5, insert: " world" } });
        view.dispatch({
            effects: addAnnotation.of(
                createNewAnnotation(
                    view.state.field(annotationField),
                    EditorSelection.single(0, 5),
                    "comment",
                ),
            ),
        });
    },
};

beforeEach(() => {
    currentDocumentId.set("old-doc");
    currentDocumentTitle.set("Old title");
    currentDraftId.set("old-draft");
});

afterEach(() => {
    vi.restoreAllMocks();
    currentDocumentId.set(null);
    currentDraftId.set(null);
});

describe("shared DEV scenario loader", () => {
    it("records events in order and publishes identity only after snapshot and metadata", async () => {
        const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
        let eventId = 0;
        mockIPC((cmd, args) => {
            calls.push({ cmd, args: args as Record<string, unknown> });
            expect(get(currentDocumentId)).toBe("old-doc");
            if (cmd === "cmd_create_document") return "scenario-doc";
            if (cmd === "cmd_create_draft") return "scenario-draft";
            if (cmd === "cmd_append_event") return { eventId: ++eventId, needsSnapshot: false };
            return null;
        });
        let expectedState: unknown;
        const reload = vi.fn(() => {
            expect(get(currentDocumentId)).toBe("scenario-doc");
            expect(get(currentDraftId)).toBe("scenario-draft");
            expect(get(currentDocumentTitle)).toBe(scenario.label);
        });
        await loadScenario(
            {
                ...scenario,
                setup(view) {
                    scenario.setup(view);
                    expectedState = view.state.toJSON(savedFields);
                },
            },
            reload,
        );
        expect(calls.map(({ cmd }) => cmd)).toEqual([
            "cmd_reset_db",
            "cmd_create_document",
            "cmd_create_draft",
            "cmd_append_event",
            "cmd_append_event",
            "cmd_create_snapshot",
            "cmd_update_document_meta",
        ]);
        const snapshot = calls.find(({ cmd }) => cmd === "cmd_create_snapshot")!.args;
        expect(snapshot.draftId).toBe("scenario-draft");
        expect(snapshot.upToEventId).toBe(2);
        expect(JSON.parse(snapshot.stateJson as string)).toEqual(expectedState);
        expect(calls.at(-1)!.args).toMatchObject({
            id: "scenario-doc",
            title: scenario.label,
            wordCount: 2,
            previewText: "Hello world",
            tags: "[]",
            bodyText: "Hello world",
        });
        expect(reload).toHaveBeenCalledOnce();
    });

    it("destroys the temporary editor when setup fails without resetting the database", async () => {
        const destroy = vi.spyOn(EditorView.prototype, "destroy");
        const ipc = vi.fn();
        mockIPC(ipc);
        const reload = vi.fn();
        await expect(
            loadScenario(
                {
                    ...scenario,
                    setup() {
                        throw new Error("bad fixture");
                    },
                },
                reload,
            ),
        ).rejects.toThrow("bad fixture");
        expect(destroy).toHaveBeenCalledOnce();
        expect(ipc).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
        expect(get(currentDocumentId)).toBe("old-doc");
    });

    it("does not publish an incomplete scenario after a snapshot failure", async () => {
        mockIPC((cmd) => {
            if (cmd === "cmd_create_document") return "scenario-doc";
            if (cmd === "cmd_create_draft") return "scenario-draft";
            if (cmd === "cmd_append_event") return { eventId: 1, needsSnapshot: false };
            if (cmd === "cmd_create_snapshot") throw new Error("disk full");
            return null;
        });
        const reload = vi.fn();
        await expect(loadScenario(scenario, reload)).rejects.toThrow("disk full");
        expect(reload).not.toHaveBeenCalled();
        expect(get(currentDocumentId)).toBe("old-doc");
    });
});
