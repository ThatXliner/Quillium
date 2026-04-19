/**
 * go-live-mid-session.test.ts -- Bug #1: inline editor edits must keep
 * `versions[active].doc` in sync after going live mid-session.
 *
 * Scenario: a user has a revision open in the inline editor, then clicks Go
 * Live. The inline editor was mounted in local-only mode, but collab now owns
 * the parent document. Typing in the inline editor after going live MUST
 * update `versions[active].doc` in the parent annotationField.
 *
 * Root cause: `_hasCollabSubtree` is captured at mount time inside
 * NestedEditorController. `hasSubtreeForRevision(id)` short-circuits Phase 3
 * of the annotationField reducer the moment the Yjs subtree for this
 * revision is seeded. Controllers mounted BEFORE that seeding keep running
 * the local sync path, but Phase 3 no longer mirrors parent doc slice into
 * versions[i].doc — the version text goes dark.
 *
 * Fix: expose `needsCollabModeRebuild()` on the controller and have Svelte
 * callers rebuild the nested editor when the collab mode flips. This test
 * verifies the detection logic at the controller layer.
 *
 * NOTE: Driving the full NestedEditorController.create() path from vitest
 * trips the CodeMirror "multiple instances of @codemirror/state" guard when
 * the nested extension set pulls in the SvelteKit `$lib/editor/extensions`
 * barrel. So this test stubs out `_editor`/`_hasCollabSubtree` directly via
 * a narrowly-typed test helper to exercise only the detection logic. The
 * typing-through-the-nested-editor path is already covered by
 * yjsAnnotations.convergence.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as Y from "yjs";
import {
    addAnnotation,
    annotationField,
} from "$lib/editor/plugins/annotations/annotationField";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";
import { NestedEditorController } from "$lib/editor/plugins/annotations/NestedEditorController";
import { AnnotationIdMap } from "./annotationSchema";
import type { CollabSession, YjsAnnotationNode } from "./types";
import { collabSession } from "./store";

/** Test-only handle to poke at the controller's private mount state. */
interface MountInternals {
    _editor: EditorView | undefined;
    _hasCollabSubtree: boolean;
    _mountedVersionIndex: number;
    _editorVersionIndex: number;
    _lastDispatchedDoc: string;
}

/**
 * Simulate a mounted controller by stuffing in a minimal EditorView. We can't
 * call the real `create()` in this test environment (see file header), so we
 * hand-craft enough state for `needsCollabModeRebuild` to run its branches.
 */
function fakeMount(controller: NestedEditorController, hasCollabSubtree: boolean): EditorView {
    const fakeEditor = new EditorView({
        state: EditorState.create({ doc: "hello" }),
        parent: document.body,
    });
    const internals = controller as unknown as MountInternals;
    internals._editor = fakeEditor;
    internals._hasCollabSubtree = hasCollabSubtree;
    internals._mountedVersionIndex = 0;
    internals._editorVersionIndex = 0;
    internals._lastDispatchedDoc = "hello";
    return fakeEditor;
}

/**
 * Build a CollabSession that `getRevisionYjsId` / `hasSubtreeForRevision`
 * can read from. We don't need a real provider for detection-only tests.
 */
function buildSession(clientID: string, registeredIds: Map<number, string>) {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");
    const mainIdMap = new AnnotationIdMap();
    for (const [cmId, yjsId] of registeredIds) {
        mainIdMap.register(yjsId, cmId);
        // Also seed a minimal Y.Map entry with a versions Y.Map so
        // `hasSubtreeForRevision` returns true (it checks for a non-empty
        // versions map).
        const node = new Y.Map<unknown>();
        const versions = new Y.Map<unknown>();
        const v0 = new Y.Map<unknown>();
        v0.set("text", new Y.Text());
        versions.set("0", v0);
        node.set("versions", versions);
        ydoc.transact(() => ymap.set(yjsId, node as YjsAnnotationNode), "init");
    }
    const undoManager = new Y.UndoManager([ytext, ymap], {
        trackedOrigins: new Set(["local"]),
        captureTimeout: 500,
    });
    return {
        docId: "test-doc",
        clientID,
        isOwner: true,
        ydoc,
        provider: {} as CollabSession["provider"],
        awareness: {} as CollabSession["awareness"],
        ymap,
        ytext,
        undoManager,
        mainIdMap,
    } satisfies CollabSession;
}

