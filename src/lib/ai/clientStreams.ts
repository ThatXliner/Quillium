/**
 * Client-side AI streaming orchestration.
 *
 * This file contains the core streaming functions that power each AI
 * mode (Chat, Feedback, Revise) plus a non-streaming context generator.
 * All inference runs directly in the browser using the writer's own API
 * key (BYOK) — no server routes are involved.
 *
 * Role in the AI subsystem:
 *   chatFactory.ts creates a `ChatTransport` that delegates to one of
 *   the stream functions here. Each function:
 *     1. Instantiates a `LanguageModel` via `provider.ts`.
 *     2. Builds a system prompt with optional document-context fields.
 *     3. Injects the current editor content / selection as a user msg.
 *     4. Calls `streamText` (or `generateObject` for context) from the
 *        ai SDK.
 *     5. Returns a `ReadableStream<UIMessageChunk>` consumed by the
 *        @ai-sdk/svelte `Chat` class.
 *
 * Tool definitions (Feedback: createComment, createRevision; Revise:
 * createSuggestion, createComment) are declared inline. Tool calls are
 * executed by the ai SDK, and the results are forwarded to
 * `chatFactory.handleToolCall` which applies them to the CodeMirror
 * editor via the annotation system.
 *
 * Dependencies: ai SDK, zod (tool schemas), provider.ts, utils.ts.
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

interface StreamOpts extends BaseOpts {
    messages: UIMessage[];
    documentContent: string;
    selectedText: string;
    documentContext?: DocumentContext;
}

export type ChatStreamOpts = StreamOpts;
export type FeedbackStreamOpts = StreamOpts;
export type ReviseStreamOpts = StreamOpts;

export interface GeneratedContext {
    goal: string;
    tone: string;
    audience: string;
    emphasize: string;
    avoid: string;
    notes: string;
}

// ---------------------------------------------------------------------------
// Shared tools
// ---------------------------------------------------------------------------
const createCommentTool = (description: string) =>
    tool({
        description,
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
    });

// ---------------------------------------------------------------------------
// Shared stream builder
// ---------------------------------------------------------------------------
function buildStream(
    opts: StreamOpts,
    system: string,
    tools?: Parameters<typeof streamText>[0]["tools"],
): ReadableStream<UIMessageChunk> {
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
        system,
        tools,
    });
    return result.toUIMessageStream();
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
export function streamChat(opts: ChatStreamOpts): ReadableStream<UIMessageChunk> {
    return buildStream(
        opts,
        `You are a helpful writing assistant. You have access to the user's current document and any selected text they have highlighted.

When providing feedback:
- Be specific and actionable
- Reference the actual content when relevant
- Suggest concrete improvements
- Help with clarity, flow, grammar, and style
- If text is selected, focus primarily on that selection unless asked otherwise

Keep responses concise but thorough.${buildDocumentContextPrompt(opts.documentContext)}`,
    );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------
export function streamFeedback(opts: FeedbackStreamOpts): ReadableStream<UIMessageChunk> {
    return buildStream(
        opts,
        `You are an editorial writing assistant providing high-level feedback on documents. Your job is to help writers think about the big picture: structure, voice, argument, scope, pacing, and style.${buildDocumentContextPrompt(opts.documentContext)}

When providing feedback:
- Discuss overall document issues conversationally — structure, argument, pacing, tone, scope
- Use createComment to flag specific passages that illustrate a broader issue (e.g. a paragraph that buries the lede, a section that feels off-tone)
- Include concrete alternatives more often: in most feedback responses, give at least one short "try this" rewrite example for a weak passage
- Use createRevision whenever an issue would be clearer with side-by-side options — provide 2-3 labeled versions showing distinct stylistic or structural alternatives, with a thread message explaining the tradeoff between them
- Keep rewrite examples scoped and illustrative (usually 1-2 key passages) so feedback remains diagnosis-first, not full rewrite mode
- Avoid nitpicking grammar or minor wording — that's for the revision tool. Focus on things that affect the reader's experience of the whole piece
- Be specific but editorial: reference the actual text and explain why something works or doesn't
- If text is selected, treat it as the focus but consider how it fits the larger document

Current document length: ${opts.documentContent?.length || 0} characters
${opts.selectedText ? `Selected text: "${opts.selectedText}"` : "No text selected"}`,
        {
            createComment: createCommentTool(
                "Flag a specific passage with editorial feedback — use for observations about how a section affects the overall piece",
            ),
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
    );
}

// ---------------------------------------------------------------------------
// Revise
// ---------------------------------------------------------------------------
export function streamRevise(opts: ReviseStreamOpts): ReadableStream<UIMessageChunk> {
    return buildStream(
        opts,
        `You are a precise line-editor. Your ONLY way to deliver revisions is by calling the createSuggestion tool — never write suggested text in prose.${buildDocumentContextPrompt(opts.documentContext)}

RULES (follow exactly):
1. Call createSuggestion for EVERY improvement you identify — do not describe or quote suggestions in your message text.
2. Be granular: target individual sentences or short phrases, not entire paragraphs. One createSuggestion call per distinct issue.
3. Each call must include at least 2 replacement options so the writer can choose. Mark them with a brief rationale (e.g. "more concise", "stronger verb", "cleaner rhythm").
4. Cover all categories: wordiness, weak verbs, awkward rhythm, redundancy, unclear antecedents, passive voice, clichés, run-ons, and grammar.
5. After all tool calls, write a short prose summary (2-4 sentences) of the patterns you found — but NEVER include suggestion text there.
6. If text is selected, focus exclusively on that selection. Otherwise work through the whole document systematically.

Start by scanning the text, then fire createSuggestion calls in reading order before writing your summary.`,
        {
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
            createComment: createCommentTool(
                "Create a comment to explain revision reasoning or ask clarifying questions",
            ),
        },
    );
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
