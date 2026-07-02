// compartmentRemoval.probe.test.ts - Wave 0 probe (A2) confirming Compartment.reconfigure([]) removes a StateField from EditorState.
import { history, historyField } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

describe("CodeMirror compartment probes", () => {
    it("probe A2: compartment.reconfigure([]) removes StateField", () => {
        const compartment = new Compartment();
        const state = EditorState.create({
            doc: "hello",
            extensions: [compartment.of(history({ newGroupDelay: 250 }))],
        });
        const view = new EditorView({ state, parent: document.body });

        try {
            expect(view.state.field(historyField, false)).toBeDefined();
            view.dispatch({ effects: compartment.reconfigure([]) });
            expect(view.state.field(historyField, false)).toBeUndefined();
        } finally {
            view.destroy();
        }
    });
});
