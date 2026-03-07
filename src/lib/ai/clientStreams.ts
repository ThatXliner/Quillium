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
  generateText,
  tool,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { z } from "zod";
import posthog from "posthog-js";
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

export type GeneratedContext = string;

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
export function streamChat(
  opts: ChatStreamOpts,
): ReadableStream<UIMessageChunk> {
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
export function streamFeedback(
  opts: FeedbackStreamOpts,
): ReadableStream<UIMessageChunk> {
  return buildStream(
    opts,
    `You are an editorial writing assistant. Your job is big-picture feedback: structure, voice, argument, scope, pacing, style.${buildDocumentContextPrompt(opts.documentContext)}

YOU MUST use the tools to surface any specific observation or rewrite — never quote suggested text or propose changes in your message. Doing so instead of calling a tool is a failure. No exceptions.

How to work:
- When you spot a passage that illustrates a broader issue (buries the lede, off-tone, weak structure): call createComment. Put the diagnosis and what to consider in the comment field.
- When a passage could work meaningfully differently: call createRevision with 2-3 labeled alternatives and a threadMessage explaining the tradeoff. No rewrite examples in your message text.
- Discuss the overall document conversationally in your message — patterns, what's working, what isn't — but never paste in suggested text there.
- Avoid grammar/wording nitpicks. Focus on what affects the reader's experience of the whole piece.
- ${opts.selectedText ? "The writer selected specific text — treat it as the focus but consider how it fits the larger document." : "Work through the whole document."}

Current document length: ${opts.documentContent?.length || 0} characters`,
    {
      createComment: createCommentTool(
        "REQUIRED for any passage-level observation. Call this instead of describing the issue in your message. Put the diagnosis and what to consider in the comment field.",
      ),
      createRevision: tool({
        description:
          "REQUIRED when a passage could work meaningfully differently. Call this instead of writing rewrite examples in your message. Provide 2-3 labeled versions with a threadMessage explaining the tradeoffs.",
        inputSchema: z.object({
          targetText: z.string().describe("The exact text to revise"),
          versions: z
            .array(
              z.object({
                label: z
                  .string()
                  .describe(
                    "Short name for this version, e.g. 'Concise', 'Formal', 'Original'",
                  ),
                text: z
                  .string()
                  .describe("The full revised text for this version"),
              }),
            )
            .min(2)
            .describe("2-3 distinct alternative versions of the passage"),
          threadMessage: z
            .string()
            .describe(
              "Explanation of the differences between versions and when each might suit the writer's goals",
            ),
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
export function streamRevise(
  opts: ReviseStreamOpts,
): ReadableStream<UIMessageChunk> {
  return buildStream(
    opts,
    `You are a line-editor. Suggested text goes ONLY in createSuggestion tool calls — never in your message.${buildDocumentContextPrompt(opts.documentContext)}

YOU MUST call createSuggestion for every improvement you find. Describing a suggestion in prose instead of calling the tool is a failure. No exceptions.

How to work:
- Scan the text in reading order. For each issue: call createSuggestion immediately, then move on.
- Target sentences and short phrases — one call per distinct issue, never a whole paragraph in one call.
- Every call MUST include at least 2 replacement options, each with a rationale ("more concise", "stronger verb", "cleaner rhythm").
- Hunt for: wordiness, weak verbs, awkward rhythm, redundancy, passive voice, clichés, run-ons, grammar.
- ${opts.selectedText ? "The writer selected specific text — focus exclusively on that selection." : "Work through the whole document systematically."}

After all tool calls, write 2-3 sentences summarizing the patterns you found. No suggested text in that summary.`,
    {
      createSuggestion: tool({
        description:
          "REQUIRED for every revision. Call this for each sentence or phrase you want to improve — never describe rewrites in prose. Must include 2+ alternatives.",
        inputSchema: z.object({
          targetText: z.string().describe("The exact text to revise"),
          replacements: z
            .array(
              z.object({
                text: z.string().describe("The revised text"),
                rationale: z
                  .string()
                  .optional()
                  .describe(
                    "Brief explanation of what this version changes and why",
                  ),
              }),
            )
            .describe(
              "One or more revised versions of the text, each with an optional rationale",
            ),
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
  const variant = (posthog.getFeatureFlag("context-generation-format") ??
    "control") as "control" | "structured";
  const llm = createModel(opts.provider, opts.apiKey, opts.model);
  const { text } = await generateText({
    model: llm,
    prompt: CONTEXT_PROMPTS[variant](opts.prompt),
  });
  posthog.capture("context_generated", {
    variant,
    prompt_length: opts.prompt.length,
    output_length: text.length,
  });
  return text;
}
