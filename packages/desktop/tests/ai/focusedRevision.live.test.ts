import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
/**
 * focusedRevision.live.test.ts verifies model tool calls against real editor state.
 * Opt in with QUILLIUM_LIVE_EDITORIAL_EVAL=1 and GEMINI_API_KEY.
 */
import { revisionInputSchema, streamChat, streamRevise } from "$lib/ai/clientStreams";
import { buildAiContextPacket, contextPacketToPrompt } from "$lib/ai/context";
import { applyEditorialAction } from "$lib/ai/editorialAction";
import { createModel } from "$lib/ai/provider";
import { autoAIActionPayload, buildAutoAIReviewSystemPrompt } from "$lib/autoai/engine";
import { AutoAIReviewSchema, normalizeAutoAIReview } from "$lib/autoai/reviewSchema";
import { autoAISettings } from "$lib/autoai/settings.svelte";
import { annotationField } from "$lib/editor/plugins/annotations";
import { invertedAnnotationFieldEffects } from "$lib/editor/plugins/annotations/annotationField";
import {
    type AiGenerationProvenance,
    isAnnotationOfType,
} from "$lib/editor/plugins/annotations/models";
import type { ReaderPersona } from "$lib/readers/presets";
import { history, redo, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { generateObject } from "ai";
import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/ai/provider", async (importOriginal) => {
    const original = await importOriginal<typeof import("$lib/ai/provider")>();
    if (process.env.QUILLIUM_EVAL_CLAUDE !== "1") return original;
    const { createClaudeEvaluationModel } = await import("./fixtures/claudeEvaluationModel");
    return { ...original, createModel: createClaudeEvaluationModel };
});

const claudeAdapter = process.env.QUILLIUM_EVAL_CLAUDE === "1";
const live = process.env.QUILLIUM_LIVE_EDITORIAL_EVAL === "1" || claudeAdapter;
const doc =
    "The morning train crossed the valley while the station clock counted each minute. I was really very excited to start. The notebook beside the window held three pages of observations about the route. Much later I made a very large mistake. The conductor announced the next stop, and I put the notebook away.";
const model =
    process.env.QUILLIUM_EVAL_MODEL ??
    (claudeAdapter ? "claude-subscription-default" : "gemini-2.5-flash");
const providerName = claudeAdapter ? "claude-cli-evaluation" : "google";
const identity = { documentId: "eval-document", tabId: "eval-tab", draftId: "eval-draft" };
type LiveCase = {
    name: string;
    stream: typeof streamRevise;
    persona?: ReaderPersona;
    source?: string;
    prompt?: string;
    expectedTargets?: string[];
    expectedProposed?: string[];
    task?: "local-rewrite" | "exact-compression";
    exactWordCount?: number;
};

async function recordWorkflow(record: unknown): Promise<void> {
    console.info(JSON.stringify(record));
    const output = process.env.QUILLIUM_EVAL_OUTPUT;
    if (!output) return;
    await mkdir(dirname(output), { recursive: true });
    await appendFile(output, `${JSON.stringify(record)}\n`);
}

