import { getRawAnnotationField } from "$lib/collab/annotationSchema";
import type { Annotations } from "$lib/editor/plugins/annotations";
import type {
    SerializedAnnotation,
    SerializedAnnotationBase,
    SerializedCommentAnnotation,
    SerializedRevisionAnnotation,
    SerializedSuggestionAnnotation,
} from "@quillium/share";
export { buildShareFingerprint } from "@quillium/share";
export type {
    SerializedAnnotation,
    SerializedCommentAnnotation,
    SerializedRevisionAnnotation,
    SerializedSuggestionAnnotation,
    SerializedThreadMessage,
} from "@quillium/share";
import {
    activeVersionIndex,
    normalizeRevision,
    versionText,
} from "$lib/editor/plugins/annotations/models";
import { type RawAnnotations, RawAnnotationsSchema } from "$lib/editor/plugins/annotations/models";

export function serializeAnnotations(
    doc: string,
    annotations: Annotations | undefined,
): SerializedAnnotation[] {
    if (!annotations) return [];

    return serializeAnnotationMap(doc, annotations);
}

/**
 * Untrusted path: validates the raw map (nested version blobs come from
 * persisted JSON) before serializing. Invalid input serializes to [].
 */
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

/**
 * Shared doc→wire mapping over annotations already in the raw (selection as
 * plain JSON) shape. No validation — callers either safeParse first
 * (serializeRawAnnotationMap) or convert trusted live state
 * (serializeAnnotationMap). Ids are stringified as-is, so collab-mode string
 * ids pass through unchanged.
 */
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
                // Raw revisions may be legacy index-based or missing version ids;
                // normalize so versions carry ids and the active pointer resolves
                // to a positional index. The serialized WIRE shape stays
                // index-based (activeVersionIndex + versions[].index) for the
                // public share renderer.
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

            return {
                ...base,
                type: "comment",
            } satisfies SerializedCommentAnnotation;
        })
        .sort((a, b) => a.from - b.from || a.id.localeCompare(b.id));
}

function serializeAnnotationMap(
    doc: string,
    annotations: Annotations,
    idPrefix = "",
): SerializedAnnotation[] {
    // Convert live annotations to the persisted raw shape (selection as plain
    // JSON, exactly what annotationField.toJSON writes) and reuse the shared
    // mapping so there is a single doc→wire serializer. Live state is trusted,
    // so no schema validation (collab-mode string ids must pass through).
    const raw = Object.fromEntries(
        Object.entries(annotations).map(([id, annotation]) => [
            id,
            { ...annotation, selection: annotation.selection.toJSON() },
        ]),
    );
    return serializeParsedAnnotationMap(doc, raw as RawAnnotations, idPrefix);
}
