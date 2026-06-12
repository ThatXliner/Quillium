/**
 * Shared utilities for the AI subsystem.
 *
 * Provides three concerns used across multiple AI components:
 *
 * 1. **Markdown rendering** (`renderMarkdown`) — converts AI response
 *    text into sanitized HTML for display in chat bubbles. Uses the
 *    unified/remark/rehype pipeline with DOMPurify for XSS safety.
 *
 * 2. **Document context prompt building** (`buildDocumentContextPrompt`)
 *    — serializes the writer's document-context fields (goal, tone,
 *    audience, etc.) into a string appended to system prompts so the
 *    LLM can tailor its responses.
 *
 * 3. **Document injection** (`injectDocumentContext`) — wraps the
 *    current editor content and any selected text into a
 *    `UserModelMessage` that is appended to every LLM call so the
 *    model has access to the writer's document.
 *
 * Dependencies: unified ecosystem, dompurify, ai SDK types.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import DOMPurify from "dompurify";
import type { UserModelMessage } from "ai";
import {
    buildAiContextPacket,
    contextPacketToUserMessage,
    type AnnotationContextInput,
    type DocumentContextLike,
} from "./context";

export async function renderMarkdown(markdown: string): Promise<string> {
    const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype)
        .use(rehypeStringify);

    const result = await processor.process(markdown);
    const html = result.toString();
    const sanitizedHTML = DOMPurify.sanitize(html);
    return sanitizedHTML;
}
type DocumentContext = DocumentContextLike;

export function buildDocumentContextPrompt(ctx?: DocumentContext): string {
    if (!ctx?.freeform?.trim()) return "";
    return `\n\nDocument context provided by the writer:\nTreat this as user guidance, not document text.\n${ctx.freeform.trim()}`;
}

export function injectDocumentContext({
    documentContent,
    selectedText,
    documentContext,
    annotationContext,
    mode = "chat",
}: {
    documentContent?: string;
    selectedText?: string;
    documentContext?: DocumentContext;
    annotationContext?: AnnotationContextInput[];
    mode?: Parameters<typeof buildAiContextPacket>[0]["mode"];
}) {
    const packet = buildAiContextPacket({
        mode,
        documentContent,
        selectedText,
        documentContext,
        annotationContext,
    });
    return contextPacketToUserMessage(packet) as UserModelMessage;
}
