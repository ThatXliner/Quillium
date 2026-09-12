// capabilities.ts — Target-scoped capabilities exposed to the College panel.
//
// A capability captures the document/tab/draft session that created it. Every
// mutating operation checks that session before touching College state or
// opening another panel, so a late click cannot act on a newly selected tab.

import { abortError, linkAbortSignals } from "$lib/abort";
import {
    researchProviderLabel,
    researchSchool,
    researchUnavailableReason,
} from "$lib/ai/schoolResearch";
import { getAiAbortSignal, getEffectiveDocumentContext, hasApiKey } from "$lib/ai/settings.svelte";
import { createCollegeTabs } from "$lib/db";
import type { TabMeta } from "$lib/db/types";
import { appEventBus } from "$lib/events/appEventBus";
import { appSettings } from "$lib/settings.svelte";
import type { SidebarPanelSession } from "$lib/sidebar/panels";
import {
    currentDocumentId,
    currentDocumentTitle,
    currentDraftId,
    currentDraftLabel,
    currentTabId,
    currentTabLabel,
    documentContent,
    editorView,
} from "$lib/stores";
import { isolateHistory } from "@codemirror/commands";
import { get } from "svelte/store";
import { bundledReferencesFor, previewBundledGuidance } from "./bundledGuidance";
import {
    type CollegePrompt,
    type CollegeReference,
    type CollegeSetup,
    cloneCollegeSetup,
    serializeCollegeSetup,
} from "./model";
import { UC_PROMPTS } from "./presets";
import { type ResearchResult, findingKey } from "./research";
import {
    type ResearchTarget,
    collegeResearchPromptKey,
    collegeResearchSetupKey,
    isCollegeReferenceCurrent,
    researchTargetSchema,
} from "./researchModel";
import {
    type CollegeSection,
    archiveCollegePrompts,
    formatCollegePromptHeading,
    resolveCollegeSections,
    resolveCollegeSetup,
} from "./sections";
import {
    collegeState,
    getActiveCollegeSetup,
    reloadCollegeSetup,
    saveCollegeSetup,
} from "./state.svelte";

export type CollegeAction = "prompt-fit" | "specificity" | "plan";
export type CollegeOpenPanel = "context" | "readers" | "settings";

export type CollegeCapabilitiesSnapshot = {
    setup: CollegeSetup | null;
    effectiveSetup: CollegeSetup | null;
    sections: CollegeSection[];
    sectionMode: boolean;
    canEdit: boolean;
    status: string;
    error: string;
    saving: boolean;
    hostEnabled: boolean;
    aiEnabled: boolean;
    documentId: string | null;
    tabId: string | null;
    documentLabel: string;
    tabLabel: string;
    draftLabel: string;
    sharedBrief: string;
    decisions: string[];
    hasProse: boolean;
    wordCount: number;
    characterCount: number;
    canRequest: boolean;
    requestCount: number;
    researchProvider: string;
    researchUnavailable: string;
};

export interface CollegeCapabilities {
    readonly read: () => CollegeCapabilitiesSnapshot;
    readonly save: (setup: CollegeSetup | null) => Promise<void>;
    readonly retry: () => Promise<void>;
    readonly createTabs: (setups: CollegeSetup[]) => Promise<void>;
    readonly addPrompt: (prompt: CollegePrompt) => Promise<void>;
    readonly acceptBundledGuidance: (expectedSetup: CollegeSetup) => Promise<void>;
    readonly openPanel: (id: CollegeOpenPanel) => void;
    readonly request: (action: CollegeAction) => void;
    readonly research: (target: ResearchTarget, signal: AbortSignal) => Promise<ResearchResult>;
    readonly acceptResearch: (
        resultId: string,
        selectedIds: string[],
        removeIds: string[],
    ) => Promise<void>;
}

const STALE_SESSION_MESSAGE =
    "This College panel session is stale. Select the current document tab and try again.";

