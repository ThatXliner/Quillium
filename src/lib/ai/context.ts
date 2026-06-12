import type { UserModelMessage } from "ai";

export type AiContextMode = "chat" | "feedback" | "revise" | "dictionary" | "autoai";
export type AiContextScope = "empty" | "selection" | "document";

export type DocumentContextLike = {
    freeform?: string;
};

export type AiContextSource = {
    id: "selection" | "surrounding" | "document" | "writer-context";
    label: string;
    detail: string;
    chars: number;
    active: boolean;
};

export type AiContextPacket = {
    mode: AiContextMode;
    scope: AiContextScope;
    documentLength: number;
    selectedLength: number;
    includedDocumentLength: number;
    omittedDocumentChars: number;
    maxDocumentChars: number;
    documentText: string;
    selectedText: string;
    surroundingText: string;
    writerContext: string;
    sources: AiContextSource[];
};

export type ContextAction = {
    id: string;
    label: string;
    detail: string;
    prompt: string;
};

const MODE_DOCUMENT_BUDGETS: Record<AiContextMode, number> = {
    chat: 18000,
    feedback: 24000,
    revise: 16000,
    dictionary: 0,
    autoai: 26000,
};

const SELECTION_DOCUMENT_BUDGET = 9000;
const SURROUNDING_CHARS = 2400;

function writerContextText(ctx?: DocumentContextLike): string {
    return ctx?.freeform?.trim() ?? "";
}

function clipMiddle(text: string, maxChars: number): { text: string; omitted: number } {
    if (maxChars <= 0) return { text: "", omitted: text.length };
    if (text.length <= maxChars) return { text, omitted: 0 };

    const marker = `\n\n[... ${text.length - maxChars} characters omitted ...]\n\n`;
    const available = Math.max(0, maxChars - marker.length);
    const head = Math.ceil(available * 0.58);
    const tail = Math.floor(available * 0.42);
    return {
        text: `${text.slice(0, head)}${marker}${text.slice(text.length - tail)}`,
        omitted: text.length - head - tail,
    };
}

function selectedRange(documentContent: string, selectedText: string): [number, number] | null {
    if (!documentContent || !selectedText.trim()) return null;
    const exact = documentContent.indexOf(selectedText);
    if (exact >= 0) return [exact, exact + selectedText.length];

    const trimmed = selectedText.trim();
    const trimmedIndex = documentContent.indexOf(trimmed);
    if (trimmedIndex >= 0) return [trimmedIndex, trimmedIndex + trimmed.length];
    return null;
}

function buildSurroundingText(documentContent: string, selectedText: string): string {
    const range = selectedRange(documentContent, selectedText);
    if (!range) return "";

    const [from, to] = range;
    const start = Math.max(0, from - SURROUNDING_CHARS);
    const end = Math.min(documentContent.length, to + SURROUNDING_CHARS);
    const prefix = start > 0 ? "[... earlier document omitted ...]\n" : "";
    const suffix = end < documentContent.length ? "\n[... later document omitted ...]" : "";
    return `${prefix}${documentContent.slice(start, end)}${suffix}`;
}

