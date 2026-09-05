/** sharedDecorations.test.ts — Exercise both hosts with their own persona and atomic inputs. */
import { annotations as desktopExtensions } from "$lib/editor/plugins/annotations";
import { readersSettings } from "$lib/readers/settings.svelte";
import { appSettings, updateSettings } from "$lib/settings.svelte";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { annotationField, getReadonlyExtensions } from "@quillium/share/core";
import { addAnnotation } from "@quillium/share/core/annotationField";
import { createNewAnnotation, makeVersion } from "@quillium/share/core/models";
import { afterEach, describe, expect, it } from "vitest";

const originalPersonas = readersSettings.personas;
const originalAtomic = appSettings.atomicRevisions;
const views: EditorView[] = [];

afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.replaceChildren();
    readersSettings.personas = originalPersonas;
    updateSettings({ atomicRevisions: originalAtomic });
});

for (const host of ["desktop", "Web Preview"] as const) {
    describe(host, () => {
        for (const enabled of [true, false]) {
            it(`renders custom persona dots and atomic revisions with atomic=${enabled}`, () => {
                const persona = {
                    ...originalPersonas[0],
                    name: "My custom reader",
                    color: "#123456",
                    builtin: false,
                    enabled: false,
                };
                readersSettings.personas = [persona];
                updateSettings({ atomicRevisions: enabled });
                const state = EditorState.create({
                    doc: "Alpha Beta Gamma",
                    extensions:
                        host === "desktop"
                            ? desktopExtensions()
                            : getReadonlyExtensions({
                                  personaColors: [persona],
                                  atomicRevisions: enabled,
                              }),
                });
                const view = new EditorView({ state, parent: document.body });
                views.push(view);
                const suggestion = {
                    ...createNewAnnotation({}, EditorSelection.single(11, 16), "suggestion"),
                    replacements: [],
                    author: persona.name,
                };
                view.dispatch({ effects: addAnnotation.of(suggestion) });
                const version = makeVersion({ doc: "Beta" });
                const revision = {
                    ...createNewAnnotation(
                        view.state.field(annotationField),
                        EditorSelection.single(6, 10),
                        "revision",
                    ),
                    activeVersionId: version.id,
                    versions: [version],
                };
                view.dispatch({ effects: addAnnotation.of(revision) });

                const dots = view.dom.querySelectorAll<HTMLElement>(".cm-persona-dot");
                expect(dots).toHaveLength(1);
                expect(dots[0].style.backgroundColor).toBe("rgb(18, 52, 86)");
                const atomicRanges = view.state
                    .facet(EditorView.atomicRanges)
                    .flatMap((provide) => {
                        const ranges = [];
                        for (const cursor = provide(view).iter(); cursor.value; cursor.next()) {
                            ranges.push([cursor.from, cursor.to]);
                        }
                        return ranges;
                    });
                expect(atomicRanges).toEqual(enabled ? [[6, 10]] : []);
                expect(view.state.doc.toString()).toBe("Alpha Beta Gamma");
            });
        }
    });
}