function compactId(id: string | null, fallback: string): string {
    if (!id) return fallback;
    if (id.length <= 18) return id;
    return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function labelFor(value: string, id: string | null, fallback: string): string {
    const trimmed = value.trim();
    return trimmed || compactId(id, fallback);
}

function readersRequestCount(setup: CollegeSetup | null): number {
    if (!setup?.feedbackReaders) return 1;
    return Math.max(1, setup.readers.filter((reader) => reader.enabled).length);
}

function assertTabOperationReady(): void {
    if (!collegeState.hostEnabled) {
        throw new Error("College applications are disabled in this workspace.");
    }
    if (collegeState.saving) {
        throw new Error("A College setup save is already in progress.");
    }
    if (collegeState.status !== "ready") {
        throw new Error(
            collegeState.error ||
                (collegeState.status === "loading"
                    ? "The College setup is still loading. Try again shortly."
                    : "The College setup is unavailable. Reload it before continuing."),
        );
    }
}

function tabLabelForSetup(setup: CollegeSetup): string {
    const promptLabel = setup.prompts[0]?.label.replace(/\s*\(summary\)\s*$/i, "").trim();
    const label = promptLabel || "College prompt";
    if (setup.kind !== "uc-piq") return label;
    const presetIndex = UC_PROMPTS.findIndex((prompt) => prompt.label === setup.prompts[0]?.label);
    return presetIndex < 0 ? label : `PIQ ${presetIndex + 1} · ${label}`;
}

function createTabPayload(
    setups: CollegeSetup[],
): Array<{ label: string; setupJson: string; initialContent: string }> {
    if (setups.length < 1 || setups.length > 12) {
        throw new Error("Choose between 1 and 12 College prompts.");
    }
    return setups.map((setup) => {
        const validated = cloneCollegeSetup(setup);
        if (validated.prompts.length !== 1) {
            throw new Error("Each College tab must contain exactly one prompt.");
        }
        validated.sectionMode = true;
        validated.references = [
            ...validated.references.filter((reference) => !reference.bundle),
            ...bundledReferencesFor(validated),
        ];
        return {
            label: tabLabelForSetup(validated),
            setupJson: serializeCollegeSetup(validated),
            initialContent: `${formatCollegePromptHeading(validated.prompts[0])}\n\n`,
        };
    });
}

function cloneLoose<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function normalizedPromptText(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function freshPromptId(): string {
    return globalThis.crypto.randomUUID();
}

function sectionAppendPrefix(prose: string): string {
    if (!prose) return "";
    if (prose.endsWith("\n\n")) return "";
    if (prose.endsWith("\n")) return "\n";
    return "\n\n";
}

function promptResearchKeys(
    setup: CollegeSetup,
    promptIds: readonly string[],
): { promptIds: string[]; promptKeys: Record<string, string> } {
    const promptsById = new Map(setup.prompts.map((prompt) => [prompt.id, prompt]));
    const ids = [...new Set(promptIds)].filter((id) => promptsById.has(id));
    return {
        promptIds: ids,
        promptKeys: Object.fromEntries(
            ids.flatMap((id) => {
                const prompt = promptsById.get(id);
                return prompt ? [[id, collegeResearchPromptKey(setup, prompt)]] : [];
            }),
        ),
    };
}

function cloneResearchResult(result: ResearchResult): ResearchResult {
    return JSON.parse(JSON.stringify(result)) as ResearchResult;
}

function cloneResearchTarget(target: ResearchTarget): ResearchTarget {
    return JSON.parse(JSON.stringify(target)) as ResearchTarget;
}

/**
 * Create the narrow capability object passed to one College panel instance.
 * The callback is intentionally supplied by the sidebar host; the College
 * module cannot navigate arbitrary panels by itself.
 */
export function createCollegeCapabilities(
    session: SidebarPanelSession,
    openPanel: (id: string) => void,
): CollegeCapabilities {
    const target = Object.freeze({
        documentId: session.target.documentId,
        tabId: session.target.tabId,
        draftId: session.target.draftId,
    });
    let creatingTabs = false;
    type CapturedResearch = {
        result: ResearchResult;
        setupSerialized: string;
        abortSignals: readonly AbortSignal[];
    };
    let latestResearch: CapturedResearch | null = null;
    let runningResearch: symbol | null = null;

    function assertCurrent(): void {
        if (!session.isCurrent()) throw new Error(STALE_SESSION_MESSAGE);
    }

    function assertResearchSignal(signal: AbortSignal): void {
        if (!signal.aborted) return;
        const reason = signal.reason;
        if (reason instanceof Error) throw reason;
        throw abortError("School research was cancelled.");
    }

    function currentStateMatchesTarget(): boolean {
        return (
            collegeState.documentId === target.documentId &&
            collegeState.tabId === target.tabId &&
            get(currentDocumentId) === target.documentId &&
            get(currentTabId) === target.tabId &&
            get(currentDraftId) === target.draftId
        );
    }

    function currentEditorView() {
        return get(editorView);
    }

    function effectiveCurrentSetup(rawSetup: CollegeSetup): CollegeSetup {
        return resolveCollegeSetup(rawSetup, get(documentContent));
    }

    function researchUnavailable(): string {
        return researchUnavailableReason() || "";
    }

    function assertResearchReady(): CollegeSetup {
        assertCurrent();
        if (!currentStateMatchesTarget()) throw new Error(STALE_SESSION_MESSAGE);
        if (!appSettings.aiEnabled) {
            throw new Error("Enable AI before researching a school prompt.");
        }
        if (!collegeState.hostEnabled) throw new Error("College applications are disabled.");
        if (collegeState.status !== "ready" || collegeState.saving) {
            throw new Error(
                collegeState.error ||
                    (collegeState.saving
                        ? "The College setup is being saved. Try again when it is ready."
                        : collegeState.status === "loading"
                          ? "The College setup is still loading. Try again shortly."
                          : "The College setup is unavailable. Reload it before researching."),
            );
        }
        const unavailable = researchUnavailable();
        if (unavailable) throw new Error(unavailable);
        const storedSetup = getActiveCollegeSetup();
        if (!storedSetup || !storedSetup.active) {
            throw new Error(
                "Apply and activate a College setup before researching a school prompt.",
            );
        }
        const setup = effectiveCurrentSetup(storedSetup);
        if (setup.prompts.length < 1) {
            throw new Error("Restore at least one College prompt heading before researching.");
        }
        return setup;
    }

    function assertCapturedResearchCurrent(
        setupSerialized: string,
        signal: AbortSignal,
    ): CollegeSetup {
        assertResearchSignal(signal);
        if (!session.isCurrent() || !currentStateMatchesTarget()) {
            throw new Error(STALE_SESSION_MESSAGE);
        }
        if (!appSettings.aiEnabled || !collegeState.hostEnabled) {
            throw new Error(STALE_SESSION_MESSAGE);
        }
        if (collegeState.status !== "ready" || collegeState.saving) {
            throw new Error(STALE_SESSION_MESSAGE);
        }
        if (!currentStateMatchesTarget()) throw new Error(STALE_SESSION_MESSAGE);
        const storedSetup = getActiveCollegeSetup();
        const setup = storedSetup ? effectiveCurrentSetup(storedSetup) : null;
        if (
            !setup ||
            !setup.active ||
            setup.prompts.length < 1 ||
            serializeCollegeSetup(setup) !== setupSerialized
        ) {
            throw new Error(STALE_SESSION_MESSAGE);
        }
        return setup;
    }

    function assertCapturedResearchAcceptable(captured: {
        setupSerialized: string;
        abortSignals: readonly AbortSignal[];
    }): CollegeSetup {
        if (
            captured.abortSignals.some((signal) => signal.aborted) ||
            !session.isCurrent() ||
            !currentStateMatchesTarget() ||
            !appSettings.aiEnabled ||
            !collegeState.hostEnabled ||
            collegeState.status !== "ready" ||
            collegeState.saving
        ) {
            throw new Error(STALE_SESSION_MESSAGE);
        }
        if (!currentStateMatchesTarget()) throw new Error(STALE_SESSION_MESSAGE);
        const storedSetup = getActiveCollegeSetup();
        const setup = storedSetup ? effectiveCurrentSetup(storedSetup) : null;
        if (
            !setup ||
            !setup.active ||
            setup.prompts.length < 1 ||
            serializeCollegeSetup(setup) !== captured.setupSerialized
        ) {
            throw new Error(STALE_SESSION_MESSAGE);
        }
        return setup;
    }

    function parseResearchTarget(value: unknown): ResearchTarget {
        const parsed = researchTargetSchema.safeParse(value);
        if (!parsed.success) {
            throw new Error(
                `The school research target is invalid: ${parsed.error.issues[0]?.message ?? "check its fields"}.`,
            );
        }
        return parsed.data;
    }

    function validateResearchPrompts(researchTarget: ResearchTarget, setup: CollegeSetup): void {
        const prompts = new Map(setup.prompts.map((prompt) => [prompt.id, prompt]));
        for (const prompt of researchTarget.prompts) {
            const stored = prompts.get(prompt.id);
            if (!stored || stored.label !== prompt.label || stored.text !== prompt.text) {
                throw new Error(
                    "The selected College prompts changed. Reload the panel and choose the current prompts.",
                );
            }
        }
    }

    function assertResearchIds(ids: string[], known: ReadonlySet<string>, label: string): void {
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
            throw new Error(`${label} must contain only string IDs.`);
        }
        if (new Set(ids).size !== ids.length) {
            throw new Error(`${label} must contain unique IDs.`);
        }
        if (ids.some((id) => !known.has(id))) {
            throw new Error(`${label} contains a finding that is not in this research result.`);
        }
    }

    function neutralSnapshot(): CollegeCapabilitiesSnapshot {
        return {
            setup: null,
            effectiveSetup: null,
            sections: [],
            sectionMode: false,
            canEdit: false,
            status: "idle",
            error: "",
            saving: false,
            hostEnabled: false,
            aiEnabled: false,
            documentId: target.documentId,
            tabId: target.tabId,
            documentLabel: compactId(target.documentId, "Untitled"),
            tabLabel: compactId(target.tabId, "Untitled tab"),
            draftLabel: compactId(target.draftId, "Untitled draft"),
            sharedBrief: "",
            decisions: [],
            hasProse: false,
            wordCount: 0,
            characterCount: 0,
            canRequest: false,
            requestCount: 1,
            researchProvider: "",
            researchUnavailable: "",
        };
    }

    function read(): CollegeCapabilitiesSnapshot {
        if (
            !session.isCurrent() ||
            collegeState.documentId !== target.documentId ||
            collegeState.tabId !== target.tabId
        ) {
            return neutralSnapshot();
        }

        const setup = collegeState.setup ? cloneCollegeSetup(collegeState.setup) : null;
        const effectiveContext = getEffectiveDocumentContext();
        const currentDocument = get(currentDocumentId);
        const currentTab = get(currentTabId);
        const currentDraft = get(currentDraftId);
        const targetIsCurrent =
            currentDocument === target.documentId &&
            currentTab === target.tabId &&
            currentDraft === target.draftId;
        const currentProse = targetIsCurrent ? get(documentContent) : "";
        const sections =
            setup && targetIsCurrent ? resolveCollegeSections(setup, currentProse) : [];
        const effectiveSetup =
            setup && targetIsCurrent ? resolveCollegeSetup(setup, currentProse) : null;
        const view = currentEditorView();
        const wordCount = currentProse.trim().split(/\s+/).filter(Boolean).length;
        const characterCount = Array.from(currentProse).length;
        const aiAvailable = appSettings.aiEnabled && hasApiKey();
        const ready = collegeState.status === "ready" && !collegeState.saving;

        return {
            setup,
            effectiveSetup: effectiveSetup ? cloneLoose(effectiveSetup) : null,
            sections: cloneLoose(sections),
            sectionMode: Boolean(
                setup?.sectionMode || sections.some((section) => section.headingFrom !== null),
            ),
            canEdit: Boolean(
                targetIsCurrent &&
                    view &&
                    !view.state.readOnly &&
                    collegeState.hostEnabled &&
                    ready,
            ),
            status: collegeState.status,
            error: collegeState.error,
            saving: collegeState.saving,
            hostEnabled: collegeState.hostEnabled,
            aiEnabled: appSettings.aiEnabled,
            documentId: target.documentId,
            tabId: target.tabId,
            documentLabel: labelFor(
                targetIsCurrent ? get(currentDocumentTitle) : "",
                target.documentId,
                "Untitled",
            ),
            tabLabel: labelFor(
                targetIsCurrent ? get(currentTabLabel) : "",
                target.tabId,
                "Untitled tab",
            ),
            draftLabel: labelFor(
                targetIsCurrent ? get(currentDraftLabel) : "",
                target.draftId,
                "Untitled draft",
            ),
            sharedBrief: effectiveContext.freeform,
            decisions: [...effectiveContext.decisions],
            hasProse: currentProse.trim().length > 0,
            wordCount,
            characterCount,
            canRequest: collegeState.hostEnabled && aiAvailable && ready,
            requestCount: readersRequestCount(setup),
            researchProvider: researchProviderLabel(),
            researchUnavailable: researchUnavailableReason(),
        };
    }

    async function save(setup: CollegeSetup | null): Promise<void> {
        assertCurrent();
        await saveCollegeSetup({ documentId: target.documentId, tabId: target.tabId }, setup);
    }

    async function retry(): Promise<void> {
        assertCurrent();
        await reloadCollegeSetup();
    }

    async function createTabsForSetups(setups: CollegeSetup[]): Promise<void> {
        assertCurrent();
        assertTabOperationReady();
        if (creatingTabs) throw new Error("College tabs are already being created.");
        creatingTabs = true;
        const documentId = target.documentId;
        try {
            if (!documentId || get(currentDocumentId) !== documentId) {
                throw new Error(STALE_SESSION_MESSAGE);
            }
            const payload = createTabPayload(setups);
            const tabs: TabMeta[] = await createCollegeTabs(documentId, payload);
            if (get(currentDocumentId) !== documentId || !collegeState.hostEnabled) return;
            appEventBus.emit({
                type: "college-tabs-created",
                documentId,
                tabs,
                selectFirst: session.isCurrent(),
            });
        } finally {
            creatingTabs = false;
        }
    }

    function validateAddedPrompt(setup: CollegeSetup, prompt: CollegePrompt): CollegePrompt {
        if (typeof prompt !== "object" || prompt === null || Array.isArray(prompt)) {
            throw new Error("The College prompt is invalid.");
        }
        if (typeof prompt.text !== "string" || prompt.text.trim().length === 0) {
            throw new Error("Enter a College prompt before adding it.");
        }
        const candidate = {
            ...cloneLoose(prompt),
            id: freshPromptId(),
        } as CollegePrompt;
        const validated = cloneCollegeSetup({
            ...setup,
            prompts: [candidate],
        });
        const [validatedPrompt] = validated.prompts;
        if (!validatedPrompt) throw new Error("The College prompt is invalid.");
        return validatedPrompt;
    }

    function migrateLegacyResearchReferences(next: CollegeSetup, current: CollegeSetup): void {
        for (const reference of next.references) {
            const research = reference.research;
            if (!research || research.promptKeys) continue;
            if (!isCollegeReferenceCurrent(reference, current)) continue;
            const scoped = promptResearchKeys(current, research.promptIds);
            if (!scoped.promptIds.length) continue;
            reference.research = {
                ...research,
                promptIds: scoped.promptIds,
                promptKeys: scoped.promptKeys,
            };
        }
    }

    type AddedPromptEdit = {
        changes: Array<{ from: number; insert: string }>;
        answerStart: number;
        proposedProse: string;
    };

    function applyTextChanges(
        prose: string,
        changes: readonly { from: number; insert: string }[],
    ): string {
        return [...changes]
            .sort((left, right) => right.from - left.from)
            .reduce(
                (value, change) =>
                    `${value.slice(0, change.from)}${change.insert}${value.slice(change.from)}`,
                prose,
            );
    }

    function buildAddedPromptEdit(
        setup: CollegeSetup,
        prose: string,
        sections: CollegeSection[],
        prompt: CollegePrompt,
    ): AddedPromptEdit {
        const heading = formatCollegePromptHeading(prompt);
        const hasHeading = sections.some((section) => section.headingFrom !== null);
        const changes: Array<{ from: number; insert: string }> = [];
        let answerStart: number;

        if (!hasHeading && !setup.sectionMode) {
            if (setup.prompts.length !== 1) {
                throw new Error(
                    "Restore the existing College prompt heading before adding another prompt.",
                );
            }
            const originalHeading = formatCollegePromptHeading(setup.prompts[0]);
            const originalInsert = `${originalHeading}\n\n`;
            if (!prose) {
                const insert = `${originalInsert}${heading}\n\n`;
                changes.push({ from: 0, insert });
                answerStart = insert.length;
            } else {
                const appended = `${sectionAppendPrefix(prose)}${heading}\n\n`;
                changes.push({ from: 0, insert: originalInsert });
                changes.push({ from: prose.length, insert: appended });
                answerStart = prose.length + originalInsert.length + appended.length;
            }
        } else {
            const appended = `${sectionAppendPrefix(prose)}${heading}\n\n`;
            changes.push({ from: prose.length, insert: appended });
            answerStart = prose.length + appended.length;
        }

        return {
            changes,
            answerStart,
            proposedProse: applyTextChanges(prose, changes),
        };
    }

    function dispatchAddedPrompt(
        view: NonNullable<ReturnType<typeof currentEditorView>>,
        setup: CollegeSetup,
        prose: string,
        sections: CollegeSection[],
        prompt: CollegePrompt,
    ): void {
        const edit = buildAddedPromptEdit(setup, prose, sections, prompt);

        view.dispatch({
            changes: edit.changes,
            selection: { anchor: edit.answerStart },
            annotations: isolateHistory.of("full"),
        });
    }

    async function addPrompt(prompt: CollegePrompt): Promise<void> {
        assertCurrent();
        assertTabOperationReady();
        if (
            !target.documentId ||
            !target.tabId ||
            !target.draftId ||
            !currentStateMatchesTarget()
        ) {
            throw new Error(STALE_SESSION_MESSAGE);
        }
        const view = currentEditorView();
        if (!view) throw new Error("The College editor is not ready. Try again shortly.");
        if (view.state.readOnly) {
            throw new Error("This College draft is read-only. Select an editable draft first.");
        }
        const stored = collegeState.setup;
        if (!stored) {
            throw new Error("Apply and activate a College setup before adding a prompt.");
        }
        const original = cloneCollegeSetup(stored);
        const prose = view.state.doc.toString();
        const sections = resolveCollegeSections(original, prose);
        if (
            !original.sectionMode &&
            !sections.some((section) => section.headingFrom !== null) &&
            original.prompts.length !== 1
        ) {
            throw new Error(
                "Restore the existing College prompt heading before adding another prompt.",
            );
        }
        const normalized = normalizedPromptText(
            typeof prompt?.text === "string" ? prompt.text : "",
        );
        if (
            normalized &&
            sections.some(
                (section) =>
                    section.headingFrom !== null &&
                    normalizedPromptText(section.prompt.text) === normalized,
            )
        ) {
            throw new Error("That College prompt is already in this tab.");
        }
        const added = validateAddedPrompt(original, prompt);
        const resolvedBefore = cloneLoose(effectiveCurrentSetup(original));
        const resolved = cloneLoose(resolvedBefore);
        resolved.prompts = [...resolved.prompts, added];
        resolved.sectionMode = true;
        const edit = buildAddedPromptEdit(original, prose, sections, added);
        const existingHeadingCount = sections.filter(
            (section) => section.headingFrom !== null,
        ).length;
        const legacyConversion = !original.sectionMode && existingHeadingCount === 0;
        const expectedHeadingCount = existingHeadingCount + (legacyConversion ? 2 : 1);
        const proposedSections = resolveCollegeSections(resolved, edit.proposedProse);
        const proposedHeadingCount = proposedSections.filter(
            (section) => section.headingFrom !== null,
        ).length;
        if (proposedHeadingCount < expectedHeadingCount) {
            throw new Error(
                "Close the current fenced code block before adding a College prompt heading.",
            );
        }
        const next = cloneLoose(archiveCollegePrompts(original, resolved));
        next.sectionMode = true;
        migrateLegacyResearchReferences(next, resolvedBefore);
        next.references.push(...bundledReferencesFor({ ...next, prompts: [added] }));

        const capturedState = view.state;
        await saveCollegeSetup({ documentId: target.documentId, tabId: target.tabId }, next);

        const stillCurrent =
            session.isCurrent() &&
            currentStateMatchesTarget() &&
            currentEditorView() === view &&
            view.state === capturedState &&
            !view.state.readOnly;
        if (!stillCurrent) {
            const currentSetup = collegeState.setup;
            if (
                currentStateMatchesTarget() &&
                currentEditorView() === view &&
                currentSetup &&
                serializeCollegeSetup(currentSetup) === serializeCollegeSetup(next)
            ) {
                try {
                    await saveCollegeSetup(
                        { documentId: target.documentId, tabId: target.tabId },
                        original,
                    );
                } catch {
                    // The target may have started another save; leave the
                    // already-persisted prompt metadata dormant rather than
                    // overwriting a newer mutation.
                }
            }
            throw new Error(
                "The College editor changed while adding a prompt. Select the current draft and try again.",
            );
        }

        dispatchAddedPrompt(view, original, prose, sections, added);
    }

    function openPanelFromCapability(id: CollegeOpenPanel): void {
        assertCurrent();
        openPanel(id);
    }

    function request(action: CollegeAction): void {
        assertCurrent();
        const state = collegeState;
        if (!state.hostEnabled) throw new Error("College applications are disabled.");
        if (state.status !== "ready" || state.saving) {
            throw new Error(
                state.error ||
                    (state.status === "loading"
                        ? "The College setup is still loading. Try again shortly."
                        : "The College setup is unavailable. Reload it before requesting AI help."),
            );
        }
        const setup = getActiveCollegeSetup();
        if (!setup || !setup.active) {
            throw new Error("Apply and activate a College setup before requesting AI help.");
        }
        if (!appSettings.aiEnabled || !hasApiKey()) {
            throw new Error("Enable AI and connect a model in Settings before requesting help.");
        }
        const prose = get(documentContent);
        if (action !== "plan" && prose.trim().length === 0) {
            throw new Error("Write some draft text before requesting College feedback.");
        }

        // Navigation is synchronous so the eager chat/feedback listeners are
        // mounted before the action event is delivered.
        openPanel(action === "plan" ? "chat" : "feedback");
        appEventBus.emit({
            type: "college-action",
            action,
            target: { ...target },
        });
    }

    async function research(
        requestedTarget: ResearchTarget,
        callerSignal: AbortSignal,
    ): Promise<ResearchResult> {
        const parsedTarget = parseResearchTarget(requestedTarget);
        const setup = assertResearchReady();
        validateResearchPrompts(parsedTarget, setup);
        if (runningResearch !== null) {
            throw new Error("School research is already in progress.");
        }

        const setupSerialized = serializeCollegeSetup(setup);
        latestResearch = null;
        const operation = Symbol("college-school-research");
        runningResearch = operation;
        const globalAbortSignal = getAiAbortSignal();
        const linkedAbort = linkAbortSignals([callerSignal, session.signal, globalAbortSignal]);
        try {
            assertResearchSignal(linkedAbort.signal);
            const result = await researchSchool(parsedTarget, linkedAbort.signal);
            assertCapturedResearchCurrent(setupSerialized, linkedAbort.signal);
            const capturedResult = cloneResearchResult(result);
            latestResearch = {
                result: capturedResult,
                setupSerialized,
                abortSignals: [callerSignal, session.signal, globalAbortSignal],
            };
            return cloneResearchResult(capturedResult);
        } finally {
            linkedAbort.cleanup();
            if (runningResearch === operation) runningResearch = null;
        }
    }

    async function acceptBundledGuidance(expectedSetup: CollegeSetup): Promise<void> {
        assertCurrent();
        assertTabOperationReady();
        if (!currentStateMatchesTarget() || session.signal.aborted) {
            throw new Error(STALE_SESSION_MESSAGE);
        }
        const stored = collegeState.setup;
        if (!stored) throw new Error(STALE_SESSION_MESSAGE);
        const effective = effectiveCurrentSetup(stored);
        if (serializeCollegeSetup(effective) !== serializeCollegeSetup(expectedSetup)) {
            throw new Error(
                "The College setup changed. Review bundled guidance again before applying it.",
            );
        }
        const preview = previewBundledGuidance(effective);
        const next = archiveCollegePrompts(stored, effective);
        next.references = preview.references;
        await saveCollegeSetup({ documentId: target.documentId, tabId: target.tabId }, next);
    }

    async function acceptResearch(
        resultId: string,
        selectedIds: string[],
        removeIds: string[],
    ): Promise<void> {
        assertCurrent();
        if (runningResearch !== null) {
            throw new Error("Finish school research before saving its findings.");
        }
        const captured = latestResearch;
        if (!captured || captured.result.id !== resultId) {
            throw new Error("This school research result is stale. Run the research again.");
        }
        if (captured.abortSignals.some((signal) => signal.aborted)) {
            throw new Error(STALE_SESSION_MESSAGE);
        }

        const setup = assertCapturedResearchAcceptable(captured);
        const storedSetup = getActiveCollegeSetup();
        if (!storedSetup) throw new Error(STALE_SESSION_MESSAGE);

        const findingsById = new Map(
            captured.result.findings.map((finding) => [finding.id, finding]),
        );
        assertResearchIds(selectedIds, new Set(findingsById.keys()), "Selected findings");

        const referencesById = new Map(
            setup.references.map((reference) => [reference.id, reference]),
        );
        assertResearchIds(removeIds, new Set(referencesById.keys()), "Removed references");
        for (const id of removeIds) {
            if (!referencesById.get(id)?.research) {
                throw new Error("Only saved research references can be removed from this review.");
            }
        }

        const next = cloneLoose(archiveCollegePrompts(storedSetup, setup));
        const removeSet = new Set(removeIds);
        next.references = next.references.filter((reference) => !removeSet.has(reference.id));

        const setupKey = collegeResearchSetupKey(setup);
        const referenceKeys = new Set(
            next.references
                .filter(
                    (reference) =>
                        !reference.research || isCollegeReferenceCurrent(reference, setup),
                )
                .map((reference) => findingKey(reference)),
        );
        for (const id of selectedIds) {
            const finding = findingsById.get(id);
            if (!finding) continue;
            const key = findingKey(finding);
            if (referenceKeys.has(key)) continue;

            const researchMetadata = finding.research;
            const scoped = promptResearchKeys(
                setup,
                researchMetadata?.promptIds ??
                    captured.result.target.prompts.map((prompt) => prompt.id),
            );
            if (!scoped.promptIds.length) continue;
            const provenance: NonNullable<CollegeReference["research"]> = {
                snapshotId: researchMetadata?.snapshotId ?? captured.result.id,
                promptIds: scoped.promptIds,
                promptKeys: scoped.promptKeys,
                school: researchMetadata?.school ?? captured.result.target.school,
                program: researchMetadata?.program ?? captured.result.target.program,
                targetCycle: researchMetadata?.targetCycle ?? captured.result.target.cycle,
                evidence: researchMetadata?.evidence ?? "",
                setupKey,
            };
            const appended: CollegeReference = {
                ...JSON.parse(JSON.stringify(finding)),
                research: provenance,
            };
            if (next.references.some((reference) => reference.id === appended.id)) {
                throw new Error(
                    "A selected research finding conflicts with an existing source ID.",
                );
            }
            next.references.push(appended);
            referenceKeys.add(key);
        }

        const selectedSet = new Set(selectedIds);
        const selectedKeys = new Set(
            selectedIds.map((id) => {
                const finding = findingsById.get(id);
                return finding ? findingKey(finding) : "";
            }),
        );
        const activeReferenceKeys = new Set(
            next.references.map((reference) => findingKey(reference)),
        );
        const rejectedKeys: string[] = [];
        const rejectedKeySet = new Set<string>();
        const addRejectedKey = (key: string): void => {
            if (
                !key ||
                selectedKeys.has(key) ||
                activeReferenceKeys.has(key) ||
                rejectedKeySet.has(key)
            ) {
                return;
            }
            rejectedKeySet.add(key);
            rejectedKeys.push(key);
        };
        for (const key of setup.researchReview?.rejectedKeys ?? []) addRejectedKey(key);
        for (const finding of captured.result.findings) {
            if (selectedSet.has(finding.id)) continue;
            addRejectedKey(findingKey(finding));
        }
        if (rejectedKeys.length > 24) rejectedKeys.splice(0, rejectedKeys.length - 24);
        next.researchReview = {
            target: cloneResearchTarget(captured.result.target),
            rejectedKeys,
            checkedDate: captured.result.checkedDate,
        };

        await saveCollegeSetup({ documentId: target.documentId, tabId: target.tabId }, next);
        if (latestResearch === captured) latestResearch = null;
    }

    return Object.freeze({
        read,
        save,
        retry,
        createTabs: createTabsForSetups,
        addPrompt,
        openPanel: openPanelFromCapability,
        request,
        research,
        acceptResearch,
        acceptBundledGuidance,
    });
}
