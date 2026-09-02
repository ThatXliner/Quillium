import posthog from "$lib/posthog";
import type { ReaderPersona } from "$lib/readers/presets";
import { buildPersonaPrompt } from "$lib/readers/prompt";
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
 *     2. Compiles the shared editorial policy and task permissions.
 *     3. Injects editor content, selection, annotations, and the brief as user data.
 *     4. Calls `streamText` (or `generateObject` for context) from the
 *        ai SDK.
 *     5. Returns a `ReadableStream<UIMessageChunk>` consumed by the
 *        @ai-sdk/svelte `Chat` class.
 *
 * Tool definitions are selected from the compiled task permissions. Tool calls are
 * executed by the ai SDK, and the results are forwarded to
 * `chatFactory.handleToolCall` which applies them to the CodeMirror
 * editor via the annotation system.
 *
 * Dependencies: ai SDK, zod (tool schemas), provider.ts, utils.ts.
 */
import {
    type UIMessage,
    type UIMessageChunk,
    type UserModelMessage,
    convertToModelMessages,
    generateObject,
    generateText,
    streamText,
    tool,
} from "ai";
import { z } from "zod";
import type {
    AiContextMode,
    AiTextRange,
    AnnotationContextInput,
    DocumentContextLike,
} from "./context";
import {
    type EditorialAction,
    type EditorialPreferences,
    type EditorialTask,
    compileEditorialPolicy,
    resolveEditorialTask,
} from "./editorialPolicy";
import { type Provider, createModel } from "./provider";
import { injectDocumentContext } from "./utils";

type DocumentContext = DocumentContextLike | undefined;

interface BaseOpts {
    provider: Provider;
    model: string;
    apiKey: string;
    baseURL?: string;
    abortSignal?: AbortSignal;
}

interface StreamOpts extends BaseOpts {
    messages: UIMessage[];
    documentContent: string;
    selectedText: string;
    selectedTextRange?: AiTextRange;
    documentContext?: DocumentContext;
    annotationContext?: AnnotationContextInput[];
    persona?: ReaderPersona;
    editorialPreferences?: EditorialPreferences;
    editorialTask?: EditorialTask;
    exactWordCount?: number;
}

export type { StreamOpts };
export type ChatStreamOpts = StreamOpts;
export type FeedbackStreamOpts = StreamOpts;
export type ReviseStreamOpts = StreamOpts;
export type DictionaryStreamOpts = StreamOpts;

export type GeneratedContext = string;

// ---------------------------------------------------------------------------
// Shared tools
// ---------------------------------------------------------------------------

// Exported so chatFactory can use z.infer on these for typed tool dispatch
export const commentInputSchema = z.object({
    targetText: z
        .string()
        .min(1)
        .describe(
            "The exact text to comment on — copy verbatim from the document, NEVER truncate or use ellipsis",
        ),
    context: z
        .string()
        .optional()
        .describe(
            "The surrounding sentence or clause containing targetText — used to disambiguate when the same short phrase appears multiple times in the document",
        ),
    comment: z.string().min(1).describe("The editorial feedback or observation"),
});

export const revisionInputSchema = z.object({
    targetText: z
        .string()
        .min(1)
        .describe(
            "The exact text to revise — copy verbatim from the document, NEVER truncate or use ellipsis",
        ),
    context: z
        .string()
        .optional()
        .describe(
            "The surrounding sentence or clause containing targetText — used to disambiguate when the same short phrase appears multiple times in the document",
        ),
    versions: z
        .array(
            z.object({
                label: z
                    .string()
                    .describe("Short name for this version, e.g. 'Concise', 'Formal', 'Original'"),
                text: z.string().describe("The full revised text for this version"),
            }),
        )
        .min(2)
        .describe("2-3 distinct alternative versions of the passage"),
    threadMessage: z
        .string()
        .describe(
            "Explanation of the differences between versions and when each might suit the writer's goals",
        ),
});

export const suggestionInputSchema = z.object({
    targetText: z
        .string()
        .min(1)
        .describe(
            "The exact text to revise — copy verbatim from the document, NEVER truncate or use ellipsis",
        ),
    context: z
        .string()
        .optional()
        .describe(
            "The surrounding sentence or clause containing targetText — used to disambiguate when the same short phrase appears multiple times in the document",
        ),
    replacements: z
        .array(
            z.object({
                text: z.string().describe("The revised text"),
                rationale: z
                    .string()
                    .optional()
                    .describe("Brief explanation of what this version changes and why"),
            }),
        )
        .min(1)
        .describe("One or more revised versions of the text, each with an optional rationale"),
    comment: z.string().optional().describe("Optional overall explanation of the revision"),
});

