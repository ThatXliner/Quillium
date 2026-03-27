/**
 * export.ts — Document export utilities.
 *
 * Supports exporting the current document as:
 *   - Plain text (.txt) — just the document content
 *   - Text with annotations (.txt) — document content + annotations as JSON after a separator
 *   - JSON (.json) — document content + all annotations
 *   - Markdown (.md) — document text with annotations as footnotes
 *
 * Uses the browser Blob + <a> download pattern (same as ErrorBanner).
 */

import type { EditorView } from "@codemirror/view";
import { get } from "svelte/store";
import { annotationField } from "./editor/plugins/annotations";
import {
    isAnnotationOfType,
    versionText,
    type GenericAnnotation,
} from "./editor/plugins/annotations/models";
import { currentDocumentTitle } from "./stores";

export type ExportFormat = "txt" | "json" | "md" | "txt+json";

function triggerDownload(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sanitizeFilename(title: string): string {
    return title.replace(/[/\\?%*:|"<>]/g, "-").trim() || "document";
}

function annotationRange(annotation: GenericAnnotation): { from: number; to: number } {
    const range = annotation.selection.ranges[0];
    return { from: range.from, to: range.to };
}

function buildPlainText(view: EditorView): string {
    return view.state.doc.toString();
}

function buildJSON(view: EditorView): string {
    return JSON.stringify(
        {
            title: get(currentDocumentTitle),
            exportedAt: new Date().toISOString(),
            text: view.state.doc.toString(),
            annotations: buildAnnotationsJSON(view),
        },
        null,
        2,
    );
}

function buildAnnotationsJSON(view: EditorView): object[] {
    const doc = view.state.doc.toString();
    const annots = view.state.field(annotationField);

    return Object.values(annots).map((a) => {
        const { from, to } = annotationRange(a);
        const selectedText = doc.slice(from, to);
        const base = {
            id: a.id,
            type: a._type,
            from,
            to,
            selectedText,
            thread: a.thread,
        };

        if (isAnnotationOfType(a, "suggestion")) {
            return { ...base, replacements: a.replacements };
        }
        if (isAnnotationOfType(a, "revision")) {
            return {
                ...base,
                activeVersionIndex: a.activeVersionIndex,
                versions: a.versions.map((v, i) => ({
                    index: i,
                    text: versionText(v),
                    label: v.label,
                })),
            };
        }
        return base;
    });
}

function buildPlainTextWithAnnotations(view: EditorView): string {
    const doc = view.state.doc.toString();
    const annotations = buildAnnotationsJSON(view);
    if (annotations.length === 0) return doc;
    return `${doc}\n\n---\n\n${JSON.stringify(annotations, null, 2)}`;
}

function buildMarkdown(view: EditorView): string {
    const doc = view.state.doc.toString();
    const annots = view.state.field(annotationField);
    const annotList = Object.values(annots);

    if (annotList.length === 0) return doc;

    // Sort annotations by position (descending) so we can insert markers
    // without shifting earlier offsets.
    const sorted = [...annotList].sort((a, b) => annotationRange(b).from - annotationRange(a).from);

    let result = doc;
    const footnotes: string[] = [];

    for (const a of sorted) {
        const { from, to } = annotationRange(a);
        const footnoteIndex = footnotes.length + 1;
        const selectedText = doc.slice(from, to);

        let footnoteContent: string;
        if (isAnnotationOfType(a, "comment")) {
            const messages = a.thread.map((m) => `${m.author}: ${m.message}`).join("; ");
            footnoteContent = `**Comment** on "${selectedText}"${messages ? `: ${messages}` : ""}`;
        } else if (isAnnotationOfType(a, "suggestion")) {
            const replacements = a.replacements.map((r) => `"${r.text}"`).join(", ");
            footnoteContent = `**Suggestion** for "${selectedText}": ${replacements}`;
        } else if (isAnnotationOfType(a, "revision")) {
            const versions = a.versions.map((v, i) => {
                const label = v.label ? ` (${v.label})` : "";
                const active = i === a.activeVersionIndex ? " [active]" : "";
                return `v${i + 1}${label}${active}: "${versionText(v)}"`;
            });
            footnoteContent = `**Revision** — ${versions.join("; ")}`;
        } else {
            continue;
        }

        // Insert footnote reference after the annotated text
        result = `${result.slice(0, to)}[^${footnoteIndex}]${result.slice(to)}`;
        footnotes.push(`[^${footnoteIndex}]: ${footnoteContent}`);
    }

    if (footnotes.length > 0) {
        result += `\n\n---\n\n${footnotes.reverse().join("\n\n")}`;
    }

    return result;
}

const formatBuilders: Record<ExportFormat, (view: EditorView) => string> = {
    txt: buildPlainText,
    json: buildJSON,
    md: buildMarkdown,
    "txt+json": buildPlainTextWithAnnotations,
};

const mimeTypes: Record<ExportFormat, string> = {
    txt: "text/plain",
    json: "application/json",
    md: "text/markdown",
    "txt+json": "text/plain",
};

const fileExtensions: Record<ExportFormat, string> = {
    txt: "txt",
    json: "json",
    md: "md",
    "txt+json": "txt",
};

export function exportDocument(view: EditorView, format: ExportFormat) {
    const title = sanitizeFilename(get(currentDocumentTitle));
    const content = formatBuilders[format](view);
    triggerDownload(content, `${title}.${fileExtensions[format]}`, mimeTypes[format]);
}
