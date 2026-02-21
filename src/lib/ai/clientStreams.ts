/**
 * Client-side AI stream helpers.
 *
 * Replaces the former /api/chat, /api/feedback, /api/revise, /api/context
 * server routes. All inference runs directly in the browser using the user's
 * own API key (BYOK). No server-side relay is needed.
 */
import {
    convertToModelMessages,
    streamText,
    generateObject,
    tool,
    type UIMessage,
    type UIMessageChunk,
} from "ai";
import { z } from "zod";
import { createModel, type Provider } from "./provider";
import { injectDocumentContext, buildDocumentContextPrompt } from "./utils";

type DocumentContext = Record<string, string> | undefined;

interface BaseOpts {
    provider: Provider;
    model: string;
    apiKey: string;
}

interface ChatStreamOpts extends BaseOpts {
    messages: UIMessage[];
    documentContent: string;
    selectedText: string;
    documentContext?: DocumentContext;
}

interface FeedbackStreamOpts extends BaseOpts {
    messages: UIMessage[];
    documentContent: string;
    selectedText: string;
    documentContext?: DocumentContext;
}

interface ReviseStreamOpts extends BaseOpts {
    messages: UIMessage[];
    documentContent: string;
    selectedText: string;
    documentContext?: DocumentContext;
}