describe("Bug #1: detecting the local/collab mode flip for a revision", () => {
    let parentView: EditorView;

    beforeEach(() => {
        parentView = new EditorView({
            state: EditorState.create({ doc: "hello", extensions: [annotationField] }),
            parent: document.body,
        });
        const revision: GenericAnnotation = {
            id: 0,
            _type: "revision",
            selection: EditorSelection.single(0, 5),
            thread: [],
            versions: [{ doc: "hello" }],
            activeVersionIndex: 0,
        };
        parentView.dispatch({ effects: [addAnnotation.of(revision)] });
    });

    afterEach(() => {
        collabSession.set(null);
        parentView.destroy();
    });

    it("returns false when the controller is not mounted", () => {
        const controller = new NestedEditorController(
            parentView,
            0,
            { onUpdate: () => {} },
            "flush-on-destroy",
        );
        expect(controller.needsCollabModeRebuild()).toBe(false);

        // Still false even if collab state flips, because there's nothing to
        // rebuild yet.
        collabSession.set(buildSession("owner", new Map([[0, "yjs-rev-0"]])));
        expect(controller.needsCollabModeRebuild()).toBe(false);
    });

    it("returns false when mode matches (local stable)", () => {
        const controller = new NestedEditorController(
            parentView,
            0,
            { onUpdate: () => {} },
            "flush-on-destroy",
        );
        const editor = fakeMount(controller, /* hasCollabSubtree */ false);
        try {
            expect(controller.needsCollabModeRebuild()).toBe(false);
        } finally {
            editor.destroy();
        }
    });

    it("returns false when mode matches (collab stable)", () => {
        collabSession.set(buildSession("owner", new Map([[0, "yjs-rev-0"]])));

        const controller = new NestedEditorController(
            parentView,
            0,
            { onUpdate: () => {} },
            "flush-on-destroy",
        );
        const editor = fakeMount(controller, /* hasCollabSubtree */ true);
        try {
            expect(controller.needsCollabModeRebuild()).toBe(false);
        } finally {
            editor.destroy();
        }
    });

    it("returns true on the going-live transition (local → collab)", () => {
        // Mount the controller in local mode first.
        const controller = new NestedEditorController(
            parentView,
            0,
            { onUpdate: () => {} },
            "flush-on-destroy",
        );
        const editor = fakeMount(controller, /* hasCollabSubtree */ false);
        try {
            expect(controller.needsCollabModeRebuild()).toBe(false);

            // User clicks Go Live. collabSession is now populated and the Yjs
            // subtree for this revision has been seeded. This is the exact
            // moment the mode flip happens.
            collabSession.set(buildSession("owner", new Map([[0, "yjs-rev-0"]])));

            expect(controller.needsCollabModeRebuild()).toBe(true);
        } finally {
            editor.destroy();
        }
    });

    it("returns true on the leaving-live transition (collab → local)", () => {
        // Mount under an active session.
        collabSession.set(buildSession("owner", new Map([[0, "yjs-rev-0"]])));

        const controller = new NestedEditorController(
            parentView,
            0,
            { onUpdate: () => {} },
            "flush-on-destroy",
        );
        const editor = fakeMount(controller, /* hasCollabSubtree */ true);
        try {
            expect(controller.needsCollabModeRebuild()).toBe(false);

            // Leave the session (disableCollab clears collabSession).
            collabSession.set(null);

            expect(controller.needsCollabModeRebuild()).toBe(true);
        } finally {
            editor.destroy();
        }
    });

    it("scoped by revision: another revision's subtree doesn't cause a false positive", () => {
        // Session has revision 42 registered, but this controller is for 0.
        collabSession.set(buildSession("owner", new Map([[42, "yjs-rev-42"]])));

        const controller = new NestedEditorController(
            parentView,
            0,
            { onUpdate: () => {} },
            "flush-on-destroy",
        );
        const editor = fakeMount(controller, /* hasCollabSubtree */ false);
        try {
            // Controller for revision 0 has no subtree → still local → stable.
            expect(controller.needsCollabModeRebuild()).toBe(false);
        } finally {
            editor.destroy();
        }
    });
});