export function buildAiContextPacket({
    mode,
    documentContent = "",
    selectedText = "",
    documentContext,
}: {
    mode: AiContextMode;
    documentContent?: string;
    selectedText?: string;
    documentContext?: DocumentContextLike;
}): AiContextPacket {
    const hasDocument = documentContent.trim().length > 0;
    const hasSelection = selectedText.trim().length > 0;
    const writerContext = writerContextText(documentContext);
    const scope: AiContextScope = hasSelection ? "selection" : hasDocument ? "document" : "empty";
    const maxDocumentChars =
        scope === "selection"
            ? Math.min(MODE_DOCUMENT_BUDGETS[mode], SELECTION_DOCUMENT_BUDGET)
            : MODE_DOCUMENT_BUDGETS[mode];
    const clipped = clipMiddle(documentContent, maxDocumentChars);
    const surroundingText = hasSelection ? buildSurroundingText(documentContent, selectedText) : "";

    return {
        mode,
        scope,
        documentLength: documentContent.length,
        selectedLength: selectedText.length,
        includedDocumentLength: clipped.text.length,
        omittedDocumentChars: clipped.omitted,
        maxDocumentChars,
        documentText: clipped.text,
        selectedText: hasSelection ? selectedText : "",
        surroundingText,
        writerContext,
        sources: [
            {
                id: "selection",
                label: "Selection",
                detail: hasSelection
                    ? `${selectedText.length.toLocaleString()} characters selected`
                    : "No active selection",
                chars: hasSelection ? selectedText.length : 0,
                active: hasSelection,
            },
            {
                id: "surrounding",
                label: "Nearby Passage",
                detail: surroundingText
                    ? `${surroundingText.length.toLocaleString()} characters around it`
                    : "Included when text is selected",
                chars: surroundingText.length,
                active: surroundingText.length > 0,
            },
            {
                id: "document",
                label: "Draft",
                detail: hasDocument
                    ? clipped.omitted > 0
                        ? `${clipped.text.length.toLocaleString()} of ${documentContent.length.toLocaleString()} characters`
                        : `${documentContent.length.toLocaleString()} characters`
                    : "No draft text yet",
                chars: clipped.text.length,
                active: hasDocument && clipped.text.length > 0,
            },
            {
                id: "writer-context",
                label: "Brief",
                detail: writerContext
                    ? `${writerContext.length.toLocaleString()} characters`
                    : "No brief added",
                chars: writerContext.length,
                active: writerContext.length > 0,
            },
        ],
    };
}

export function contextPacketToPrompt(packet: AiContextPacket): string {
    if (!packet.documentText && !packet.selectedText && !packet.surroundingText) return "";

    const parts: string[] = [
        "Context packet for this writing request:",
        `Scope: ${packet.scope}`,
    ];

    if (packet.documentText) {
        const label =
            packet.omittedDocumentChars > 0
                ? `Current document excerpt (${packet.omittedDocumentChars.toLocaleString()} characters omitted)`
                : "Current document";
        parts.push(`${label}:\n\`\`\`\n${packet.documentText}\n\`\`\``);
    }

    if (packet.surroundingText && packet.surroundingText !== packet.documentText) {
        parts.push(`Nearby context around the selection:\n\`\`\`\n${packet.surroundingText}\n\`\`\``);
    }

    if (packet.selectedText) {
        parts.push(`Currently selected text:\n\`\`\`\n${packet.selectedText}\n\`\`\``);
    }

    return parts.join("\n\n");
}

export function contextPacketToUserMessage(packet: AiContextPacket): UserModelMessage {
    return { role: "user", content: contextPacketToPrompt(packet) };
}

export function contextScopeLabel(packet: AiContextPacket): string {
    if (packet.scope === "selection") return "Selection lens";
    if (packet.scope === "document") return "Document lens";
    return "Blank draft";
}

export function contextScopeDetail(packet: AiContextPacket): string {
    if (packet.scope === "selection") {
        return packet.surroundingText
            ? "Using the selection, nearby passage, and draft excerpt."
            : "Using the active selection.";
    }
    if (packet.scope === "document") {
        return packet.omittedDocumentChars > 0
            ? "Using a budgeted draft excerpt."
            : "Using the current draft.";
    }
    return "Ready for a brief, outline, or starting point.";
}

