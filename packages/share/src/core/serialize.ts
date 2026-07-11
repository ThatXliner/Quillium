/**
 * serialize.ts — Live editor state → flat SerializedAnnotation[] projection.
 *
 * The read-only EditorView is the source of truth for a shared document
 * (text + active revision versions). This derives the flat annotation shape
 * that the existing read-only card/modal components consume, recomputed after
 * every dispatch (e.g. a revision version switch) so the sidebar stays in sync
 * with the editor.
 *
 * Ported from the desktop collab serializer (sharePayload.ts); kept pure so it
 * runs in the browser with no app/Tauri coupling.
 */
import type { EditorState } from "@codemirror/state";
import { groupColor } from "../groupColor";
import type {
    SerializedAnnotation,
    SerializedAnnotationBase,
    SerializedCommentAnnotation,
    SerializedRevisionAnnotation,
    SerializedSuggestionAnnotation,
} from "../types";
import { annotationField } from "./annotationField";
import {
    type Annotations,
    type RawAnnotations,
    RawAnnotationsSchema,
    type VersionGroups,
    VersionGroupsSchema,
    activeVersionIndex,
    groupOfMember,
    normalizeRevision,
    isRawAnnotationOfType,
    versionText,
} from "./models";
import { versionGroupField } from "./versionGroupField";

/** Read a version blob's nested annotation map (stored as `version.annotationField`). */
function getRawAnnotationField(version: object): RawAnnotations | undefined {
    const candidate = (version as { annotationField?: unknown }).annotationField;
    if (candidate == null) return undefined;
    const parsed = RawAnnotationsSchema.safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
}

/** Read a nested buffer's linked-version groups when one was persisted. */
function getRawVersionGroups(version: object): VersionGroups | undefined {
    const candidate = (version as { versionGroupField?: unknown }).versionGroupField;
    if (candidate == null) return undefined;
    const parsed = VersionGroupsSchema.safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
}

function serializeRawAnnotationMap(
    doc: string,
    rawAnnotations: RawAnnotations | undefined,
    versionGroups: VersionGroups | undefined,
    idPrefix = "",
): SerializedAnnotation[] {
    if (!rawAnnotations) return [];
    const parsed = RawAnnotationsSchema.safeParse(rawAnnotations);
    if (!parsed.success) return [];
    return serializeParsedAnnotationMap(doc, parsed.data, versionGroups, idPrefix);
}

function serializeParsedAnnotationMap(
    doc: string,
    annotations: RawAnnotations,
    versionGroups: VersionGroups | undefined,
    idPrefix = "",
): SerializedAnnotation[] {
    return Object.values(annotations)
        .map((annotation) => {
            const range = annotation.selection.ranges[0];
            const from = Math.min(range?.anchor ?? 0, range?.head ?? 0);
            const to = Math.max(range?.anchor ?? 0, range?.head ?? 0);
            const annotationId = `${idPrefix}${annotation.id}`;
            const base: SerializedAnnotationBase = {
                id: annotationId,
                type: annotation._type,
                from,
                to,
                selectedText: doc.slice(from, to),
                thread: annotation.thread.map((message) => ({ ...message })),
            };

            if (isRawAnnotationOfType(annotation, "suggestion")) {
                return {
                    ...base,
                    type: "suggestion",
                    replacements: annotation.replacements.map((replacement) => ({
                        ...replacement,
                    })),
                    author: annotation.author,
                } satisfies SerializedSuggestionAnnotation;
            }

            if (isRawAnnotationOfType(annotation, "revision")) {
                const revision = normalizeRevision(annotation);
                return {
                    ...base,
                    type: "revision",
                    activeVersionIndex: activeVersionIndex(revision),
                    versions: revision.versions.map((version, index) => {
                        const group = versionGroups
                            ? groupOfMember(versionGroups, {
                                  revisionId: revision.id,
                                  versionId: version.id,
                              })
                            : undefined;
                        return {
                            index,
                            versionId: version.id,
                            text: versionText(version),
                            label: version.label,
                            group: group
                                ? {
                                      id: group.id,
                                      label: group.label,
                                      memberCount: group.members.length,
                                      color: groupColor(group.id),
                                  }
                                : undefined,
                            annotations: serializeRawAnnotationMap(
                                versionText(version),
                                getRawAnnotationField(version),
                                getRawVersionGroups(version),
                                `${annotationId}.v${index}.`,
                            ),
                        };
                    }),
                } satisfies SerializedRevisionAnnotation;
            }

            return { ...base, type: "comment" } satisfies SerializedCommentAnnotation;
        })
        .sort((a, b) => a.from - b.from || a.id.localeCompare(b.id));
}

/** Convert live annotations (trusted) to the raw JSON shape, then serialize. */
export function serializeAnnotationsFromData(
    doc: string,
    annotations: Annotations,
    versionGroups: VersionGroups = {},
): SerializedAnnotation[] {
    const raw = Object.fromEntries(
        Object.entries(annotations).map(([id, annotation]) => [
            id,
            { ...annotation, selection: annotation.selection.toJSON() },
        ]),
    );
    return serializeParsedAnnotationMap(doc, raw as RawAnnotations, versionGroups);
}

export type SerializedState = {
    content: string;
    annotations: SerializedAnnotation[];
};

/**
 * Project the current EditorState into the flat share shape (doc text +
 * annotations, with active revision versions already materialized in the doc).
 */
export function serializeFromState(state: EditorState): SerializedState {
    const doc = state.doc.toString();
    const annotations = state.field(annotationField, false) ?? {};
    const versionGroups = state.field(versionGroupField, false) ?? {};
    return {
        content: doc,
        annotations: serializeAnnotationsFromData(doc, annotations, versionGroups),
    };
}
