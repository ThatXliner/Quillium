import type { UserModelMessage } from "ai";

export type AiContextMode = "chat" | "feedback" | "revise" | "dictionary" | "autoai";
export type AiContextScope = "empty" | "selection" | "document";

export type DocumentContextLike = {
    freeform?: string;
};

export type AnnotationContextMessage = {
    author?: string;
    message: string;
};

export type AnnotationContextReplacement = {
    text: string;
    rationale?: string;
};

export type AnnotationContextVersion = {
    label?: string;
    text: string;
};

export type AnnotationContextInput = {
    id: number;
    type: "comment" | "suggestion" | "revision";
    targetText: string;
    context?: string;
    messages?: AnnotationContextMessage[];
    replacements?: AnnotationContextReplacement[];
    versions?: AnnotationContextVersion[];
    distance?: number;
    active?: boolean;
};

export type AnnotationContextItem = Required<
    Pick<AnnotationContextInput, "id" | "type" | "targetText" | "messages">
> &
    Pick<AnnotationContextInput, "context" | "replacements" | "versions" | "distance" | "active">;

export type AiContextSource = {
    id: "selection" | "surrounding" | "document" | "annotations" | "writer-context";
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
    annotationContext: AnnotationContextItem[];
    includedAnnotationCount: number;
    omittedAnnotationCount: number;
    annotationContextChars: number;
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
const MAX_ANNOTATION_ITEMS = 6;
const MAX_ANNOTATION_CHARS = 4800;
const MAX_ANNOTATION_MESSAGES = 2;
const MAX_ANNOTATION_VARIANTS = 3;
const ANNOTATION_TARGET_CHARS = 360;
const ANNOTATION_CONTEXT_CHARS = 520;
const ANNOTATION_MESSAGE_CHARS = 280;
const ANNOTATION_VARIANT_CHARS = 360;

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

function clipEnd(text: string | undefined, maxChars: number): string {
    const trimmed = text?.replace(/\s+/g, " ").trim() ?? "";
    if (!trimmed) return "";
    if (trimmed.length <= maxChars) return trimmed;
    const marker = ` [... ${trimmed.length - maxChars} characters omitted]`;
    return `${trimmed.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`;
}

function normalizeAnnotation(input: AnnotationContextInput): AnnotationContextItem | null {
    const targetText = clipEnd(input.targetText, ANNOTATION_TARGET_CHARS);
    const context = clipEnd(input.context, ANNOTATION_CONTEXT_CHARS);
    const messages = (input.messages ?? [])
        .filter((message) => message.message.trim())
        .slice(-MAX_ANNOTATION_MESSAGES)
        .map((message) => ({
            author: message.author?.trim() || undefined,
            message: clipEnd(message.message, ANNOTATION_MESSAGE_CHARS),
        }));
    const replacements = (input.replacements ?? [])
        .filter((replacement) => replacement.text.trim())
        .slice(0, MAX_ANNOTATION_VARIANTS)
        .map((replacement) => ({
            text: clipEnd(replacement.text, ANNOTATION_VARIANT_CHARS),
            rationale: clipEnd(replacement.rationale, ANNOTATION_MESSAGE_CHARS) || undefined,
        }));
    const versions = (input.versions ?? [])
        .filter((version) => version.text.trim())
        .slice(0, MAX_ANNOTATION_VARIANTS)
        .map((version) => ({
            label: clipEnd(version.label, 64) || undefined,
            text: clipEnd(version.text, ANNOTATION_VARIANT_CHARS),
        }));

    if (
        !targetText &&
        !context &&
        messages.length === 0 &&
        replacements.length === 0 &&
        versions.length === 0
    ) {
        return null;
    }

    return {
        id: input.id,
        type: input.type,
        targetText,
        context: context || undefined,
        messages,
        replacements: replacements.length > 0 ? replacements : undefined,
        versions: versions.length > 0 ? versions : undefined,
        distance: input.distance,
        active: input.active,
    };
}

function annotationRank(annotation: AnnotationContextItem): [number, number, number] {
    return [
        annotation.active ? 0 : 1,
        annotation.distance ?? Number.MAX_SAFE_INTEGER,
        -annotation.id,
    ];
}

function compareAnnotations(a: AnnotationContextItem, b: AnnotationContextItem): number {
    const aRank = annotationRank(a);
    const bRank = annotationRank(b);
    for (let i = 0; i < aRank.length; i++) {
        if (aRank[i] !== bRank[i]) return aRank[i] - bRank[i];
    }
    return 0;
}

function formatAnnotationContextItem(annotation: AnnotationContextItem): string {
    const parts = [
        `- [${annotation.type} #${annotation.id}${annotation.active ? ", active" : ""}]`,
    ];
    if (annotation.targetText) parts.push(`  target: "${annotation.targetText}"`);
    if (annotation.context && annotation.context !== annotation.targetText) {
        parts.push(`  nearby: "${annotation.context}"`);
    }
    if (annotation.messages.length > 0) {
        const thread = annotation.messages
            .map((message) =>
                message.author ? `${message.author}: ${message.message}` : message.message,
            )
            .join(" | ");
        parts.push(`  thread: ${thread}`);
    }
    if (annotation.replacements?.length) {
        parts.push(
            `  suggested replacements: ${annotation.replacements
                .map((replacement) =>
                    replacement.rationale
                        ? `"${replacement.text}" (${replacement.rationale})`
                        : `"${replacement.text}"`,
                )
                .join("; ")}`,
        );
    }
    if (annotation.versions?.length) {
        parts.push(
            `  revision versions: ${annotation.versions
                .map(
                    (version, index) =>
                        `"${version.label ?? `Version ${index + 1}`}: ${version.text}"`,
                )
                .join("; ")}`,
        );
    }
    return parts.join("\n");
}

function buildAnnotationContext(annotations: AnnotationContextInput[] = []): {
    included: AnnotationContextItem[];
    omitted: number;
    chars: number;
    total: number;
} {
    const normalized = annotations
        .map(normalizeAnnotation)
        .filter((annotation): annotation is AnnotationContextItem => annotation !== null)
        .sort(compareAnnotations);
    const included: AnnotationContextItem[] = [];
    let chars = 0;

    for (const annotation of normalized) {
        const serialized = formatAnnotationContextItem(annotation);
        if (
            included.length >= MAX_ANNOTATION_ITEMS ||
            (included.length > 0 && chars + serialized.length > MAX_ANNOTATION_CHARS)
        ) {
            continue;
        }
        included.push(annotation);
        chars += serialized.length;
    }

    return {
        included,
        omitted: Math.max(0, normalized.length - included.length),
        chars,
        total: normalized.length,
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
    annotationContext,
}: {
    mode: AiContextMode;
    documentContent?: string;
    selectedText?: string;
    documentContext?: DocumentContextLike;
    annotationContext?: AnnotationContextInput[];
}): AiContextPacket {
    const hasDocument = documentContent.trim().length > 0;
    const hasSelection = selectedText.trim().length > 0;
    const writerContext = writerContextText(documentContext);
    const annotations = buildAnnotationContext(annotationContext);
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
        annotationContext: annotations.included,
        includedAnnotationCount: annotations.included.length,
        omittedAnnotationCount: annotations.omitted,
        annotationContextChars: annotations.chars,
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
                id: "annotations",
                label: "Annotations",
                detail:
                    annotations.total > 0
                        ? annotations.omitted > 0
                            ? `${annotations.included.length.toLocaleString()} of ${annotations.total.toLocaleString()} included`
                            : `${annotations.total.toLocaleString()} open`
                        : "No open annotations",
                chars: annotations.chars,
                active: annotations.included.length > 0,
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
    if (
        !packet.documentText &&
        !packet.selectedText &&
        !packet.surroundingText &&
        packet.annotationContext.length === 0
    ) {
        return "";
    }

    const parts: string[] = ["Context packet for this writing request:", `Scope: ${packet.scope}`];

    if (packet.documentText) {
        const label =
            packet.omittedDocumentChars > 0
                ? `Current document excerpt (${packet.omittedDocumentChars.toLocaleString()} characters omitted)`
                : "Current document";
        parts.push(`${label}:\n\`\`\`\n${packet.documentText}\n\`\`\``);
    }

    if (packet.surroundingText && packet.surroundingText !== packet.documentText) {
        parts.push(
            `Nearby context around the selection:\n\`\`\`\n${packet.surroundingText}\n\`\`\``,
        );
    }

    if (packet.selectedText) {
        parts.push(`Currently selected text:\n\`\`\`\n${packet.selectedText}\n\`\`\``);
    }

    if (packet.annotationContext.length > 0) {
        const omitted =
            packet.omittedAnnotationCount > 0
                ? ` (${packet.omittedAnnotationCount.toLocaleString()} omitted by relevance/budget)`
                : "";
        parts.push(
            [
                `Existing annotations${omitted}:`,
                "These are already-open editorial notes. Use them as state, avoid duplicating the same target or concern, and build on them when relevant.",
                packet.annotationContext.map(formatAnnotationContextItem).join("\n\n"),
            ].join("\n"),
        );
    }

    return parts.join("\n\n");
}

export function contextPacketToUserMessage(packet: AiContextPacket): UserModelMessage {
    return { role: "user", content: contextPacketToPrompt(packet) };
}

export function contextScopeLabel(packet: AiContextPacket): string {
    if (packet.scope === "selection") return "Selection context";
    if (packet.scope === "document") return "Draft context";
    return "Blank draft";
}

export function contextScopeDetail(packet: AiContextPacket): string {
    const annotationSuffix = packet.includedAnnotationCount > 0 ? " plus open annotations." : ".";
    if (packet.scope === "selection") {
        return packet.surroundingText
            ? `Using the selection, nearby passage, and draft excerpt${annotationSuffix}`
            : `Using the active selection${annotationSuffix}`;
    }
    if (packet.scope === "document") {
        return packet.omittedDocumentChars > 0
            ? `Using a budgeted draft excerpt${annotationSuffix}`
            : `Using the current draft${annotationSuffix}`;
    }
    return packet.includedAnnotationCount > 0
        ? "Ready with open annotations as context."
        : "Ready for a brief, outline, or starting point.";
}

export function getContextAwareActions(
    mode: "chat" | "feedback" | "revise",
    packet: AiContextPacket,
): ContextAction[] {
    const hasSelection = packet.scope === "selection";
    const hasWriterContext = packet.writerContext.length > 0;
    const hasAnnotations = packet.includedAnnotationCount > 0;
    const longDraft = packet.documentLength > 12000;

    if (mode === "chat") {
        if (hasSelection) {
            const actions = [
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
            if (!hasAnnotations) return actions;
            return [
                {
                    id: "chat-annotations",
                    label: "Use open notes",
                    detail: "Connect this passage to existing annotations",
                    prompt: "Review the existing annotations that relate to this selected text. Which note matters most, what should I avoid duplicating, and what is the next useful edit?",
                },
                ...actions,
            ].slice(0, 3);
        }
        const actions = [
            {
                id: "chat-map",
                label: longDraft ? "Map the draft" : "Name the center",
                detail: longDraft
                    ? "Sections, turns, and pressure points"
                    : "What the piece seems to be about",
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
                detail: hasWriterContext
                    ? "Compare draft against notes"
                    : "Turn intent into guidance",
                prompt: hasWriterContext
                    ? "Compare this draft against the document context. Where is it aligned, and where is it drifting?"
                    : "Based on this draft, propose a concise document context with goal, audience, tone, emphasis, and what to avoid.",
            },
        ];
        if (!hasAnnotations) return actions;
        return [
            {
                id: "chat-annotations",
                label: "Prioritize notes",
                detail: "Turn open annotations into a next pass",
                prompt: "Review the existing annotations in context. Prioritize what to address first, call out duplicates or low-value notes, and suggest the smallest coherent editing pass.",
            },
            ...actions,
        ].slice(0, 3);
    }

    if (mode === "feedback") {
        if (hasSelection) {
            const actions = [
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
            if (!hasAnnotations) return actions;
            return [
                {
                    id: "feedback-annotations",
                    label: "Audit notes",
                    detail: "Build on nearby annotations",
                    prompt: "Give feedback on this selected passage while accounting for the existing annotations. Add new annotations only for distinct issues that are not already covered.",
                },
                ...actions,
            ].slice(0, 3);
        }
        const actions = [
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
        if (!hasAnnotations) return actions;
        return [
            {
                id: "feedback-annotations",
                label: "Audit notes",
                detail: "Coverage, duplicates, and gaps",
                prompt: "Review this draft with the existing annotations in mind. Identify what is already covered, where annotations overlap, and where a new high-value note would add distinct guidance.",
            },
            ...actions,
        ].slice(0, 3);
    }

    if (hasSelection) {
        const actions = [
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
        if (!hasAnnotations) return actions;
        return [
            {
                id: "revise-annotations",
                label: "Revise to notes",
                detail: "Use existing comments and suggestions",
                prompt: "Revise this selected text in response to the existing annotations. Use precise suggestions and do not repeat suggestions already present.",
            },
            ...actions,
        ].slice(0, 3);
    }

    const actions = [
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
    if (!hasAnnotations) return actions;
    return [
        {
            id: "revise-annotations",
            label: "Resolve notes",
            detail: "Line edit with open annotations in view",
            prompt: "Line-edit this draft with the existing annotations in mind. Suggest changes that help resolve open notes, and avoid adding duplicate annotations.",
        },
        ...actions,
    ].slice(0, 3);
}