export function getContextAwareActions(
    mode: "chat" | "feedback" | "revise",
    packet: AiContextPacket,
): ContextAction[] {
    const hasSelection = packet.scope === "selection";
    const hasWriterContext = packet.writerContext.length > 0;
    const longDraft = packet.documentLength > 12000;

    if (mode === "chat") {
        if (hasSelection) {
            return [
                {
                    id: "chat-role",
                    label: "Explain its job",
                    detail: "What this passage is doing for the piece",
                    prompt: "Explain what this selected passage is doing in the larger piece, and where it may be over- or under-serving the draft.",
                },
                {
                    id: "chat-reader",
                    label: "Reader question",
                    detail: "Likely confusion or curiosity",
                    prompt: "What question would a careful reader have after this selected passage? Be specific and concise.",
                },
                {
                    id: "chat-alt",
                    label: "Try another angle",
                    detail: "A different approach without rewriting yet",
                    prompt: "Suggest two different editorial directions for this selected passage without rewriting it yet.",
                },
            ];
        }
        return [
            {
                id: "chat-map",
                label: longDraft ? "Map the draft" : "Name the center",
                detail: longDraft ? "Sections, turns, and pressure points" : "What the piece seems to be about",
                prompt: longDraft
                    ? "Map this draft: identify the major sections, turning points, and where the argument or story loses pressure."
                    : "What does this draft seem to be trying to say? Name the central tension and one next move.",
            },
            {
                id: "chat-gap",
                label: "Find missing context",
                detail: "What a reader may need",
                prompt: "Find places where a reader may need more context, setup, or connective tissue. Prioritize the highest-impact gaps.",
            },
            {
                id: "chat-brief",
                label: hasWriterContext ? "Check the brief" : "Shape a brief",
                detail: hasWriterContext ? "Compare draft against notes" : "Turn intent into guidance",
                prompt: hasWriterContext
                    ? "Compare this draft against the document context. Where is it aligned, and where is it drifting?"
                    : "Based on this draft, propose a concise document context with goal, audience, tone, emphasis, and what to avoid.",
            },
        ];
    }

    if (mode === "feedback") {
        if (hasSelection) {
            return [
                {
                    id: "feedback-reader",
                    label: "Reader reaction",
                    detail: "How the passage lands",
                    prompt: "Give editorial feedback on how this selected passage lands for a reader. Use annotations for specific observations.",
                },
                {
                    id: "feedback-function",
                    label: "Passage function",
                    detail: "Purpose, placement, payoff",
                    prompt: "Assess the function of this selected passage: what it sets up, what it pays off, and whether it belongs here.",
                },
                {
                    id: "feedback-hard-question",
                    label: "Hard question",
                    detail: "The note an honest editor would ask",
                    prompt: "Ask the hardest useful editorial question about this selected passage, then point to the exact text that triggered it.",
                },
            ];
        }
        return [
            {
                id: "feedback-structure",
                label: "Structure scan",
                detail: "Order, emphasis, momentum",
                prompt: "Review this draft for structure, emphasis, and momentum. Annotate passages where the order or focus weakens the piece.",
            },
            {
                id: "feedback-brief",
                label: hasWriterContext ? "Against the brief" : "Audience fit",
                detail: hasWriterContext ? "Goal, audience, tone" : "Who this is serving",
                prompt: hasWriterContext
                    ? "Evaluate this draft against the document context. Annotate places that drift from the stated goal, audience, or tone."
                    : "Evaluate who this draft seems to be serving and where it may lose that reader.",
            },
            {
                id: "feedback-patterns",
                label: "Recurring patterns",
                detail: "Issues that repeat across the draft",
                prompt: "Look for recurring editorial patterns across the draft. Annotate representative examples instead of every instance.",
            },
        ];
    }

    if (hasSelection) {
        return [
            {
                id: "revise-tighten",
                label: "Tighten",
                detail: "Keep meaning, reduce drag",
                prompt: "Tighten this selected text while preserving its meaning and voice. Use granular suggestions.",
            },
            {
                id: "revise-rhythm",
                label: "Improve rhythm",
                detail: "Sentence movement and transitions",
                prompt: "Improve the rhythm and movement of this selected text. Preserve the writer's voice and annotate precise changes.",
            },
            {
                id: "revise-variants",
                label: "Two directions",
                detail: "Compare different revision paths",
                prompt: "Offer two meaningfully different revision directions for this selected text, with tradeoffs.",
            },
        ];
    }

    return [
        {
            id: "revise-hotspots",
            label: "Line-edit hotspots",
            detail: "Only places worth touching",
            prompt: "Line-edit this draft selectively. Only annotate high-value word choice, clarity, rhythm, or redundancy issues.",
        },
        {
            id: "revise-transitions",
            label: "Transitions",
            detail: "Connection between ideas",
            prompt: "Find and improve weak transitions or abrupt turns in this draft. Use precise suggestions.",
        },
        {
            id: "revise-voice",
            label: "Protect the voice",
            detail: "Polish without flattening",
            prompt: "Polish this draft while preserving the writer's voice. Avoid generic smoothing; annotate only changes that strengthen the prose.",
        },
    ];
}
