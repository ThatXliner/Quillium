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
type DocumentContext = {
  freeform?: string;
};

export function buildDocumentContextPrompt(ctx?: DocumentContext): string {
  if (!ctx?.freeform?.trim()) return "";
  return `\n\nDocument context provided by the writer:\n${ctx.freeform.trim()}`;
}

export function injectDocumentContext({
  documentContent,
  selectedText,
}: {
  documentContent?: string;
  selectedText?: string;
}) {
  let contextualPrompt = "";
  if (documentContent) {
    contextualPrompt += `Current document:\n\`\`\`\n${documentContent}\n\`\`\`\n`;
  }

  if (selectedText) {
    contextualPrompt += `\n\nCurrently selected text:\n\`\`\`\n${selectedText}\n\`\`\`\n`;
  }
  return { role: "user", content: contextualPrompt } as UserModelMessage;
}
