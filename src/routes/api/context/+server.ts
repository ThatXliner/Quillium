import { generateObject } from "ai";
import { z } from "zod";
import { createModel, type Provider } from "$lib/ai/provider";

export async function POST({ request }) {
    const {
        prompt,
        provider,
        model,
        apiKey,
    }: {
        prompt: string;
        provider?: Provider;
        model?: string;
        apiKey?: string;
    } = await request.json();

    const resolvedProvider: Provider = provider ?? "openai";
    const resolvedModel = model ?? "gpt-4o";
    const resolvedKey = apiKey ?? "";

    const { object } = await generateObject({
        model: createModel(resolvedProvider, resolvedKey, resolvedModel),
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
${prompt}`,
    });

    return new Response(JSON.stringify(object), {
        headers: { "Content-Type": "application/json" },
    });
}
