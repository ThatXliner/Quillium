/**
 * docxExport.ts — Project the selected draft into a Word document with native comments.
 * The editor state is read only here; inactive revision versions are never exported.
 */

import { EditorState } from "@codemirror/state";
import {
    CommentRangeEnd,
    CommentRangeStart,
    CommentReference,
    Document,
    type ICommentOptions,
    Packer,
    Paragraph,
    type ParagraphChild,
    TextRun,
} from "docx";
import { annotationField } from "./editor/plugins/annotations";
import {
    type GenericAnnotation,
    type ThreadMessage,
    activeVersion,
    isAnnotationOfType,
} from "./editor/plugins/annotations/models";

export type DocxComment = {
    id: number;
    from: number;
    to: number;
    messages: ThreadMessage[];
    heading?: string;
};

export type DocxProjection = {
    text: string;
    comments: DocxComment[];
};

function annotationRange(annotation: GenericAnnotation): { from: number; to: number } {
    const range = annotation.selection.main;
    return { from: range.from, to: range.to };
}

function selectedVersionState(version: ReturnType<typeof activeVersion>): EditorState {
    return EditorState.fromJSON(
        {
            doc: version.doc,
            selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
            annotationField: (version as { annotationField?: unknown }).annotationField,
        },
        { extensions: [annotationField] },
        { annotationField },
    );
}

/** Root text already contains each active revision. Nested version offsets are relative to it. */
export function buildDocxProjection(
    state: EditorState,
    includeAnnotations: boolean,
): DocxProjection {
    const text = state.doc.toString();
    if (!includeAnnotations) return { text, comments: [] };

    const comments: DocxComment[] = [];
    const visit = (editor: EditorState, offset: number, depth: number): void => {
        if (depth > 32) throw new Error("Revision nesting exceeds the Word export limit.");
        for (const annotation of Object.values(editor.field(annotationField))) {
            const { from, to } = annotationRange(annotation);
            const messages = annotation.thread.filter(
                (message) => message.message.trim().length > 0,
            );
            if (annotation.status === "pending" && messages.length === 0) continue;
            let heading: string | undefined;

            if (isAnnotationOfType(annotation, "suggestion")) {
                heading = annotation.replacements
                    .map((replacement) =>
                        replacement.rationale
                            ? `Suggested: ${replacement.text} (${replacement.rationale})`
                            : `Suggested: ${replacement.text}`,
                    )
                    .join("\n");
            }

            if (messages.length > 0 || heading) {
                comments.push({
                    id: comments.length,
                    from: offset + from,
                    to: offset + to,
                    messages,
                    heading,
                });
            }

            if (isAnnotationOfType(annotation, "revision")) {
                const selected = activeVersion(annotation);
                if (!selected) continue;
                const actual = editor.doc.sliceString(from, to);
                if (selected.doc !== actual) {
                    throw new Error(
                        "A selected revision is out of sync with the document. Reopen the draft and retry export.",
                    );
                }
                visit(selectedVersionState(selected), offset + from, depth + 1);
            }
        }
    };
    visit(state, 0, 0);
    return { text, comments };
}

function wordComments(comments: DocxComment[]): {
    children: ICommentOptions[];
    replyIds: Map<number, number[]>;
} {
    let nextId = comments.length;
    const children: ICommentOptions[] = [];
    const replyIds = new Map<number, number[]>();
    for (const comment of comments) {
        const [first, ...replies] = comment.messages;
        const content = [comment.heading, first?.message].filter(Boolean).join("\n\n");
        children.push({
            id: comment.id,
            author: first?.author || "Quillium",
            date: first ? new Date(first.time) : undefined,
            children: content.split(/\r\n|\r|\n/).map((line) => new Paragraph(line)),
        });
        for (const reply of replies) {
            const id = nextId++;
            replyIds.set(comment.id, [...(replyIds.get(comment.id) ?? []), id]);
            children.push({
                id,
                parentId: comment.id,
                author: reply.author || "Quillium",
                date: new Date(reply.time),
                children: reply.message.split(/\r\n|\r|\n/).map((line) => new Paragraph(line)),
            });
        }
    }
    return { children, replyIds };
}

/** Split at every anchor boundary while preserving the source's exact newline positions. */
function bodyParagraphs(projection: DocxProjection, replyIds: Map<number, number[]>): Paragraph[] {
    const { text, comments } = projection;
    const lines = text.split("\n");
    const paragraphs: Paragraph[] = [];
    let start = 0;
    const referenceRuns = (id: number): TextRun[] =>
        [id, ...(replyIds.get(id) ?? [])].map(
            (referenceId) => new TextRun({ children: [new CommentReference(referenceId)] }),
        );

    for (const line of lines) {
        const end = start + line.length;
        const children: ParagraphChild[] = [];
        const boundaries = new Set<number>([start, end]);
        for (const comment of comments) {
            if (comment.from >= start && comment.from <= end) boundaries.add(comment.from);
            if (comment.to >= start && comment.to <= end) boundaries.add(comment.to);
        }
        const sorted = [...boundaries].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length; i++) {
            const position = sorted[i];
            // Close before opening at a shared boundary. Word permits overlapping ranges.
            for (const comment of comments.filter(
                (item) => item.to === position && item.from < item.to,
            )) {
                children.push(new CommentRangeEnd(comment.id), ...referenceRuns(comment.id));
            }
            for (const comment of comments.filter((item) => item.from === position)) {
                children.push(new CommentRangeStart(comment.id));
                if (comment.from === comment.to) {
                    children.push(new CommentRangeEnd(comment.id), ...referenceRuns(comment.id));
                }
            }
            if (i + 1 < sorted.length && sorted[i + 1] > position) {
                children.push(new TextRun(text.slice(position, sorted[i + 1])));
            }
        }
        paragraphs.push(new Paragraph({ children }));
        start = end + 1;
    }
    return paragraphs;
}

export async function renderDocx(projection: DocxProjection, title: string): Promise<Uint8Array> {
    const comments = wordComments(projection.comments);
    const document = new Document({
        title,
        sections: [{ children: bodyParagraphs(projection, comments.replyIds) }],
        comments: projection.comments.length ? { children: comments.children } : undefined,
    });
    return new Uint8Array(await Packer.toArrayBuffer(document));
}
