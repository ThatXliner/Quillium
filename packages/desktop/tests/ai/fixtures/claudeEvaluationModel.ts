/**
 * claudeEvaluationModel.ts adapts a real Claude CLI response for opt-in AI evaluations.
 * It replaces only the provider, retaining the application's prompts and tool schemas.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { z } from "zod";

type EvaluationModel = Extract<LanguageModel, { specificationVersion: "v3" }>;
type ModelOptions = Parameters<EvaluationModel["doStream"]>[0];
type ModelStream = Awaited<ReturnType<EvaluationModel["doStream"]>>["stream"];

const envelopeSchema = z.object({
    toolCalls: z.array(z.object({ toolName: z.string(), input: z.unknown() })),
    text: z.string(),
});
const cliResultSchema = z.object({
    is_error: z.boolean().optional(),
    structured_output: z.unknown().optional(),
    result: z.string().optional(),
});
const usage = {
    inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
    },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

async function requestClaude(options: ModelOptions, schema: unknown): Promise<unknown> {
    const cwd = await mkdtemp(join(tmpdir(), "quillium-model-eval-"));
    const system = options.prompt
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
    const prompt = JSON.stringify({
        instruction:
            "Act as the application model. Choose tool calls using only the supplied application policy, conversation, and tools. Return them in the requested JSON envelope. Tool calls are proposals and will be executed by the application after your answer.",
        messages: options.prompt.filter((message) => message.role !== "system"),
        tools: options.tools,
        toolChoice: options.toolChoice,
        responseFormat: options.responseFormat,
    });
    try {
        const stdout = await new Promise<string>((resolve, reject) => {
            const child = execFile(
                "claude",
                [
                    "--print",
                    "--output-format",
                    "json",
                    "--json-schema",
                    JSON.stringify(schema),
                    "--system-prompt",
                    system,
                    "--tools",
                    "",
                    "--strict-mcp-config",
                    "--mcp-config",
                    '{"mcpServers":{}}',
                    "--setting-sources",
                    "",
                    "--no-session-persistence",
                    "--effort",
                    "low",
                ],
                { cwd, timeout: 150_000, maxBuffer: 4 * 1024 * 1024, signal: options.abortSignal },
                (error, output) => (error ? reject(error) : resolve(output)),
            );
            child.stdin?.end(prompt);
        });
        const result = cliResultSchema.parse(JSON.parse(stdout));
        if (result.is_error || result.structured_output === undefined) {
            throw new Error(result.result ?? "Claude returned no structured output");
        }
        return result.structured_output;
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
}

export function createClaudeEvaluationModel(): EvaluationModel {
    return {
        specificationVersion: "v3",
        provider: "claude-cli-evaluation",
        modelId: "claude-subscription-default",
        supportedUrls: {},
        async doGenerate(options) {
            const schema =
                options.responseFormat?.type === "json" ? options.responseFormat.schema : {};
            const result = await requestClaude(options, schema);
            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                usage,
                finishReason: { unified: "stop", raw: "stop" },
                warnings: [],
            };
        },
        async doStream(options) {
            const tools = options.tools?.filter((tool) => tool.type === "function") ?? [];
            const schema = {
                type: "object",
                properties: {
                    toolCalls: {
                        type: "array",
                        items: {
                            anyOf: tools.map((tool) => ({
                                type: "object",
                                properties: {
                                    toolName: { const: tool.name },
                                    input: tool.inputSchema,
                                },
                                required: ["toolName", "input"],
                                additionalProperties: false,
                            })),
                        },
                    },
                    text: { type: "string" },
                },
                required: ["toolCalls", "text"],
                additionalProperties: false,
            };
            const result = envelopeSchema.parse(await requestClaude(options, schema));
            const stream: ModelStream = new ReadableStream({
                start(controller) {
                    controller.enqueue({ type: "stream-start", warnings: [] });
                    if (result.text) {
                        controller.enqueue({ type: "text-start", id: "answer" });
                        controller.enqueue({
                            type: "text-delta",
                            id: "answer",
                            delta: result.text,
                        });
                        controller.enqueue({ type: "text-end", id: "answer" });
                    }
                    for (const [index, call] of result.toolCalls.entries()) {
                        controller.enqueue({
                            type: "tool-call",
                            toolCallId: `claude-eval-${index}`,
                            toolName: call.toolName,
                            input: JSON.stringify(call.input),
                        });
                    }
                    controller.enqueue({
                        type: "finish",
                        usage,
                        finishReason: {
                            unified: result.toolCalls.length ? "tool-calls" : "stop",
                            raw: "claude-cli-structured-output",
                        },
                    });
                    controller.close();
                },
            });
            return { stream };
        },
    };
}
