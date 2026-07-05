/**
 * EditorHarness — fluent API wrapping CodeMirror EditorView for tests.
 *
 * Provides composable building blocks so test bodies stay declarative
 * and repetition-free.  Each method returns `this` for chaining unless
 * it returns a query value.
 *
 * Usage:
 *   const h = EditorHarness.create("hello world");
 *   h.addRevision(0, 5).nestedEdit(0, 5, 5, " dear").undo();
 *   expect(h.doc).toBe("hello world");
 */

import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    _nestedEditRevision,
    addAnnotation,
    annotationField,
    applySuggestion,
    createNewRevision,
    deleteRevisionVersion,
    nestedEditorEdit,
    removeAnnotation,
    setActiveRevisionVersion,
    updateThread,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    type Annotations,
    type GenericAnnotation,
    type VersionState,
    activeVersion,
    activeVersionIndex,
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
    versionText,
} from "$lib/editor/plugins/annotations/models";
import { history, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// ── Harness ─────────────────────────────────────────────────────────────────

export class EditorHarness {
    readonly view: EditorView;
    private _parent: HTMLDivElement;

    private constructor(doc: string) {
        const state = EditorState.create({
            doc,
            extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
        });
        this._parent = document.createElement("div");
        document.body.appendChild(this._parent);
        this.view = new EditorView({ state, parent: this._parent });
    }

    /** Create a new harness with the given document text. */
    static create(doc = ""): EditorHarness {
        return new EditorHarness(doc);
    }

    /** Tear down the EditorView and remove the DOM element. */
    destroy(): void {
        this.view.destroy();
        this._parent.remove();
    }

    // ── Queries ─────────────────────────────────────────────────────────

    /** Current full document text. */
    get doc(): string {
        return this.view.state.doc.toString();
    }

    /** The annotation map from the StateField. */
    get annotations(): Annotations {
        return this.view.state.field(annotationField);
    }

    /** Get a single annotation by id, or throw. */
    annotation(id: number): GenericAnnotation {
        const ann = this.annotations[id];
        if (!ann) throw new Error(`No annotation with id ${id}`);
        return ann;
    }

    /** Number of annotations in the field. */
    get annotationCount(): number {
        return Object.keys(this.annotations).length;
    }

    /** IDs of all annotations of a given type. */
    annotationIdsOfType(type: GenericAnnotation["_type"]): number[] {
        return Object.values(this.annotations)
            .filter((a) => isAnnotationOfType(a, type))
            .map((a) => a.id);
    }

    /** Get the text under a revision's range in the parent doc. */
    revisionSlice(revisionId: number): string {
        const rev = this.annotation(revisionId);
        if (!isAnnotationOfType(rev, "revision")) {
            throw new Error(`Annotation ${revisionId} is not a revision`);
        }
        return this.view.state.doc.slice(rev.selection.main.from, rev.selection.main.to).toString();
    }

    /** Active version text for a revision annotation. */
    versionDoc(revisionId: number): string {
        const rev = this.annotation(revisionId);
        if (!isAnnotationOfType(rev, "revision")) {
            throw new Error(`Annotation ${revisionId} is not a revision`);
        }
        return versionText(activeVersion(rev));
    }

    /** Version count for a revision annotation. */
    versionCount(revisionId: number): number {
        const rev = this.annotation(revisionId);
        if (!isAnnotationOfType(rev, "revision")) {
            throw new Error(`Annotation ${revisionId} is not a revision`);
        }
        return rev.versions.length;
    }

    /** Active version index for a revision annotation. */
    activeVersionIndex(revisionId: number): number {
        const rev = this.annotation(revisionId);
        if (!isAnnotationOfType(rev, "revision")) {
            throw new Error(`Annotation ${revisionId} is not a revision`);
        }
        return activeVersionIndex(rev);
    }

    /** Active version id for a revision annotation. */
    activeVersionId(revisionId: number): string {
        const rev = this.annotation(revisionId);
        if (!isAnnotationOfType(rev, "revision")) {
            throw new Error(`Annotation ${revisionId} is not a revision`);
        }
        return rev.activeVersionId;
    }

    /** Resolve a positional version index to its stable id (test convenience). */
    versionIdAt(revisionId: number, versionIndex: number): string {
        const rev = this.annotation(revisionId);
        if (!isAnnotationOfType(rev, "revision")) {
            throw new Error(`Annotation ${revisionId} is not a revision`);
        }
        const v = rev.versions[versionIndex];
        if (!v) throw new Error(`Revision ${revisionId} has no version at index ${versionIndex}`);
        return v.id;
    }

    /** Selection range [from, to] for an annotation. */
    annotationRange(id: number): [number, number] {
        const ann = this.annotation(id);
        return [ann.selection.main.from, ann.selection.main.to];
    }

    /** Current cursor position (head of main selection). */
    get cursorPos(): number {
        return this.view.state.selection.main.head;
    }

    get undoDepth(): number {
        return undoDepth(this.view.state);
    }

    get redoDepth(): number {
        return redoDepth(this.view.state);
    }

    // ── Document mutations ──────────────────────────────────────────────

    /** Insert text at a position. */
    insert(pos: number, text: string): this {
        this.view.dispatch({ changes: { from: pos, to: pos, insert: text } });
        return this;
    }

    /** Delete a range [from, to). */
    delete(from: number, to: number): this {
        this.view.dispatch({ changes: { from, to } });
        return this;
    }

    /** Replace a range with new text. */
    replace(from: number, to: number, insert: string): this {
        this.view.dispatch({ changes: { from, to, insert } });
        return this;
    }

    /** Replace the entire document. */
    replaceAll(text: string): this {
        this.view.dispatch({
            changes: { from: 0, to: this.view.state.doc.length, insert: text },
        });
        return this;
    }

    // ── Annotation mutations ────────────────────────────────────────────

    /**
     * Add a revision annotation over [from, to) with the initial version
     * text matching the doc slice. Returns the new annotation id.
     */
    addRevision(
        from: number,
        to: number,
        versions?: Array<Partial<VersionState> & { doc: string }>,
        activeVersionIndex = 0,
    ): number {
        // Mint stable ids for any versions that lack one so tests can pass bare
        // `{ doc }` literals.
        const builtVersions: VersionState[] = (
            versions ?? [{ doc: this.view.state.doc.sliceString(from, to) }]
        ).map((v) => makeVersion(v));
        const active = builtVersions[activeVersionIndex] ?? builtVersions[0];
        const ann = {
            ...createNewAnnotation(this.annotations, EditorSelection.single(from, to), "revision"),
            activeVersionId: active.id,
            versions: builtVersions,
        };
        this.view.dispatch({
            effects: [addAnnotation.of(ann)],
        });
        return ann.id;
    }

    /**
     * Add a comment annotation over [from, to). Returns the new id.
     */
    addComment(from: number, to: number): number {
        const ann = createNewAnnotation(
            this.annotations,
            EditorSelection.single(from, to),
            "comment",
        );
        this.view.dispatch({ effects: [addAnnotation.of(ann)] });
        return ann.id;
    }

    /**
     * Add a suggestion annotation over [from, to). Returns the new id.
     */
    addSuggestion(
        from: number,
        to: number,
        replacements: { text: string; rationale?: string }[] = [],
    ): number {
        const ann = {
            ...createNewAnnotation(
                this.annotations,
                EditorSelection.single(from, to),
                "suggestion",
            ),
            replacements,
        };
        this.view.dispatch({ effects: [addAnnotation.of(ann)] });
        return ann.id;
    }

    /** Remove an annotation by id. */
    removeAnnotation(id: number): this {
        const ann = this.annotation(id);
        this.view.dispatch({
            effects: [removeAnnotation.of(ann)],
        });
        return this;
    }

    // ── Nested editor simulation ────────────────────────────────────────

    /**
     * Simulate a nested editor edit. `from`/`to` are positions relative to
     * the start of the revision's range.
     */
    nestedEdit(revisionId: number, from: number, to: number, insert: string): this {
        const rev = this.annotation(revisionId);
        if (!isAnnotationOfType(rev, "revision")) {
            throw new Error(`Annotation ${revisionId} is not a revision`);
        }
        const offset = rev.selection.main.from;
        this.view.dispatch({
            changes: { from: offset + from, to: offset + to, insert },
            effects: [_nestedEditRevision.of(revisionId)],
            annotations: [nestedEditorEdit.of(revisionId), Transaction.addToHistory.of(true)],
        });
        return this;
    }

    /** Nested insert at a relative offset within the revision. */
    nestedInsert(revisionId: number, relPos: number, text: string): this {
        return this.nestedEdit(revisionId, relPos, relPos, text);
    }

    /** Nested delete within the revision range. */
    nestedDelete(revisionId: number, relFrom: number, relTo: number): this {
        return this.nestedEdit(revisionId, relFrom, relTo, "");
    }

    // ── Suggestion operations ──────────────────────────────────────────

    /** Apply a suggestion replacement. */
    applySuggestion(suggestionId: number, replacementIndex = 0): this {
        const spec = applySuggestion(this.view.state, suggestionId, replacementIndex);
        this.view.dispatch(spec);
        return this;
    }

    // ── Thread operations ───────────────────────────────────────────────

    /** Add a message to an annotation's thread. */
    addThreadMessage(annotationId: number, message: string, author = "user"): this {
        const ann = this.annotation(annotationId);
        const newThread = [...ann.thread, { message, author, time: Date.now() }];
        this.view.dispatch({
            effects: [updateThread.of({ annotationId, newThread })],
        });
        return this;
    }

    // ── Version management ──────────────────────────────────────────────

    /** Switch the active version for a revision annotation (by positional index). */
    switchVersion(revisionId: number, versionIndex: number): this {
        const spec = setActiveRevisionVersion(
            this.view.state,
            revisionId,
            this.versionIdAt(revisionId, versionIndex),
        );
        this.view.dispatch(spec);
        return this;
    }

    /** Switch the active version for a revision annotation (by stable id). */
    switchVersionById(revisionId: number, versionId: string): this {
        this.view.dispatch(setActiveRevisionVersion(this.view.state, revisionId, versionId));
        return this;
    }

    /** Add a new empty version to a revision (like Cmd+Shift+V). */
    addNewVersion(revisionId: number): this {
        const spec = createNewRevision(this.view.state, revisionId);
        this.view.dispatch(spec);
        return this;
    }

    /** Delete a version from a revision (by positional index). */
    deleteVersion(revisionId: number, versionIndex: number): this {
        const spec = deleteRevisionVersion(
            this.view.state,
            revisionId,
            this.versionIdAt(revisionId, versionIndex),
        );
        this.view.dispatch(spec);
        return this;
    }

    // ── Undo / Redo ─────────────────────────────────────────────────────

    undo(): this {
        undo(this.view);
        return this;
    }

    redo(): this {
        redo(this.view);
        return this;
    }

    /** Undo N times. */
    undoN(n: number): this {
        for (let i = 0; i < n; i++) undo(this.view);
        return this;
    }

    /** Redo N times. */
    redoN(n: number): this {
        for (let i = 0; i < n; i++) redo(this.view);
        return this;
    }

    // ── Cursor ──────────────────────────────────────────────────────────

    /** Set cursor position. */
    setCursor(pos: number): this {
        this.view.dispatch({
            selection: EditorSelection.cursor(pos),
        });
        return this;
    }

    /** Set a selection range. */
    setSelection(from: number, to: number): this {
        this.view.dispatch({
            selection: EditorSelection.single(from, to),
        });
        return this;
    }

    // ── Invariant checks ────────────────────────────────────────────────

    /**
     * Assert that all revision annotations have version.doc matching the
     * doc slice under their range. This is the fundamental consistency
     * invariant of the annotation system.
     */
    assertVersionDocConsistency(): this {
        for (const ann of Object.values(this.annotations)) {
            if (!isAnnotationOfType(ann, "revision")) continue;
            const slice = this.view.state.doc
                .sliceString(ann.selection.main.from, ann.selection.main.to)
                .toString();
            const vDoc = versionText(activeVersion(ann));
            if (slice !== vDoc) {
                throw new Error(
                    `Version doc mismatch for revision ${ann.id}: ` +
                        `slice=${JSON.stringify(slice)}, version.doc=${JSON.stringify(vDoc)}`,
                );
            }
        }
        return this;
    }

    /**
     * Assert all annotation ranges are within document bounds.
     */
    assertRangesInBounds(): this {
        const docLen = this.view.state.doc.length;
        for (const ann of Object.values(this.annotations)) {
            const from = ann.selection.main.from;
            const to = ann.selection.main.to;
            if (from < 0 || to > docLen || from > to) {
                throw new Error(
                    `Annotation ${ann.id} range [${from}, ${to}] out of doc bounds [0, ${docLen}]`,
                );
            }
        }
        return this;
    }

    /**
     * Run all consistency invariants.
     */
    assertConsistent(): this {
        this.assertRangesInBounds();
        this.assertVersionDocConsistency();
        return this;
    }
}
