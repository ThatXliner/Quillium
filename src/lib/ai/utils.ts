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
