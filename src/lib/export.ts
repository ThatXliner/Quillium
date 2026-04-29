/**
 * export.ts — Document export utilities.
 *
 * Supports exporting the current document as:
 *   - Plain text (.txt) — just the document content
 *   - Text with annotations (.txt) — document content + annotations as JSON after a separator
 *   - JSON (.json) — document content + all annotations
 *   - Markdown (.md) — document text with annotations as footnotes
 *   - PDF (.pdf) — document content only
 *   - PDF + annotations (.pdf) — document content plus styled annotation cards
 *
 * Uses native save dialog via Tauri's dialog plugin.
 */

import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { get } from "svelte/store";
import { annotationField } from "./editor/plugins/annotations";
import {
    isAnnotationOfType,
    versionText,
    RawAnnotationsSchema,
    type GenericAnnotation,
    type VersionState,
} from "./editor/plugins/annotations/models";
import { currentDocumentTitle } from "./stores";
import posthog from "./posthog";

export type ExportFormat =
    | "txt"
    | "json"
    | "md"
    | "txt+json"
    | "pdf"
    | "pdf+annotations";
type TextExportFormat = Exclude<ExportFormat, "pdf" | "pdf+annotations">;

type PdfAnnotationCardKind = "comment" | "suggestion" | "revision" | "version";
type PdfAnnotationCard = {
    kind: PdfAnnotationCardKind;
    title: string;
    subtitle?: string;
    body: string[];
    children: PdfAnnotationCard[];
};

type PdfExportPayload = {
    title: string;
    bodyParagraphs: string[];
    annotations: PdfAnnotationCard[];
};

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

async function savePdfWithDialog(payload: PdfExportPayload, defaultName: string): Promise<boolean> {
    const path = await save({
        defaultPath: defaultName,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) return false;
    await invoke("cmd_export_pdf", { path, payload });
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

type PdfAnnotationLike = {
    _type: "comment" | "suggestion" | "revision";
    selection: { ranges: ReadonlyArray<{ anchor: number; head: number }> };
    thread: Array<{ author: string; message: string }>;
    replacements?: Array<{ text: string; rationale?: string }>;
    activeVersionIndex?: number;
    versions?: VersionState[];
};

function annotationRangeLike(annotation: PdfAnnotationLike): { from: number; to: number } {
    const range = annotation.selection.ranges[0];
    return {
        from: Math.min(range.anchor, range.head),
        to: Math.max(range.anchor, range.head),
    };
}

function threadLines(thread: Array<{ author: string; message: string }>): string[] {
    return thread.map((message) => `${message.author}: ${message.message}`);
}

function nestedVersionAnnotations(version: VersionState): PdfAnnotationLike[] {
    const nested = RawAnnotationsSchema.safeParse(
        (version as { annotationField?: unknown }).annotationField,
    );
    if (!nested.success) return [];
    return Object.values(nested.data) as PdfAnnotationLike[];
}

function sortPdfAnnotations(annotations: PdfAnnotationLike[]): PdfAnnotationLike[] {
    return [...annotations].sort(
        (a, b) => annotationRangeLike(a).from - annotationRangeLike(b).from,
    );
}

function buildPdfVersionCard(
    version: VersionState,
    index: number,
    activeVersionIndex: number,
): PdfAnnotationCard {
    const labelSuffix = version.label ? ` (${version.label})` : "";
    const active = index === activeVersionIndex ? " [active]" : "";

    return {
        kind: "version",
        title: `Version ${index + 1}${labelSuffix}${active}`,
        body: versionText(version) ? [versionText(version)] : [],
        children: buildPdfAnnotationCards(nestedVersionAnnotations(version), version.doc),
    };
}

function buildPdfAnnotationCard(
    annotation: PdfAnnotationLike,
    doc: string,
    index: number,
): PdfAnnotationCard {
    const { from, to } = annotationRangeLike(annotation);
    const selectedText = doc.slice(from, to);
    const label = `${index + 1}. ${annotation._type[0].toUpperCase()}${annotation._type.slice(1)} (${from}-${to})`;
    const body: string[] = [];

    if (annotation._type === "suggestion") {
        const replacements = annotation.replacements ?? [];
        if (replacements.length > 0) {
            body.push("Suggestions:");
            body.push(
                ...replacements.map((replacement) =>
                    replacement.rationale
                        ? `- ${replacement.text} (${replacement.rationale})`
                        : `- ${replacement.text}`,
                ),
            );
        }
    }

    if (annotation.thread.length > 0) {
        body.push(...threadLines(annotation.thread));
    }

    return {
        kind: annotation._type,
        title: label,
        subtitle: `On: "${selectedText}"`,
        body,
        children:
            annotation._type === "revision"
                ? (annotation.versions ?? []).map((version, versionIndex) =>
                      buildPdfVersionCard(
                          version,
                          versionIndex,
                          annotation.activeVersionIndex ?? 0,
                      ),
                  )
                : [],
    };
}

function buildPdfAnnotationCards(
    annotations: PdfAnnotationLike[],
    doc: string,
): PdfAnnotationCard[] {
    return sortPdfAnnotations(annotations).map((annotation, index) =>
        buildPdfAnnotationCard(annotation, doc, index),
    );
}

function buildPdfAnnotations(state: EditorState): PdfAnnotationCard[] {
    return buildPdfAnnotationCards(
        Object.values(state.field(annotationField)) as PdfAnnotationLike[],
        state.doc.toString(),
    );
}

function buildPdfPayload(
    state: EditorState,
    title: string,
    includeAnnotations: boolean,
): PdfExportPayload {
    return {
        title,
        bodyParagraphs: state.doc
            .toString()
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.trimEnd())
            .filter((paragraph) => paragraph.length > 0),
        annotations: includeAnnotations ? buildPdfAnnotations(state) : [],
    };
}

const fileExtensions: Record<ExportFormat, string> = {
    txt: "txt",
    json: "json",
    md: "md",
    "txt+json": "txt",
    pdf: "pdf",
    "pdf+annotations": "pdf",
};

function buildContent(state: EditorState, format: TextExportFormat, title: string): string {
    switch (format) {
        case "txt":
            return buildPlainText(state);
        case "json":
            return buildJSON(state, title);
        case "md":
            return buildMarkdown(state);
        case "txt+json":
            return buildPlainTextWithAnnotations(state);
    }
}

/** Export from an active EditorView (used from the editor). */
export async function exportDocument(view: EditorView, format: ExportFormat) {
    const rawTitle = get(currentDocumentTitle).trim() || "document";
    const safeTitle = sanitizeFilename(rawTitle);
    const saved =
        format === "pdf" || format === "pdf+annotations"
            ? await savePdfWithDialog(
                  buildPdfPayload(view.state, rawTitle, format === "pdf+annotations"),
                  `${safeTitle}.${fileExtensions[format]}`,
              )
            : await saveWithDialog(
                  buildContent(view.state, format, rawTitle),
                  `${safeTitle}.${fileExtensions[format]}`,
                  fileExtensions[format],
              );
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

    const rawTitle = docTitle.trim() || "document";
    const safeTitle = sanitizeFilename(rawTitle);
    const saved =
        format === "pdf" || format === "pdf+annotations"
            ? await savePdfWithDialog(
                  buildPdfPayload(state, rawTitle, format === "pdf+annotations"),
                  `${safeTitle}.${fileExtensions[format]}`,
              )
            : await saveWithDialog(
                  buildContent(state, format, rawTitle),
                  `${safeTitle}.${fileExtensions[format]}`,
                  fileExtensions[format],
              );
    if (saved) {
        posthog.capture("document_exported", { format, source: "library" });
    }
}
