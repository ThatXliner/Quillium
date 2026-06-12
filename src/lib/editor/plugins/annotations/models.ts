/**
 * models.ts — Annotation data model definitions
 *
 * This file defines the core data types for the annotation
 * subsystem: comments, suggestions, and revisions. All types
 * are plain objects (not classes) to remain JSON-serializable
 * for CodeMirror StateField persistence.
 *
 * Role in the annotation subsystem:
 *   - Provides the canonical type definitions consumed by
 *     annotationField.ts (state), utils.ts (queries), and
 *     index.ts (commands/decorations).
 *   - Exports factory helpers (createNewAnnotation, clone)
 *     and type guards (isAnnotationOfType) used across the
 *     subsystem.
 *
 * Key dependencies:
 *   - @codemirror/state (EditorSelection) for range data.
 *
 * Interactions:
 *   - annotationField.ts stores Annotations (a map of these
 *     types) inside a CodeMirror StateField.
 *   - utils.ts queries annotations by cursor position.
 *   - index.ts dispatches effects that create/mutate these
 *     types.
 */

// Plain objects rather than classes for JSON serializability (required by
// CodeMirror StateField toJSON/fromJSON). If a class-based approach that
// remains JSON-serializable is found, it could replace this.
import { EditorSelection } from "@codemirror/state";
import { z } from "zod";

// what about multiple authors and stuff???
export type ThreadMessage = { message: string; author: string; time: number };
export type Thread = ThreadMessage[];
export function clone(annotation: GenericAnnotation): GenericAnnotation {
    return {
        ...structuredClone(annotation),
        selection: EditorSelection.fromJSON(annotation.selection.toJSON()),
    };
}
export function isAnnotationOfType<T extends AnnotationType>(
    annotation: GenericAnnotation,
    type: T,
): annotation is Annotation<T> {
    return annotation._type === type;
}
// EditorSelection is kept (rather than a plain Range) so we can extend
// to multi-range selections in the future without a breaking change.
type BaseAnnotation = {
    selection: EditorSelection;
    id: number;
    thread: Thread;
};

export function getNewId(annotations: Annotations) {
    const keys = Object.keys(annotations);
    if (keys.length === 0) return 0;
    return Math.max(...keys.map(Number)) + 1;
}
export function getLastId(annotations: Annotations) {
    const keys = Object.keys(annotations);
    if (keys.length === 0) return -1;
    return Math.max(...keys.map(Number));
}

export function createNewAnnotation<T extends AnnotationType>(
    annotations: Annotations,
    selection: EditorSelection,
    type: T,
) {
    const newId = getNewId(annotations);
    return {
        selection,
        id: newId,
        _type: type,
        thread: [],
        // um this ain't getting serialized baby
        // sameTypeAs: (annotation: GenericAnnotation) => annotation._type === type,
    };
}
// DO NOT COMPARE _type; instead use isAnnotationOfType
type CommentAnnotation = BaseAnnotation & {
    _type: "comment";
};
// See issue #38: annotation status / FSM for active-state tracking.
export type SuggestionReplacement = {
    text: string;
    rationale?: string;
};
type SuggestionAnnotation = BaseAnnotation & {
    _type: "suggestion";
    replacements: SuggestionReplacement[];
    author?: string;
};
// Serialized EditorState blob produced by EditorState.toJSON(savedFields).
// Stored as an opaque object — use versionText() to extract the doc string.
// In collab mode, the subtree Y.Text is the source of truth for doc content;
// in local mode, this blob is the authoritative state.
export type VersionState = object & {
    doc: string;
    label?: string;
};

export function versionText(version: VersionState): string {
    return version.doc;
}

type RevisionAnnotation = BaseAnnotation & {
    _type: "revision";
    // this will now refer to an ID
    activeVersionIndex: number;
    versions: VersionState[];
};
export type GenericAnnotation = CommentAnnotation | SuggestionAnnotation | RevisionAnnotation;

export type Annotation<T extends GenericAnnotation["_type"]> = Extract<
    GenericAnnotation,
    { _type: T }
>;

export type AnnotationType = GenericAnnotation["_type"];

// ── Zod schemas for the persisted (raw JSON) shape ──────────────
// These describe what toJSON writes and what fromJSON reads.
// TypeScript types for the raw layer are derived from these schemas
// so there is a single source of truth.
export const ThreadMessageSchema = z.object({
    message: z.string(),
    author: z.string(),
    time: z.number(),
});
const EditorSelectionSchema = z
    .object({
        ranges: z.array(z.object({ anchor: z.number(), head: z.number() })).min(1),
        main: z.number().optional(),
    })
    .passthrough();
export const SuggestionReplacementSchema = z.object({
    text: z.string(),
    rationale: z.string().optional(),
});
export const VersionStateSchema = z
    .object({
        doc: z.string(),
        label: z.string().optional(),
    })
    .passthrough();
const RawBaseSchema = z.object({
    id: z.number(),
    thread: z.array(ThreadMessageSchema),
    selection: EditorSelectionSchema,
});
export const RawAnnotationSchema = z.discriminatedUnion("_type", [
    RawBaseSchema.extend({ _type: z.literal("comment") }),
    RawBaseSchema.extend({
        _type: z.literal("suggestion"),
        replacements: z.array(SuggestionReplacementSchema),
        author: z.string().optional(),
    }),
    RawBaseSchema.extend({
        _type: z.literal("revision"),
        activeVersionIndex: z.number(),
        versions: z.array(VersionStateSchema).min(1),
    }),
]);
export const RawAnnotationsSchema = z.record(z.string(), RawAnnotationSchema);

export type RawAnnotation = z.infer<typeof RawAnnotationSchema>;
export type RawAnnotations = z.infer<typeof RawAnnotationsSchema>;
export type Annotations = { [id: number]: GenericAnnotation };

// ── Clipboard-serialized shape ──────────────────────────────────
// An annotation rebased into copy-relative coordinates: its id and selection are
// stripped (id is regenerated on paste; the selection is replaced by integer
// relAnchor/relHead offsets relative to the start of the copied text). Every
// other field rides along verbatim, reusing the canonical per-type extras from
// RawAnnotationSchema's members so this stays a single source of truth — a new
// field on any annotation type flows through copy and paste with no change here.
//
// Clipboard payloads come from an untrusted source (a foreign or hand-crafted
// clipboard), so the position offsets and active index are tightened to integers
// even though the persisted schema allows bare numbers: a fractional doc
// coordinate would crash CodeMirror on paste.
const [RawComment, RawSuggestion, RawRevision] = RawAnnotationSchema.options;
const SerializedBase = z.object({
    relAnchor: z.number().int(),
    relHead: z.number().int(),
    thread: z.array(ThreadMessageSchema),
});
export const SerializedAnnotationSchema = z.discriminatedUnion("_type", [
    SerializedBase.extend({ _type: RawComment.shape._type }),
    SerializedBase.extend({
        _type: RawSuggestion.shape._type,
        replacements: RawSuggestion.shape.replacements,
        author: RawSuggestion.shape.author,
    }),
    SerializedBase.extend({
        _type: RawRevision.shape._type,
        activeVersionIndex: z.number().int(),
        versions: RawRevision.shape.versions,
    }),
]);
export const SerializedAnnotationsSchema = z.array(SerializedAnnotationSchema);
export type SerializedAnnotation = z.infer<typeof SerializedAnnotationSchema>;
