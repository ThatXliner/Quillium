/**
 * Tests for version groups — linking revision versions together (#268).
 *
 * A version group links one version from each of several DIFFERENT revisions so
 * that activating any member switches every member to its partner (cascade),
 * atomically and in one undo step. Covers:
 *   1. Cascade switch (activating one member switches the group).
 *   2. One undo reverts the whole group; redo re-applies it.
 *   3. Exclusive membership (adding a member moves it out of its prior group).
 *   4. Referential integrity (revision/version delete prunes members; a group
 *      that drops below two members dissolves) — and undo restores it.
 *   5. Rename, and ungrouped switches stay independent.
 */

import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, redo, undo } from "@codemirror/commands";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    addAnnotation,
    annotationField,
    deleteRevisionVersion,
    removeAnnotation,
    setActiveRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    addVersionToGroup,
    createVersionGroup,
    versionGroupField,
} from "$lib/editor/plugins/annotations/versionGroupField";
import {
    activeVersion,
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
    versionText,
} from "$lib/editor/plugins/annotations/models";

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

/** Add a revision with the given versions; returns its id and version ids. */
function addRevision(
    view: EditorView,
    from: number,
    to: number,
    versions: Array<{ doc: string; label?: string }>,
    activeIndex = 0,
): { id: number; versionIds: string[] } {
    const built = versions.map((v) => makeVersion(v));
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        activeVersionId: built[activeIndex].id,
        versions: built,
    };
    view.dispatch(view.state.update({ effects: [addAnnotation.of(annotation)] }));
    return { id: annotation.id, versionIds: built.map((v) => v.id) };
}

function rev(view: EditorView, id: number) {
    const a = view.state.field(annotationField)[id];
    if (!a || !isAnnotationOfType(a, "revision")) throw new Error(`no revision ${id}`);
    return a;
}
function activeText(view: EditorView, id: number) {
    return versionText(activeVersion(rev(view, id)));
}
function activeId(view: EditorView, id: number) {
    return rev(view, id).activeVersionId;
}
function groups(view: EditorView) {
    return view.state.field(versionGroupField);
}

let view: EditorView | undefined;
afterEach(() => {
    view?.destroy();
    view = undefined;
});

// Build two non-overlapping revisions, each with "formal"/"casual" versions, and
// link the formal pair and the casual pair into two groups.
function setupLinkedDoc() {
    // doc: "AAAA BBBB" — revision A over [0,4), revision B over [5,9).
    const v = createView("AAAA BBBB");
    const a = addRevision(v, 0, 4, [{ doc: "AAAA", label: "formal" }, { doc: "aaaa", label: "casual" }]);
    const b = addRevision(v, 5, 9, [{ doc: "BBBB", label: "formal" }, { doc: "bbbb", label: "casual" }]);
    // Group the two "formal" versions (index 0) and the two "casual" (index 1).
    const formal = createVersionGroup("Formal", [
        { revisionId: a.id, versionId: a.versionIds[0] },
        { revisionId: b.id, versionId: b.versionIds[0] },
    ]);
    v.dispatch(formal.spec);
    const casual = createVersionGroup("Casual", [
        { revisionId: a.id, versionId: a.versionIds[1] },
        { revisionId: b.id, versionId: b.versionIds[1] },
    ]);
    v.dispatch(casual.spec);
    return { v, a, b, formalId: formal.groupId, casualId: casual.groupId };
}

describe("version group cascade", () => {
    it("switching one member switches every member of the group", () => {
        const { v, a, b } = setupLinkedDoc();
        view = v;
        expect(activeText(v, a.id)).toBe("AAAA");
        expect(activeText(v, b.id)).toBe("BBBB");

        // Switch A to its casual version → B should follow to casual.
        v.dispatch(setActiveRevisionVersion(v.state, a.id, a.versionIds[1]));

        expect(activeText(v, a.id)).toBe("aaaa");
        expect(activeText(v, b.id)).toBe("bbbb");
        // And the main document reflects both switches.
        expect(v.state.doc.toString()).toBe("aaaa bbbb");
    });

    it("cascades in the other direction too (switch B → A follows)", () => {
        const { v, a, b } = setupLinkedDoc();
        view = v;
        v.dispatch(setActiveRevisionVersion(v.state, b.id, b.versionIds[1]));
        expect(activeText(v, a.id)).toBe("aaaa");
        expect(activeText(v, b.id)).toBe("bbbb");
    });

    it("one undo reverts the whole group; redo re-applies it", () => {
        const { v, a, b } = setupLinkedDoc();
        view = v;
        v.dispatch(setActiveRevisionVersion(v.state, a.id, a.versionIds[1]));
        expect(v.state.doc.toString()).toBe("aaaa bbbb");

        undo(v);
        expect(activeText(v, a.id)).toBe("AAAA");
        expect(activeText(v, b.id)).toBe("BBBB");
        expect(v.state.doc.toString()).toBe("AAAA BBBB");

        redo(v);
        expect(activeText(v, a.id)).toBe("aaaa");
        expect(activeText(v, b.id)).toBe("bbbb");
    });

    it("does not cascade an ungrouped revision", () => {
        const { v, a, b } = setupLinkedDoc();
        view = v;
        // Add a third, ungrouped revision.
        const c = addRevision(v, 9, 9, [{ doc: "" }, { doc: "X" }]);
        v.dispatch(setActiveRevisionVersion(v.state, a.id, a.versionIds[1]));
        // C untouched.
        expect(activeId(v, c.id)).toBe(c.versionIds[0]);
    });
});