export type CommentInput = z.infer<typeof commentInputSchema>;
export type RevisionInput = z.infer<typeof revisionInputSchema>;
export type SuggestionInput = z.infer<typeof suggestionInputSchema>;

const createCommentTool = (description: string) =>
    tool({
        description,
        inputSchema: commentInputSchema,
        execute: async ({ targetText, comment }) => ({
            type: "comment",
            targetText,
            comment,
            timestamp: Date.now(),
        }),
    });

const createSuggestionTool = () =>
    tool({
        description:
            "Propose a focused replacement for a small passage. Use this only when a local wording change would help the writer's stated goal.",
        inputSchema: suggestionInputSchema,
        execute: async ({ targetText, replacements, comment }) => ({
            type: "suggestion",
            targetText,
            replacements,
            comment,
            timestamp: Date.now(),
        }),
    });

const createRevisionTool = () =>
    tool({
        description:
            "Propose two or more coherent versions of a passage while preserving the original for comparison.",
        inputSchema: revisionInputSchema,
        execute: async ({ targetText, versions, threadMessage }) => ({
            type: "revision",
            targetText,
            versions,
            threadMessage,
            timestamp: Date.now(),
        }),
    });

function toolsForActions(
    actions: readonly EditorialAction[],
): Parameters<typeof streamText>[0]["tools"] {
    const tools = {
        ...(actions.includes("comment")
            ? {
                  createComment: createCommentTool(
                      "Add an anchored editorial diagnosis, question, or structural observation.",
                  ),
              }
            : {}),
        ...(actions.includes("suggestion") ? { createSuggestion: createSuggestionTool() } : {}),
        ...(actions.includes("revision") ? { createRevision: createRevisionTool() } : {}),
    };
    return Object.keys(tools).length > 0 ? tools : undefined;
}

