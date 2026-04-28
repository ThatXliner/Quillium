/**
 * export.ts — Document export utilities.
 *
 * Supports exporting the current document as:
 *   - Plain text (.txt) — just the document content
 *   - Text with annotations (.txt) — document content + annotations as JSON after a separator
 *   - JSON (.json) — document content + all annotations
 *   - Markdown (.md) — document text with annotations as footnotes
 *
 * Uses native save dialog via Tauri's dialog plugin.
 */

import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { get } from "svelte/store";
import { annotationField } from "./editor/plugins/annotations";
import {
    isAnnotationOfType,
    versionText,
    type GenericAnnotation,
} from "./editor/plugins/annotations/models";
import { currentDocumentTitle } from "./stores";
import posthog from "./posthog";

export type ExportFormat = "txt" | "json" | "md" | "txt+json" | "pdf";

async function saveWithDialog(
    content: string,
    defaultName: string,
    extension: string,
): Promise<boolean> {
    const filterName =
        extension === "txt"
            ? "Text"
            : extension === "json"
              ? "JSON"
            : extension === "md"
                ? "Markdown"
                : extension === "pdf"
                  ? "PDF"
                : "Text";
    const path = await save({
        defaultPath: defaultName,
        filters: [{ name: filterName, extensions: [extension] }],
    });
    if (!path) return false;
    await writeTextFile(path, content);
    return true;
}

