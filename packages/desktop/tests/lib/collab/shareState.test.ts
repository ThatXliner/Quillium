import { serializeShareState, withoutTransientShareSelection } from "$lib/collab/shareState";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

describe("serializeShareState", () => {
    it("does not publish the author's transient cursor position", () => {
        const atStart = EditorState.create({
            doc: "A public draft",
            selection: EditorSelection.cursor(0),
        });
        const atEnd = EditorState.create({
            doc: "A public draft",
            selection: EditorSelection.cursor(14),
        });

        expect(serializeShareState(atStart)).toEqual(serializeShareState(atEnd));
        expect(serializeShareState(atStart)).not.toHaveProperty("selection");
    });

    it("ignores cursor positions saved in legacy multi-tab payloads", () => {
        const payload = (anchor: number) => ({
            kind: "quillium-readonly-share",
            version: 2,
            tabs: [
                {
                    id: "tab-1",
                    state: {
                        doc: "A public draft",
                        selection: { ranges: [{ anchor, head: anchor }], main: 0 },
                    },
                },
            ],
        });

        expect(withoutTransientShareSelection(payload(0))).toEqual(
            withoutTransientShareSelection(payload(14)),
        );
    });
});
