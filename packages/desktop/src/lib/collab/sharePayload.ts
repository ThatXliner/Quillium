import { getRawAnnotationField } from "$lib/collab/annotationSchema";
import type { Annotations } from "$lib/editor/plugins/annotations";
import type {
    SerializedAnnotation,
    SerializedAnnotationBase,
    SerializedCommentAnnotation,
    SerializedRevisionAnnotation,
    SerializedSuggestionAnnotation,
    SerializedThreadMessage,
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
    isAnnotationOfType,
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

function serializeRawAnnotationMap(
    doc: string,
    rawAnnotations: RawAnnotations | undefined,
    idPrefix = "",
): SerializedAnnotation[] {
    if (!rawAnnotations) return [];

    const parsed = RawAnnotationsSchema.safeParse(rawAnnotations);
    if (!parsed.success) return [];

    return Object.values(parsed.data)
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
    if (!annotations) return [];

    return Object.values(annotations)
        .map((annotation) => {
            const range = annotation.selection.ranges[0];
            const from = range?.from ?? annotation.selection.main.from;
            const to = range?.to ?? annotation.selection.main.to;
            const annotationId = `${idPrefix}${annotation.id}`;
            const base: SerializedAnnotationBase = {
                id: annotationId,
                type: annotation._type,
                from,
                to,
                selectedText: doc.slice(from, to),
                thread: annotation.thread.map((message) => ({ ...message })),
            };

            if (isAnnotationOfType(annotation, "suggestion")) {
                return {
                    ...base,
                    type: "suggestion",
                    replacements: annotation.replacements.map((replacement) => ({
                        ...replacement,
                    })),
                    author: annotation.author,
                } satisfies SerializedSuggestionAnnotation;
            }

            if (isAnnotationOfType(annotation, "revision")) {
                return {
                    ...base,
                    type: "revision",
                    activeVersionIndex: activeVersionIndex(annotation),
                    versions: annotation.versions.map((version, index) => ({
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