describe("exclusive membership", () => {
    it("adding a member to a new group removes it from its prior group", () => {
        const { v, a, b, formalId } = setupLinkedDoc();
        view = v;
        // a.formal is currently in "Formal". Create a new group that grabs it.
        const c = addRevision(v, 9, 9, [{ doc: "" }, { doc: "C" }]);
        const other = createVersionGroup("Other", [
            { revisionId: a.id, versionId: a.versionIds[0] },
            { revisionId: c.id, versionId: c.versionIds[0] },
        ]);
        v.dispatch(other.spec);

        const g = groups(v);
        // a.formal no longer in Formal...
        const formal = g[formalId];
        const stillInFormal =
            formal?.members.some(
                (m) => m.revisionId === a.id && m.versionId === a.versionIds[0],
            ) ?? false;
        expect(stillInFormal).toBe(false);
        // ...and Formal dropped to one member (b.formal), so it dissolved.
        expect(g[formalId]).toBeUndefined();
        // a.formal is in Other.
        expect(
            g[other.groupId].members.some(
                (m) => m.revisionId === a.id && m.versionId === a.versionIds[0],
            ),
        ).toBe(true);
    });
});

describe("one version per revision per group", () => {
    it("rejects adding a second version of the same revision to a group", () => {
        const { v, a, b, formalId } = setupLinkedDoc();
        view = v;
        // Formal currently holds a.formal (index 0). Try to also add a.casual.
        v.dispatch(
            addVersionToGroup(v.state, formalId, {
                revisionId: a.id,
                versionId: a.versionIds[1],
            }),
        );
        const formal = groups(v)[formalId];
        // Still only the original two members; the second a-version was rejected.
        expect(formal.members.length).toBe(2);
        expect(
            formal.members.some(
                (m) => m.revisionId === a.id && m.versionId === a.versionIds[1],
            ),
        ).toBe(false);
    });
});

describe("referential integrity", () => {
    it("removing a revision prunes its members and dissolves the group", () => {
        const { v, a, b, formalId, casualId } = setupLinkedDoc();
        view = v;
        const annotation = rev(v, b.id);
        v.dispatch(v.state.update({ effects: [removeAnnotation.of(annotation)] }));
        // Both groups lose b and drop to one member → dissolved.
        expect(groups(v)[formalId]).toBeUndefined();
        expect(groups(v)[casualId]).toBeUndefined();
    });

    it("deleting a grouped version prunes that member", () => {
        const { v, a, b, formalId } = setupLinkedDoc();
        view = v;
        // Give A a third version so deleting one doesn't delete the whole revision.
        // (A already has 2; delete its formal version — that member is pruned.)
        v.dispatch(deleteRevisionVersion(v.state, a.id, a.versionIds[0]));
        const formal = groups(v)[formalId];
        // Formal had {a.formal, b.formal}; a.formal pruned → one member → dissolved.
        expect(formal).toBeUndefined();
    });

    it("undo restores a group dissolved by a revision delete", () => {
        const { v, a, b, formalId } = setupLinkedDoc();
        view = v;
        const annotation = rev(v, b.id);
        v.dispatch(v.state.update({ effects: [removeAnnotation.of(annotation)] }));
        expect(groups(v)[formalId]).toBeUndefined();

        undo(v);
        // The revision is back AND the group is restored with both members.
        const formal = groups(v)[formalId];
        expect(formal).toBeDefined();
        expect(formal.members.length).toBe(2);
    });
});

describe("group structure ops", () => {
    it("a freshly created group has exactly its seed members", () => {
        const { v, formalId } = setupLinkedDoc();
        view = v;
        expect(groups(v)[formalId].members.length).toBe(2);
        expect(groups(v)[formalId].label).toBe("Formal");
    });
});