describe.runIf(live)("live focused revision workflow", () => {
    it("keeps background review wording changes independently selectable", async () => {
        const previousTypes = [...autoAISettings.annotationTypes];
        const previousConservativeness = autoAISettings.conservativeness;
        autoAISettings.annotationTypes = ["revision"];
        autoAISettings.conservativeness = "thorough";
        const view = new EditorView({
            state: EditorState.create({
                doc,
                extensions: [annotationField, history(), invertedAnnotationFieldEffects],
            }),
        });
        try {
            const context = buildAiContextPacket({
                mode: "autoai",
                documentContent: doc,
                documentContext: {
                    freeform:
                        "The writer requests native revisions to compare cutting 'really very ' and using 'major' instead of 'very large'. Preserve all other wording and spacing. Leave the originals active.",
                },
            });
            const { object } = await generateObject({
                model: createModel(
                    "google",
                    process.env.GEMINI_API_KEY ?? "claude-subscription-evaluation",
                    model,
                ),
                schema: AutoAIReviewSchema,
                system: buildAutoAIReviewSystemPrompt({
                    stance: "collaborative",
                    feedbackDensity: "focused",
                    voiceLatitude: "preserve",
                }),
                prompt: `Review this context packet. Only create annotations for exact targetText substrings that appear in the included document text.\n\n${contextPacketToPrompt(context)}`,
                abortSignal: AbortSignal.timeout(150_000),
            });
            const normalized = normalizeAutoAIReview(object);
            expect(normalized).toHaveLength(2);
            for (const annotation of normalized) {
                const result = applyEditorialAction({
                    rootView: view,
                    current: identity,
                    target: { ...identity, selectedText: "", branchPath: [] },
                    allowedActions: ["revision"],
                    payload: autoAIActionPayload(annotation),
                    provenance: {
                        requestId: "background-live",
                        task: "background-review",
                        provider: "evaluation",
                        model,
                        createdAt: 1,
                    },
                });
                expect(result.ok).toBe(true);
            }
            const annotations = Object.values(view.state.field(annotationField));
            expect(
                annotations
                    .map((annotation) =>
                        view.state.doc.sliceString(
                            annotation.selection.main.from,
                            annotation.selection.main.to,
                        ),
                    )
                    .sort(),
            ).toEqual(["really very ", "very large"].sort());
            expect(view.state.doc.toString()).toBe(doc);
            const saved = JSON.parse(JSON.stringify(view.state.toJSON({ annotationField })));
            const reopened = EditorState.fromJSON(
                saved,
                { extensions: [annotationField] },
                { annotationField },
            );
            expect(reopened.field(annotationField)).toEqual(view.state.field(annotationField));
            expect(undo(view)).toBe(true);
            expect(redo(view)).toBe(true);
            expect(view.state.field(annotationField)).toEqual(reopened.field(annotationField));
            await recordWorkflow({
                workflow: "AutoAI",
                adapter: claudeAdapter
                    ? "real Claude subscription through AI SDK adapter"
                    : "direct vendor",
                object,
                snapshotRoundtrip: true,
                undoRedo: true,
            });
        } finally {
            autoAISettings.annotationTypes = previousTypes;
            autoAISettings.conservativeness = previousConservativeness;
            view.destroy();
        }
    }, 180_000);
    it.each<LiveCase>([
        { name: "Chat wording action", stream: streamChat, persona: undefined },
        { name: "Revise action", stream: streamRevise, persona: undefined },
        {
            name: "Exact compression",
            stream: streamRevise,
            source: "A bright train finally arrived at sunrise.",
            prompt: "Compress this passage to exactly six words. Keep my original active for comparison.",
            task: "exact-compression",
            exactWordCount: 6,
            expectedTargets: ["A bright train finally arrived at sunrise."],
        },
        {
            name: "Dependent wording",
            stream: streamRevise,
            source: "The first train was late. He is ready. The next train arrived on time.",
            prompt: "Change 'He is ready' to 'They are ready' as a native revision. Keep everything else unchanged and leave my original active.",
            expectedTargets: ["He is"],
            expectedProposed: ["They are"],
        },
        {
            name: "Reader review",
            stream: streamRevise,
            persona: {
                id: "eval-reader",
                name: "Line editor",
                emoji: "",
                color: "#336699",
                description: "Checks wording.",
                instruction: "Preserve voice and follow the writer's exact edit requests.",
                builtin: false,
                enabled: true,
                chattiness: "normal" as const,
            },
        },
    ])(
        "preserves the requested revision boundaries through $name",
        async ({
            stream,
            persona,
            name,
            source = doc,
            prompt,
            expectedTargets = ["really very ", "very large"],
            expectedProposed = ["", "major"],
            task = "local-rewrite",
            exactWordCount,
        }) => {
            if (!claudeAdapter && !process.env.GEMINI_API_KEY)
                throw new Error("GEMINI_API_KEY is required for the live evaluation");
            const view = new EditorView({
                state: EditorState.create({
                    doc: source,
                    extensions: [annotationField, history(), invertedAnnotationFieldEffects],
                }),
            });
            const provenance: AiGenerationProvenance = {
                requestId: `live-${name}`,
                task,
                provider: providerName,
                model,
                createdAt: Date.now(),
            };
            const calls: unknown[] = [];
            try {
                const output = await stream({
                    provider: "google",
                    model,
                    apiKey: process.env.GEMINI_API_KEY ?? "claude-subscription-evaluation",
                    documentContent: source,
                    selectedText: source,
                    selectedTextRange: { from: 0, to: source.length },
                    editorialTask: task,
                    exactWordCount,
                    persona,
                    annotationOnly: !!persona,
                    abortSignal: AbortSignal.timeout(150_000),
                    messages: [
                        {
                            id: "request",
                            role: "user",
                            parts: [
                                {
                                    type: "text",
                                    text:
                                        prompt ??
                                        "I want to compare cutting 'really very ' and using 'major' instead of 'very large', as native revisions. Keep all other wording and spacing unchanged, and keep my originals active so I can decide.",
                                },
                            ],
                        },
                    ],
                });
                const reader = output.getReader();
                while (true) {
                    const { value: chunk, done } = await reader.read();
                    if (done) break;
                    if (chunk.type === "error") throw new Error(chunk.errorText);
                    if (chunk.type !== "tool-input-available") continue;
                    expect(chunk.toolName).toBe("createRevision");
                    const input = revisionInputSchema.parse(chunk.input);
                    calls.push(input);
                    const result = applyEditorialAction({
                        rootView: view,
                        current: identity,
                        target: {
                            ...identity,
                            selectedText: source,
                            selectedTextRange: { from: 0, to: source.length },
                            branchPath: [],
                        },
                        allowedActions: ["revision"],
                        payload: { action: "revision", ...input },
                        provenance,
                        constraints: exactWordCount === undefined ? undefined : { exactWordCount },
                    });
                    expect(result.ok).toBe(true);
                }
                expect(calls).toHaveLength(expectedTargets.length);
                const annotations = Object.values(view.state.field(annotationField));
                expect(annotations).toHaveLength(expectedTargets.length);
                expect(view.state.doc.toString()).toBe(source);
                expect(
                    annotations
                        .map((annotation) =>
                            view.state.doc.sliceString(
                                annotation.selection.main.from,
                                annotation.selection.main.to,
                            ),
                        )
                        .sort(),
                ).toEqual([...expectedTargets].sort());
                const proposed: string[] = [];
                for (const annotation of annotations) {
                    if (!isAnnotationOfType(annotation, "revision"))
                        throw new Error("Expected a revision");
                    expect(annotation.activeVersionId).toBe(annotation.versions[0].id);
                    expect(annotation.versions[1].aiProvenance).toEqual(provenance);
                    proposed.push(annotation.versions[1].doc);
                    if (exactWordCount !== undefined) {
                        expect(annotation.versions).toHaveLength(3);
                        for (const version of annotation.versions.slice(1)) {
                            expect(version.doc.trim().split(/\s+/)).toHaveLength(exactWordCount);
                        }
                    }
                }
                if (exactWordCount === undefined)
                    expect(proposed.sort()).toEqual([...expectedProposed].sort());
                const saved = JSON.parse(JSON.stringify(view.state.toJSON({ annotationField })));
                const reopened = EditorState.fromJSON(
                    saved,
                    { extensions: [annotationField] },
                    { annotationField },
                );
                expect(reopened.field(annotationField)).toEqual(view.state.field(annotationField));
                expect(undo(view)).toBe(true);
                expect(redo(view)).toBe(true);
                expect(view.state.field(annotationField)).toEqual(reopened.field(annotationField));
                await recordWorkflow({
                    workflow: name,
                    provider: providerName,
                    adapter: claudeAdapter
                        ? "real Claude subscription through AI SDK adapter"
                        : "direct vendor",
                    model,
                    calls,
                    retainedOriginal: true,
                    independentRevisions: annotations.length,
                    snapshotRoundtrip: true,
                    undoRedo: true,
                });
            } finally {
                view.destroy();
            }
        },
        180_000,
    );
});
