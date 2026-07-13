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
    /** Stable lineage token used to distinguish a removed annotation from ID reuse. */
    _historyId?: string;
};

export function getNewId(annotations: Annotations) {
    return getLastId(annotations) + 1;
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
        _historyId: newAnnotationHistoryId(),
        // um this ain't getting serialized baby
        // sameTypeAs: (annotation: GenericAnnotation) => annotation._type === type,
    };
}
// DO NOT COMPARE _type; instead use isAnnotationOfType
type CommentAnnotation = BaseAnnotation & {
    _type: "comment";
};
// See issue #302: annotation status / FSM for active-state tracking.
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
//
// `id` is a STABLE identity for the version, unique within its revision's
// versions[]. Links and the active-version pointer reference this id, never the
// array index (which shifts on add/delete/reorder). The array stays ordered for
// pill display and Ctrl-[ / Ctrl-] navigation; only identity moved to `id`.
export type VersionState = object & {
    id: string;
    doc: string;
    label?: string;
};

export function versionText(version: VersionState): string {
    return version.doc;
}

// Monotonic counter for locally-minted ids within this session. These ids only
// need to be unique within their container (a revision's versions[], the group
// map), so a session-scoped counter plus a short random suffix (to avoid
// collisions when two collab clients mint concurrently) is sufficient and
// cheap. Not persisted — ids are.
let _localIdCounter = 0;
function newLocalId(prefix: string): string {
    _localIdCounter += 1;
    return `${prefix}${_localIdCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newAnnotationHistoryId(): string {
    return newLocalId("a");
}

export function newVersionId(): string {
    return newLocalId("v");
}

type RevisionAnnotation = BaseAnnotation & {
    _type: "revision";
    // Stable id of the active version (key into versions[].id), NOT an array
    // index. Use activeVersionIndex(rev) to get the positional index.
    activeVersionId: string;
    versions: VersionState[];
};

// ── Version lookup helpers ──────────────────────────────────────
// Positional callers (pill rendering, next/prev navigation) keep using indices
// via activeVersionIndex(); identity callers (effects, deletes, switch target)
// use ids via versionById() / versionIndexById().
export function versionIndexById(rev: RevisionAnnotation, id: string): number {
    return rev.versions.findIndex((v) => v.id === id);
}
export function versionById(rev: RevisionAnnotation, id: string): VersionState | undefined {
    return rev.versions.find((v) => v.id === id);
}
/** Positional index of the active version, clamped to a valid slot (0 if not found). */
export function activeVersionIndex(rev: RevisionAnnotation): number {
    const i = versionIndexById(rev, rev.activeVersionId);
    return i < 0 ? 0 : i;
}
/** The active version object, falling back to the first version if the id is stale. */
export function activeVersion(rev: RevisionAnnotation): VersionState {
    return versionById(rev, rev.activeVersionId) ?? rev.versions[0];
}

/**
 * Build a VersionState, minting a stable id when one isn't supplied. Use this at
 * every revision-construction site so versions are never created without an id.
 */
export function makeVersion(partial: Omit<VersionState, "id"> & { id?: string }): VersionState {
    const { id, ...rest } = partial;
    return { id: id ?? newVersionId(), ...rest };
}

/**
 * Heal a revision that may be in the legacy index-based shape:
 *   - versions without `id` get a freshly minted, position-stable id;
 *   - a revision with `activeVersionIndex` (number) but no valid `activeVersionId`
 *     gets `activeVersionId` derived from the clamped index.
 *
 * Idempotent: a revision already in the new shape passes through unchanged
 * (same object identity when nothing needed healing, so reactivity isn't churned).
 * Runs at the load/deserialize boundary (annotationField.fromJSON) and on any
 * externally-sourced revision (collab read path), so the rest of the system can
 * assume every version has an id and every revision a valid activeVersionId.
 */
export function normalizeRevision(rev: RawRevisionLike): RevisionAnnotation {
    const legacyIndex =
        typeof (rev as { activeVersionIndex?: unknown }).activeVersionIndex === "number"
            ? (rev as { activeVersionIndex: number }).activeVersionIndex
            : undefined;

    let mutated = false;
    const versions: VersionState[] = (rev.versions ?? []).map((v) => {
        if (typeof (v as VersionState).id === "string" && (v as VersionState).id) {
            return v as VersionState;
        }
        mutated = true;
        return { ...(v as object), id: newVersionId() } as VersionState;
    });

    const hasValidActiveId =
        typeof (rev as { activeVersionId?: unknown }).activeVersionId === "string" &&
        versions.some((v) => v.id === (rev as { activeVersionId: string }).activeVersionId);

    let activeVersionId: string;
    if (hasValidActiveId) {
        activeVersionId = (rev as { activeVersionId: string }).activeVersionId;
    } else {
        const clamped = Math.max(0, Math.min(legacyIndex ?? 0, versions.length - 1));
        activeVersionId = versions[clamped]?.id ?? versions[0]?.id ?? newVersionId();
        mutated = true;
    }

    // Fast path: already fully migrated (ids present, active id valid, and no
    // stale legacy index to strip). Preserve object identity to avoid reactivity
    // churn on load.
    if (
        !mutated &&
        legacyIndex === undefined &&
        (rev as RevisionAnnotation).activeVersionId === activeVersionId
    ) {
        return rev as unknown as RevisionAnnotation;
    }
    // Drop the legacy activeVersionIndex; everything downstream reads activeVersionId.
    const { activeVersionIndex: _drop, ...base } = rev as Record<string, unknown>;
    void _drop;
    return { ...base, versions, activeVersionId } as unknown as RevisionAnnotation;
}

// The loose input shape normalizeRevision accepts: a revision-ish object from
// either the new or the legacy on-disk shape.
type RawRevisionLike = {
    _type: "revision";
    versions?: Array<Record<string, unknown>>;
    activeVersionId?: string;
    activeVersionIndex?: number;
} & Record<string, unknown>;
export type GenericAnnotation = CommentAnnotation | SuggestionAnnotation | RevisionAnnotation;

/** Backfill a stable lineage token on annotations loaded from pre-0.22 data. */
export function ensureAnnotationHistoryId<T extends GenericAnnotation>(annotation: T): T {
    if (typeof annotation._historyId === "string" && annotation._historyId.length > 0) {
        return annotation;
    }
    return { ...annotation, _historyId: newAnnotationHistoryId() };
}

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
        // Optional on disk for back-compat: legacy snapshots predate version ids.
        // normalizeRevision() mints one at load, so the runtime invariant (every
        // version has an id) still holds.
        id: z.string().optional(),
        doc: z.string(),
        label: z.string().optional(),
    })
    .passthrough();
const RawBaseSchema = z.object({
    id: z.number(),
    thread: z.array(ThreadMessageSchema),
    selection: EditorSelectionSchema,
    // Optional on disk for back-compat. annotationField normalizes legacy data
    // before it enters live state.
    _historyId: z.string().optional(),
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
        // Both are optional/tolerated on disk for back-compat: legacy snapshots
        // carry activeVersionIndex (number); new ones carry activeVersionId
        // (string). normalizeRevision() reconciles to activeVersionId at load.
        activeVersionId: z.string().optional(),
        activeVersionIndex: z.number().optional(),
        versions: z.array(VersionStateSchema).min(1),
    }),
]);
export const RawAnnotationsSchema = z.record(z.string(), RawAnnotationSchema);

export type RawAnnotation = z.infer<typeof RawAnnotationSchema>;
export type RawAnnotations = z.infer<typeof RawAnnotationsSchema>;
export type Annotations = { [id: number]: GenericAnnotation };

export function isRawAnnotationOfType<T extends AnnotationType>(
    annotation: unknown,
    type: T,
): annotation is RawAnnotation & { _type: T } {
    const result = RawAnnotationSchema.safeParse(annotation);
    return result.success && result.data._type === type;
}

// ── Version groups (linking revision versions together, #268) ───
// A group links one version from each of several DIFFERENT revisions into a
// matched set: activating any member switches every member to its partner.
// A member is exclusive — a given (revisionId, versionId) belongs to at most one
// group. Stored in a sibling StateField (versionGroupField), not on annotations.
export type VersionGroupMember = {
    revisionId: number;
    versionId: string;
};
export type VersionGroup = {
    id: string;
    label: string;
    members: VersionGroupMember[];
};
export type VersionGroups = { [groupId: string]: VersionGroup };

// Session counter + random suffix, same rationale as newVersionId (see above):
// group ids are local keys, not global identifiers, so a UUID is unnecessary.
export function newGroupId(): string {
    return newLocalId("g");
}

export function membersEqual(a: VersionGroupMember, b: VersionGroupMember): boolean {
    return a.revisionId === b.revisionId && a.versionId === b.versionId;
}

/** Find the group containing this member, if any (membership is exclusive). */
export function groupOfMember(
    groups: VersionGroups,
    member: VersionGroupMember,
): VersionGroup | undefined {
    return Object.values(groups).find((g) => g.members.some((m) => membersEqual(m, member)));
}

/**
 * The other members of `member`'s group whose target version differs — i.e. the
 * partners that an activation of `member` should cascade-switch. Empty if the
 * member is ungrouped.
 */
export function groupPartnersOf(
    groups: VersionGroups,
    member: VersionGroupMember,
): VersionGroupMember[] {
    const group = groupOfMember(groups, member);
    if (!group) return [];
    return group.members.filter((m) => m.revisionId !== member.revisionId);
}

/**
 * Whether a group may accept `member`. A group links at most ONE version per
 * revision — two versions of the same revision can't both be members, since
 * activating one would give an ambiguous target for that revision. Returns false
 * if the group already holds a (different) version of the member's revision.
 */
export function canAddMemberToGroup(group: VersionGroup, member: VersionGroupMember): boolean {
    return !group.members.some(
        (m) => m.revisionId === member.revisionId && m.versionId !== member.versionId,
    );
}

export const VersionGroupMemberSchema = z.object({
    revisionId: z.number(),
    versionId: z.string(),
});
export const VersionGroupSchema = z.object({
    id: z.string(),
    label: z.string(),
    members: z.array(VersionGroupMemberSchema),
});
export const VersionGroupsSchema = z.record(z.string(), VersionGroupSchema);

// ── Clipboard-serialized shape ──────────────────────────────────
// An annotation rebased into copy-relative coordinates: its id and selection are
// stripped (id is regenerated on paste; the selection is replaced by integer
// relAnchor/relHead offsets relative to the start of the copied text). User
// content rides along verbatim, while the private `_historyId` is deliberately
// regenerated because a paste begins a distinct annotation lineage. Per-type
// extras reuse RawAnnotationSchema's members so they stay a single source of
// truth.
//
// Clipboard payloads come from an untrusted source (a foreign or hand-crafted
// clipboard), so the position offsets and active index are tightened to integers
// even though the persisted schema allows bare numbers: a fractional doc
// coordinate would crash CodeMirror on paste.
//
// ⚠️ ADDING A NEW ANNOTATION TYPE: this derivation is NOT automatic — zod's
// types don't allow mapping the union generically — so a new member of
// GenericAnnotation must be added to the SerializedAnnotationSchema union below,
// carrying that type's extra fields the same way revision/suggestion do. The two
// assertions that bracket the union (the .options length check and the
// _AssertSerializedCoversAllTypes type below) fail to compile if you forget, so
// you can't ship a type that silently drops on copy/paste.
const [RawComment, RawSuggestion, RawRevision] = RawAnnotationSchema.options;
const SerializedBase = z.object({
    relAnchor: z.number().int(),
    relHead: z.number().int(),
    thread: z.array(ThreadMessageSchema),
});
// Tripwire: if a fourth annotation type is added to RawAnnotationSchema, this
// `satisfies` fails to compile (4 options no longer assignable to a 3-tuple),
// forcing whoever adds the type to revisit the serialized union below.
RawAnnotationSchema.options satisfies [z.ZodObject, z.ZodObject, z.ZodObject];
export const SerializedAnnotationSchema = z.discriminatedUnion("_type", [
    SerializedBase.extend({ _type: RawComment.shape._type }),
    SerializedBase.extend({
        _type: RawSuggestion.shape._type,
        replacements: RawSuggestion.shape.replacements,
        author: RawSuggestion.shape.author,
    }),
    SerializedBase.extend({
        _type: RawRevision.shape._type,
        // Clipboard carries the stable active id and full versions[] (each with
        // its id). On paste, clipboardAnnotations regenerates fresh version ids
        // (to avoid collisions with the destination) and remaps activeVersionId.
        // activeVersionIndex stays tolerated for foreign/legacy clipboards.
        activeVersionId: z.string().optional(),
        activeVersionIndex: z.number().int().optional(),
        versions: RawRevision.shape.versions,
    }),
]);
export const SerializedAnnotationsSchema = z.array(SerializedAnnotationSchema);
export type SerializedAnnotation = z.infer<typeof SerializedAnnotationSchema>;

// Compile-time exhaustiveness: the serialized union must cover EVERY _type in
// GenericAnnotation. If a new type is added to GenericAnnotation but not to
// SerializedAnnotationSchema above, the two `_type` sets diverge and one of these
// helper types resolves to `never`, breaking the build. `AssertEqual` produces a
// type error (not just a `never` value) so it can't be silently ignored.
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
type _AssertSerializedCoversAllTypes = AssertEqual<
    SerializedAnnotation["_type"],
    GenericAnnotation["_type"]
>;
// Force evaluation: this const is `true` only when the sets match exactly.
const _serializedCoversAllTypes: _AssertSerializedCoversAllTypes = true;
void _serializedCoversAllTypes;