export interface GeneratedContext {
    goal: string;
    tone: string;
    audience: string;
    emphasize: string;
    avoid: string;
    notes: string;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
export function streamChat(opts: ChatStreamOpts): ReadableStream<UIMessageChunk> {
    const llm = createModel(opts.provider, opts.apiKey, opts.model);
    const result = streamText({
        model: llm,
        messages: [
            ...convertToModelMessages(opts.messages),
            injectDocumentContext({
                documentContent: opts.documentContent,
                selectedText: opts.selectedText,
            }),
        ],
        system: `You are a helpful writing assistant. You have access to the user's current document and any selected text they have highlighted.

When providing feedback:
- Be specific and actionable
- Reference the actual content when relevant
- Suggest concrete improvements
- Help with clarity, flow, grammar, and style
- If text is selected, focus primarily on that selection unless asked otherwise

Keep responses concise but thorough.${buildDocumentContextPrompt(opts.documentContext)}`,
    });
    return result.toUIMessageStream();
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------
export function streamFeedback(opts: FeedbackStreamOpts): ReadableStream<UIMessageChunk> {
    const llm = createModel(opts.provider, opts.apiKey, opts.model);
    const result = streamText({
        model: llm,
        messages: [
            ...convertToModelMessages(opts.messages),
            injectDocumentContext({
                documentContent: opts.documentContent,
                selectedText: opts.selectedText,
            }),
        ],
        system: `You are an editorial writing assistant providing high-level feedback on documents. Your job is to help writers think about the big picture: structure, voice, argument, scope, pacing, and style.${buildDocumentContextPrompt(opts.documentContext)}

When providing feedback:
- Discuss overall document issues conversationally — structure, argument, pacing, tone, scope
- Use createComment to flag specific passages that illustrate a broader issue (e.g. a paragraph that buries the lede, a section that feels off-tone)
- Use createRevision when a passage could benefit from a meaningfully different approach — provide 2-3 labeled versions showing distinct stylistic or structural alternatives, with a thread message explaining the tradeoff between them
- Avoid nitpicking grammar or minor wording — that's for the revision tool. Focus on things that affect the reader's experience of the whole piece
- Be specific but editorial: reference the actual text and explain why something works or doesn't
- If text is selected, treat it as the focus but consider how it fits the larger document

Current document length: ${opts.documentContent?.length || 0} characters
${opts.selectedText ? `Selected text: "${opts.selectedText}"` : "No text selected"}`,
        tools: {
            createComment: tool({
                description:
                    "Flag a specific passage with editorial feedback — use for observations about how a section affects the overall piece",
                inputSchema: z.object({
                    targetText: z.string().describe("The exact text to comment on"),
                    comment: z.string().describe("The editorial feedback or observation"),
                }),
                execute: async ({ targetText, comment }) => ({
                    type: "comment",
                    targetText,
                    comment,
                    timestamp: Date.now(),
                }),
            }),
            createRevision: tool({
                description:
                    "Propose meaningful alternative approaches to a passage — use when a section could work very differently depending on the writer's intent. Provide 2-3 labeled versions with a message explaining the tradeoffs.",
                inputSchema: z.object({
                    targetText: z.string().describe("The exact text to revise"),
                    versions: z
                        .array(z.object({
                            label: z.string().describe("Short name for this version, e.g. 'Concise', 'Formal', 'Original'"),
                            text: z.string().describe("The full revised text for this version"),
                        }))
                        .min(2)
                        .describe("2-3 distinct alternative versions of the passage"),
                    threadMessage: z
                        .string()
                        .describe("Explanation of the differences between versions and when each might suit the writer's goals"),
                }),
                execute: async ({ targetText, versions, threadMessage }) => ({
                    type: "revision",
                    targetText,
                    versions,
                    threadMessage,
                    timestamp: Date.now(),
                }),
            }),
        },
    });
    return result.toUIMessageStream();
}

// ---------------------------------------------------------------------------
// Revise
// ---------------------------------------------------------------------------
export function streamRevise(opts: ReviseStreamOpts): ReadableStream<UIMessageChunk> {
    const llm = createModel(opts.provider, opts.apiKey, opts.model);
    const result = streamText({
        model: llm,
        messages: [
            ...convertToModelMessages(opts.messages),
            injectDocumentContext({
                documentContent: opts.documentContent,
                selectedText: opts.selectedText,
            }),
        ],
        system: `You are a helpful writing assistant focused on revising and rewriting text. Your goal is to improve flow, conciseness, clarity, and overall quality.${buildDocumentContextPrompt(opts.documentContext)}

When revising text:
- Use createSuggestion to propose specific rewrites and improvements
- Focus on making text more concise, clear, and engaging
- Improve sentence structure and flow
- Fix grammar and style issues
- Maintain the original meaning and tone unless specifically asked to change it
- Provide multiple alternatives when possible
- If text is selected, focus on revising that selection`,
        tools: {
            createSuggestion: tool({
                description: "Create a suggestion with revised/rewritten text",
                inputSchema: z.object({
                    targetText: z.string().describe("The exact text to revise"),
                    replacements: z
                        .array(z.object({
                            text: z.string().describe("The revised text"),
                            rationale: z.string().optional().describe("Brief explanation of what this version changes and why"),
                        }))
                        .describe("One or more revised versions of the text, each with an optional rationale"),
                    comment: z
                        .string()
                        .optional()
                        .describe("Optional overall explanation of the revision"),
                }),
                execute: async ({ targetText, replacements, comment }) => ({
                    type: "suggestion",
                    targetText,
                    replacements,
                    comment,
                    timestamp: Date.now(),
                }),
            }),
            createComment: tool({
                description:
                    "Create a comment to explain revision reasoning or ask clarifying questions",
                inputSchema: z.object({
                    targetText: z.string().describe("The text to comment on"),
                    comment: z.string().describe("The comment or question"),
                }),
                execute: async ({ targetText, comment }) => ({
                    type: "comment",
                    targetText,
                    comment,
                    timestamp: Date.now(),
                }),
            }),
        },
    });
    return result.toUIMessageStream();
}

// ---------------------------------------------------------------------------
// Context generation (non-streaming)
// ---------------------------------------------------------------------------
export async function generateContext(
    opts: BaseOpts & { prompt: string },
): Promise<GeneratedContext> {
    const llm = createModel(opts.provider, opts.apiKey, opts.model);
    const { object } = await generateObject({
        model: llm,
        schema: z.object({
            goal: z.string().describe("What this piece of writing needs to accomplish — the core purpose or objective"),
            tone: z.string().describe("The voice, register, and emotional quality the writing should have"),
            audience: z.string().describe("Who will read this and what they're looking for"),
            emphasize: z.string().describe("What to foreground — themes, qualities, arguments, or details that should be prominent"),
            avoid: z.string().describe("Common pitfalls, off-tone moves, or things that would undermine this piece"),
            notes: z.string().describe("Any other important context, constraints, or strategic considerations"),
        }),
        prompt: `You are helping a writer understand the strategic requirements of their writing task.

Analyze the following writing prompt or brief and generate a focused document profile that will guide AI writing assistance. Be specific and actionable — think like an experienced editor who has seen many pieces succeed or fail at this kind of task.

Writing prompt / brief:
${opts.prompt}`,
    });
    return object;
}