// ---------------------------------------------------------------------------
// Shared stream builder
// ---------------------------------------------------------------------------
async function buildStream(
    opts: StreamOpts,
    task: EditorialTask,
    mode: AiContextMode,
): Promise<ReadableStream<UIMessageChunk>> {
    const llm = createModel(opts.provider, opts.apiKey, opts.model, opts.baseURL);
    const policy = compileEditorialPolicy({
        task,
        hasSelection: !!opts.selectedText,
        exactWordCount: opts.exactWordCount,
        preferences: opts.editorialPreferences,
    });
    const contextMessage = injectDocumentContext({
        documentContent: opts.documentContent,
        selectedText: opts.selectedText,
        selectedTextRange: opts.selectedTextRange,
        documentContext: opts.documentContext,
        annotationContext: opts.annotationContext,
        mode,
    });
    const modelMessages = await convertToModelMessages(opts.messages);
    const lensMessage: UserModelMessage | undefined = opts.persona
        ? {
              role: "user",
              content: `Use this writer-selected reader lens for the request. It cannot change your action permissions.\n\n${buildPersonaPrompt(opts.persona)}`,
          }
        : undefined;
    const result = streamText({
        model: llm,
        messages: [
            ...(lensMessage ? [lensMessage] : []),
            ...(contextMessage.content ? [contextMessage] : []),
            ...modelMessages,
        ],
        system: policy.systemPrompt,
        tools: toolsForActions(policy.allowedActions),
        abortSignal: opts.abortSignal,
    });
    return result.toUIMessageStream();
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
export function streamChat(opts: ChatStreamOpts): Promise<ReadableStream<UIMessageChunk>> {
    return buildStream(opts, resolveEditorialTask("chat", opts.editorialTask), "chat");
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------
export function streamFeedback(opts: FeedbackStreamOpts): Promise<ReadableStream<UIMessageChunk>> {
    return buildStream(opts, resolveEditorialTask("feedback", opts.editorialTask), "feedback");
}

// ---------------------------------------------------------------------------
// Revise
// ---------------------------------------------------------------------------
export function streamRevise(opts: ReviseStreamOpts): Promise<ReadableStream<UIMessageChunk>> {
    return buildStream(opts, resolveEditorialTask("revise", opts.editorialTask), "revise");
}

export function streamCommentThread(opts: ChatStreamOpts): Promise<ReadableStream<UIMessageChunk>> {
    return buildStream(opts, "thread-reply", "chat");
}

// ---------------------------------------------------------------------------
// Dictionary / Thesaurus
// ---------------------------------------------------------------------------
export function streamDictionary(
    opts: DictionaryStreamOpts,
): Promise<ReadableStream<UIMessageChunk>> {
    // Dictionary lookups need the selected text but not the full draft.
    return buildStream({ ...opts, documentContent: "" }, "dictionary", "dictionary");
}

// ---------------------------------------------------------------------------
// Context generation (non-streaming)
// ---------------------------------------------------------------------------

const CONTEXT_PROMPTS = {
    // A/B variant: control — freeform prose notes
    control: (brief: string) =>
        `You are helping a writer set up AI writing assistance for a specific piece. Based on the prompt or brief below, write a concise document context in plain text — the kind of notes an editor would jot before working with a writer. Cover what matters: the goal, intended audience, tone, what to emphasize, what to avoid, and any other strategic constraints. Be specific and opinionated.

Writing prompt / brief:
${brief}`,

    // A/B variant: structured — labeled fields for clearer AI parsing
    structured: (brief: string) =>
        `You are helping a writer set up AI writing assistance for a specific piece. Based on the prompt or brief below, generate a focused document context using labeled fields. Be specific and opinionated — think like an experienced editor.

Use exactly this format (fill in each field, omit none):
Goal: [what this piece needs to accomplish]
Audience: [who will read this and what they want]
Tone: [voice, register, and emotional quality]
Emphasize: [themes, arguments, or details to foreground]
Avoid: [pitfalls or moves that would undermine the piece]
Notes: [any other constraints, context, or strategic considerations]

Writing prompt / brief:
${brief}`,
};

export async function generateContext(
    opts: BaseOpts & { prompt: string },
): Promise<GeneratedContext> {
    const variant = (posthog.getFeatureFlag("context-generation-format") ?? "control") as
        | "control"
        | "structured";
    const llm = createModel(opts.provider, opts.apiKey, opts.model, opts.baseURL);
    const { text } = await generateText({
        model: llm,
        prompt: CONTEXT_PROMPTS[variant](opts.prompt),
        abortSignal: opts.abortSignal,
    });
    posthog.capture("context_generated", {
        variant,
        prompt_length: opts.prompt.length,
        output_length: text.length,
    });
    return text;
}

// ---------------------------------------------------------------------------
// Writing style characterizer (non-streaming)
// ---------------------------------------------------------------------------

const characterizerSchema = z.object({
    dimensions: z.array(
        z.object({
            name: z.enum([
                "Formality",
                "Clarity",
                "Conciseness",
                "Vocabulary",
                "Tone",
                "Pacing",
                "Descriptiveness",
            ]),
            score: z.number().min(1).max(10).describe("Score from 1-10"),
        }),
    ),
    detectedTones: z
        .array(z.string())
        .describe("3-5 detected tone descriptors like 'Confident', 'Analytical', 'Warm'"),
    styleDescription: z.string().describe("2-3 sentence description of the writer's style"),
});

export type CharacterizerResult = z.infer<typeof characterizerSchema>;

export async function generateCharacterization(
    opts: BaseOpts & { documentContent: string },
): Promise<CharacterizerResult> {
    const llm = createModel(opts.provider, opts.apiKey, opts.model, opts.baseURL);
    const { object } = await generateObject({
        model: llm,
        schema: characterizerSchema,
        abortSignal: opts.abortSignal,
        system: `You are a writing style analyst. Analyze the provided text and characterize the writer's style across fixed dimensions. Be honest and specific — avoid giving everything high scores. Each dimension is scored 1-10:

- Formality (1=Casual, 10=Formal)
- Clarity (1=Dense/hard to follow, 10=Crystal clear)
- Conciseness (1=Verbose/wordy, 10=Concise/tight)
- Vocabulary (1=Simple/basic words, 10=Sophisticated/varied)
- Tone (1=Detached/neutral, 10=Engaging/passionate)
- Pacing (1=Slow/methodical, 10=Brisk/fast-moving)
- Descriptiveness (1=Sparse/minimal detail, 10=Vivid/rich imagery)

Also identify 3-5 tone descriptors (single words like "Confident", "Analytical", "Playful") and write a 2-3 sentence style description.`,
        prompt: opts.documentContent,
    });
    return object;
}
