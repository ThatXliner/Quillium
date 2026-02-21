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
  goal?: string;
  tone?: string;
  audience?: string;
  emphasize?: string;
  avoid?: string;
  notes?: string;
};

export function buildDocumentContextPrompt(ctx?: DocumentContext): string {
  if (!ctx) return "";
  const lines: string[] = [];
  if (ctx.goal?.trim()) lines.push(`Goal: ${ctx.goal.trim()}`);
  if (ctx.tone?.trim()) lines.push(`Tone: ${ctx.tone.trim()}`);
  if (ctx.audience?.trim()) lines.push(`Audience: ${ctx.audience.trim()}`);
  if (ctx.emphasize?.trim()) lines.push(`Emphasize: ${ctx.emphasize.trim()}`);
  if (ctx.avoid?.trim()) lines.push(`Avoid: ${ctx.avoid.trim()}`);
  if (ctx.notes?.trim()) lines.push(`Notes: ${ctx.notes.trim()}`);
  if (lines.length === 0) return "";
  return `\n\nDocument context provided by the writer:\n${lines.join("\n")}`;
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
