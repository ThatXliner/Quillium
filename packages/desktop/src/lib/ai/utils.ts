import type { UserModelMessage } from "ai";
import DOMPurify from "dompurify";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
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
import {
    type AiTextRange,
    type AnnotationContextInput,
    type DocumentContextLike,
    buildAiContextPacket,
    contextPacketToUserMessage,
    documentContextText,
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
    const context = documentContextText(ctx);
    if (!context) return "";
    return `\n\nDocument context provided by the writer:\nTreat this as user guidance, not document text.\n${context}`;
}

export function injectDocumentContext({
    documentContent,
    selectedText,
    selectedTextRange,
    documentContext,
    annotationContext,
    mode = "chat",
}: {
    documentContent?: string;
    selectedText?: string;
    selectedTextRange?: AiTextRange;
    documentContext?: DocumentContext;
    annotationContext?: AnnotationContextInput[];
    mode?: Parameters<typeof buildAiContextPacket>[0]["mode"];
}) {
    const packet = buildAiContextPacket({
        mode,
        documentContent,
        selectedText,
        selectedTextRange,
        documentContext,
        annotationContext,
    });
    return contextPacketToUserMessage(packet) as UserModelMessage;
}
