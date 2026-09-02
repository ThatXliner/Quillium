/** provenance.ts — Request metadata attached to AI-created editorial work. */
import type { AiGenerationProvenance } from "$lib/editor/plugins/annotations/models";
import type { Provider } from "./provider";

export type ProvenanceTask = AiGenerationProvenance["task"];

function newRequestId(): string {
    if (typeof globalThis.crypto?.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createAiGenerationProvenance({
    task,
    provider,
    model,
    persona,
    requestId = newRequestId(),
    createdAt = Date.now(),
}: {
    task: ProvenanceTask;
    provider: Provider;
    model: string;
    persona?: string;
    requestId?: string;
    createdAt?: number;
}): AiGenerationProvenance {
    return {
        requestId,
        task,
        provider,
        model,
        createdAt,
        ...(persona ? { persona } : {}),
    };
}
