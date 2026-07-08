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
    activeVersionIndex,
    normalizeRevision,
    versionText,
} from "./models";

/** Read a version blob's nested annotation map (stored as `version.annotationField`). */
function getRawAnnotationField(version: object): RawAnnotations | undefined {
    const candidate = (version as { annotationField?: unknown }).annotationField;
    if (candidate == null) return undefined;
    const parsed = RawAnnotationsSchema.safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
}

function serializeRawAnnotationMap(
    doc: string,
    rawAnnotations: RawAnnotations | undefined,
    idPrefix = "",
): SerializedAnnotation[] {
    if (!rawAnnotations) return [];
    const parsed = RawAnnotationsSchema.safeParse(rawAnnotations);
    if (!parsed.success) return [];
    return serializeParsedAnnotationMap(doc, parsed.data, idPrefix);
}

function serializeParsedAnnotationMap(
    doc: string,
    annotations: RawAnnotations,
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

            if (annotation._type === "suggestion") {
                return {
                    ...base,
                    type: "suggestion",
                    replacements: annotation.replacements.map((replacement) => ({
                        ...replacement,
                    })),
                    author: annotation.author,
                } satisfies SerializedSuggestionAnnotation;
            }

            if (annotation._type === "revision") {
                const revision = normalizeRevision(annotation);
                return {
                    ...base,
                    type: "revision",
                    activeVersionIndex: activeVersionIndex(revision),
                    versions: revision.versions.map((version, index) => ({
                        index,
                        text: versionText(version),
                        label: version.label,
                        annotations: serializeRawAnnotationMap(
                            versionText(version),
                            getRawAnnotationField(version),
                            `${annotationId}.v${index}.`,
                        ),
                    })),
                } satisfies SerializedRevisionAnnotation;
            }

            return { ...base, type: "comment" } satisfies SerializedCommentAnnotation;
        })
        .sort((a, b) => a.from - b.from || a.id.localeCompare(b.id));
}

/** Convert live annotations (trusted) to the raw JSON shape, then serialize. */
function serializeAnnotationMap(doc: string, annotations: Annotations): SerializedAnnotation[] {
    const raw = Object.fromEntries(
        Object.entries(annotations).map(([id, annotation]) => [
            id,
            { ...annotation, selection: annotation.selection.toJSON() },
        ]),
    );
    return serializeParsedAnnotationMap(doc, raw as RawAnnotations);
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
    return { content: doc, annotations: serializeAnnotationMap(doc, annotations) };
}
