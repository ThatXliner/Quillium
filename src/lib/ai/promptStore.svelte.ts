export type PromptMode = "chat" | "feedback" | "revise";

export interface SavedPrompt {
    id: string;
    label: string;
    text: string;
}

const STORAGE_KEY = "quillium-saved-prompts";

function loadPrompts(): Record<PromptMode, SavedPrompt[]> {
    if (typeof localStorage === "undefined") {
        return { chat: [], feedback: [], revise: [] };
    }
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {
        // ignore
    }
    return { chat: [], feedback: [], revise: [] };
}

function savePrompts(prompts: Record<PromptMode, SavedPrompt[]>) {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
}

export const savedPrompts = $state(loadPrompts());

export function addPrompt(mode: PromptMode, label: string, text: string) {
    const id = crypto.randomUUID();
    savedPrompts[mode] = [...savedPrompts[mode], { id, label, text }];
    savePrompts(savedPrompts);
}

export function updatePrompt(
    mode: PromptMode,
    id: string,
    label: string,
    text: string,
) {
    savedPrompts[mode] = savedPrompts[mode].map((p) =>
        p.id === id ? { ...p, label, text } : p,
    );
    savePrompts(savedPrompts);
}

export function deletePrompt(mode: PromptMode, id: string) {
    savedPrompts[mode] = savedPrompts[mode].filter((p) => p.id !== id);
    savePrompts(savedPrompts);
}