function sanitizeFilename(title: string): string {
    return title.replace(/[/\\?%*:|"<>]/g, "-").trim() || "document";
}

function annotationRange(annotation: GenericAnnotation): { from: number; to: number } {
    const range = annotation.selection.ranges[0];
    return { from: range.from, to: range.to };
}

function buildPlainText(state: EditorState): string {
    return state.doc.toString();
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function buildJSON(state: EditorState, title: string): string {
    return JSON.stringify(
        {
            title,
            exportedAt: new Date().toISOString(),
            text: state.doc.toString(),
            annotations: buildAnnotationsJSON(state),
        },
        null,
        2,
    );
}

function buildAnnotationsJSON(state: EditorState): object[] {
    const doc = state.doc.toString();
    const annots = state.field(annotationField);

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

function buildPlainTextWithAnnotations(state: EditorState): string {
    const doc = state.doc.toString();
    const annotations = buildAnnotationsJSON(state);
    if (annotations.length === 0) return doc;
    return `${doc}\n\n---\n\n${JSON.stringify(annotations, null, 2)}`;
}

function buildMarkdown(state: EditorState): string {
    const doc = state.doc.toString();
    const annots = state.field(annotationField);
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

function buildPdfAnnotationLines(state: EditorState): string[] {
    const doc = state.doc.toString();
    const annots = state.field(annotationField);
    const sorted = Object.values(annots).sort((a, b) => annotationRange(a).from - annotationRange(b).from);

    return sorted.flatMap((a, index) => {
        const { from, to } = annotationRange(a);
        const selectedText = doc.slice(from, to);
        const label = `${index + 1}. ${a._type[0].toUpperCase()}${a._type.slice(1)} (${from}-${to})`;

        if (isAnnotationOfType(a, "comment")) {
            const messages = a.thread.map((m) => `${m.author}: ${m.message}`).join("\n");
            return [`${label}\nOn: "${selectedText}"${messages ? `\n${messages}` : ""}`];
        }

        if (isAnnotationOfType(a, "suggestion")) {
            const replacements = a.replacements.map((r) => r.text).join(", ");
            return [`${label}\nOn: "${selectedText}"\nSuggestions: ${replacements}`];
        }

        if (isAnnotationOfType(a, "revision")) {
            const versions = a.versions.map((v, i) => {
                const labelSuffix = v.label ? ` (${v.label})` : "";
                const active = i === a.activeVersionIndex ? " [active]" : "";
                return `v${i + 1}${labelSuffix}${active}: ${versionText(v)}`;
            });
            return [`${label}\nOn: "${selectedText}"\n${versions.join("\n")}`];
        }

        return [];
    });
}

function buildPdfHtml(state: EditorState, title: string): string {
    const docText = state.doc.toString();
    const annotationLines = buildPdfAnnotationLines(state);
    const bodyParagraphs = docText
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trimEnd())
        .filter((paragraph) => paragraph.length > 0);
    const renderedBody =
        bodyParagraphs.length > 0
            ? bodyParagraphs
                  .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
                  .join("\n")
            : "<p></p>";
    const renderedAnnotations =
        annotationLines.length > 0
            ? `
        <section class="annotations">
            <h2>Annotations</h2>
            ${annotationLines.map((line) => `<article>${escapeHtml(line)}</article>`).join("\n")}
        </section>`
            : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
        :root {
            color-scheme: light;
            font-family: "Georgia", "Times New Roman", serif;
        }

        @page {
            margin: 0.75in;
            size: auto;
        }

        body {
            margin: 0;
            color: #1f2937;
            background: white;
        }

        main {
            max-width: 7in;
            margin: 0 auto;
        }

        h1 {
            font-size: 24pt;
            margin: 0 0 0.35in;
            line-height: 1.1;
        }

        h2 {
            font-size: 15pt;
            margin: 0 0 0.2in;
        }

        .document {
            white-space: pre-wrap;
            font-size: 12pt;
            line-height: 1.7;
        }

        .document p {
            margin: 0 0 0.18in;
        }

        .annotations {
            margin-top: 0.45in;
            border-top: 1px solid #d1d5db;
            padding-top: 0.25in;
        }

        .annotations article {
            white-space: pre-wrap;
            break-inside: avoid;
            margin: 0 0 0.18in;
            padding: 0.14in 0.16in;
            background: #f8fafc;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
        }
    </style>
</head>
<body>
    <main>
        <h1>${escapeHtml(title)}</h1>
        <section class="document">
            ${renderedBody}
        </section>
        ${renderedAnnotations}
    </main>
</body>
</html>`;
}

async function printToPdf(html: string): Promise<boolean> {
    if (typeof window === "undefined") return false;

    const printWindow = window.open("", "_blank", "popup,width=900,height=1200");
    if (!printWindow) return false;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    await new Promise((resolve) => window.setTimeout(resolve, 50));

    try {
        printWindow.focus();
        printWindow.print();
        window.setTimeout(() => {
            try {
                printWindow.close();
            } catch {
                // Ignore close failures after the system print flow opens.
            }
        }, 1000);
        return true;
    } catch {
        try {
            printWindow.close();
        } catch {
            // Ignore close failures when print setup failed.
        }
        return false;
    }
}

const fileExtensions: Record<ExportFormat, string> = {
    txt: "txt",
    json: "json",
    md: "md",
    "txt+json": "txt",
    pdf: "pdf",
};

function buildContent(state: EditorState, format: ExportFormat, title: string): string {
    switch (format) {
        case "txt":
            return buildPlainText(state);
        case "json":
            return buildJSON(state, title);
        case "md":
            return buildMarkdown(state);
        case "txt+json":
            return buildPlainTextWithAnnotations(state);
        case "pdf":
            return buildPdfHtml(state, title);
    }
}

/** Export from an active EditorView (used from the editor). */
export async function exportDocument(view: EditorView, format: ExportFormat) {
    const title = sanitizeFilename(get(currentDocumentTitle));
    const content = buildContent(view.state, format, title);
    const saved =
        format === "pdf"
            ? await printToPdf(content)
            : await saveWithDialog(content, `${title}.${fileExtensions[format]}`, fileExtensions[format]);
    if (saved) {
        posthog.capture("document_exported", { format });
    }
}

/** Export a document by loading its state from the database. */
export async function exportDocumentById(docId: string, docTitle: string, format: ExportFormat) {
    const { listDrafts, loadDocumentState } = await import("./db");
    const { replayEvents } = await import("./editor/replay");
    const { history, historyField } = await import("@codemirror/commands");
    const { EditorState } = await import("@codemirror/state");
    const { annotationField } = await import("./editor/plugins/annotations");

    const drafts = await listDrafts(docId);
    const active = drafts.find((d) => d.isActive) ?? drafts[0];
    if (!active) return;

    const loaded = await loadDocumentState(docId, active.id);

    const extensions = [history(), annotationField];
    let state: EditorState;
    if (loaded.snapshotStateJson && loaded.snapshotStateJson !== "{}") {
        try {
            state = EditorState.fromJSON(
                JSON.parse(loaded.snapshotStateJson),
                { extensions },
                { historyField, annotationField },
            );
        } catch {
            state = EditorState.create({ extensions });
        }
    } else {
        state = EditorState.create({ extensions });
    }

    if (loaded.eventsSince.length > 0) {
        state = replayEvents(state, loaded.eventsSince);
    }

    const title = sanitizeFilename(docTitle);
    const content = buildContent(state, format, title);
    const saved =
        format === "pdf"
            ? await printToPdf(content)
            : await saveWithDialog(content, `${title}.${fileExtensions[format]}`, fileExtensions[format]);
    if (saved) {
        posthog.capture("document_exported", { format, source: "library" });
    }
}
