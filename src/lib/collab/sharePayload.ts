import type { Annotations } from "$lib/editor/plugins/annotations";
import { isAnnotationOfType, versionText } from "$lib/editor/plugins/annotations/models";

export type SerializedThreadMessage = {
    message: string;
    author: string;
    time: number;
};

type SerializedAnnotationBase = {
    id: number;
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
    versions: { index: number; text: string; label?: string }[];
};

export type SerializedAnnotation =
    | SerializedCommentAnnotation
    | SerializedSuggestionAnnotation
    | SerializedRevisionAnnotation;

function stableSerialize(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
    }

    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
        );
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
    }

    return JSON.stringify(value);
}

export function serializeAnnotations(
    doc: string,
    annotations: Annotations | undefined,
): SerializedAnnotation[] {
    if (!annotations) return [];

    return Object.values(annotations)
        .map((annotation) => {
            const range = annotation.selection.ranges[0];
            const from = range?.from ?? annotation.selection.main.from;
            const to = range?.to ?? annotation.selection.main.to;
            const base: SerializedAnnotationBase = {
                id: annotation.id,
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
                    replacements: annotation.replacements.map((replacement) => ({ ...replacement })),
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
                    })),
                } satisfies SerializedRevisionAnnotation;
            }

            return {
                ...base,
                type: "comment",
            } satisfies SerializedCommentAnnotation;
        })
        .sort((a, b) => a.from - b.from || a.id - b.id);
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
