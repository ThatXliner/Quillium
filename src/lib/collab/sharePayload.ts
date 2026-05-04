import type { Annotations } from "$lib/editor/plugins/annotations";
import { getRawAnnotationField } from "$lib/collab/annotationSchema";
import { isAnnotationOfType, versionText } from "$lib/editor/plugins/annotations/models";
import { RawAnnotationsSchema, type RawAnnotations } from "$lib/editor/plugins/annotations/models";

export type SerializedThreadMessage = {
    message: string;
    author: string;
    time: number;
};

type SerializedAnnotationBase = {
    id: string;
    type: "comment" | "suggestion" | "revision";
    from: number;
    to: number;
    selectedText: string;
    thread: SerializedThreadMessage[];
};

export type SerializedCommentAnnotation = SerializedAnnotationBase & {
    type: "comment";
};

export type SerializedSuggestionAnnotation = SerializedAnnotationBase & {
    type: "suggestion";
    replacements: { text: string; rationale?: string }[];
    author?: string;
};

export type SerializedRevisionAnnotation = SerializedAnnotationBase & {
    type: "revision";
    activeVersionIndex: number;
    versions: {
        index: number;
        text: string;
        label?: string;
        annotations: SerializedAnnotation[];
    }[];
};

export type SerializedAnnotation =
    | SerializedCommentAnnotation
    | SerializedSuggestionAnnotation
    | SerializedRevisionAnnotation;

function stableSerialize(value: unknown): string {
    if (value === undefined) {
        return "undefined";
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
    }

    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
    }

    return JSON.stringify(value);
}

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
                return {
                    ...base,
                    type: "revision",
                    activeVersionIndex: annotation.activeVersionIndex,
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
                    activeVersionIndex: annotation.activeVersionIndex,
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

export function buildShareFingerprint(
    title: string,
    content: string,
    annotations: SerializedAnnotation[],
): string {
    return stableSerialize({
        title: title.trim() || "Untitled",
        content,
        annotations,
    });
}
