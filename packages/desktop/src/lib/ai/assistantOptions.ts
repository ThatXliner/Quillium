/** assistantOptions.ts — Device-local conversation permissions and reply length. */
import { z } from "zod";
import { editorialActionsSchema, responseLengthSchema } from "./editorialPolicy";

const optionsSchema = z.object({
    requestedActions: editorialActionsSchema,
    responseLength: responseLengthSchema,
    readers: z.boolean(),
});
export type AssistantOptions = z.infer<typeof optionsSchema>;
export function defaultAssistantOptions(): AssistantOptions {
    return {
        requestedActions: ["comment", "suggestion", "revision"],
        responseLength: "balanced",
        readers: false,
    };
}
export function loadAssistantOptions(scope: string, sourceScope?: string): AssistantOptions {
    try {
        const saved =
            localStorage.getItem(`quillium-assistant:${scope}`) ??
            (sourceScope ? localStorage.getItem(`quillium-assistant:${sourceScope}`) : null);
        if (saved) {
            const result = optionsSchema.safeParse(JSON.parse(saved));
            if (result.success) return result.data;
            // A corrupt permission record must never restore more tools than it granted.
            return { ...defaultAssistantOptions(), requestedActions: [] };
        }
    } catch {
        return { ...defaultAssistantOptions(), requestedActions: [] };
    }
    return defaultAssistantOptions();
}
export function saveAssistantOptions(scope: string, options: AssistantOptions): void {
    localStorage.setItem(`quillium-assistant:${scope}`, JSON.stringify(options));
}
