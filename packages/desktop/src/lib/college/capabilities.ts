// capabilities.ts — Target-scoped capabilities exposed to the College panel.
//
// A capability captures the document/tab/draft session that created it. Every
// mutating operation checks that session before touching College state or
// opening another panel, so a late click cannot act on a newly selected tab.

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
} from "$lib/stores";
import { get } from "svelte/store";
import {
    type CollegeReference,
    type CollegeSetup,
    cloneCollegeSetup,
    serializeCollegeSetup,
} from "./model";
import { UC_PROMPTS } from "./presets";
import { type ResearchResult, findingKey } from "./research";
import {
    type ResearchTarget,
    collegeResearchSetupKey,
    researchTargetSchema,
} from "./researchModel";
import {
    collegeState,
    getActiveCollegeSetup,
    reloadCollegeSetup,
    saveCollegeSetup,
} from "./state.svelte";
import { beginCollegeTabPick } from "./workspace.svelte";

export type CollegeAction = "prompt-fit" | "specificity" | "plan";
export type CollegeOpenPanel = "context" | "readers" | "settings";

export type CollegeCapabilitiesSnapshot = {
    setup: CollegeSetup | null;
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
    readonly applyToExistingTab: (setup: CollegeSetup) => void;
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

function createTabPayload(setups: CollegeSetup[]): Array<{ label: string; setupJson: string }> {
    if (setups.length < 1 || setups.length > 12) {
        throw new Error("Choose between 1 and 12 College prompts.");
    }
    return setups.map((setup) => {
        const validated = cloneCollegeSetup(setup);
        if (validated.prompts.length !== 1) {
            throw new Error("Each College tab must contain exactly one prompt.");
        }
        return {
            label: tabLabelForSetup(validated),
            setupJson: serializeCollegeSetup(validated),
        };
    });
}

type LinkedAbort = {
    signal: AbortSignal;
    cleanup: () => void;
};

function linkAbortSignals(signals: readonly AbortSignal[]): LinkedAbort {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const activeSignals: AbortSignal[] = [];

    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        }
        signal.addEventListener("abort", abort, { once: true });
        activeSignals.push(signal);
    }

    return {
        signal: controller.signal,
        cleanup: () => {
            for (const signal of activeSignals) signal.removeEventListener("abort", abort);
        },
    };
}

function cloneResearchResult(result: ResearchResult): ResearchResult {
    return JSON.parse(JSON.stringify(result)) as ResearchResult;
}

function cloneResearchTarget(target: ResearchTarget): ResearchTarget {
    return JSON.parse(JSON.stringify(target)) as ResearchTarget;
}

function abortError(): Error {
    return new Error("School research was cancelled.");
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
        throw abortError();
    }

    function currentStateMatchesTarget(): boolean {
        return (
            collegeState.documentId === target.documentId &&
            collegeState.tabId === target.tabId &&
            get(currentDocumentId) === target.documentId &&
            get(currentTabId) === target.tabId
        );
    }

    function researchUnavailable(): string {
        return researchUnavailableReason() || "";
    }

    function assertResearchReady(): CollegeSetup {
        assertCurrent();
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
        const setup = getActiveCollegeSetup();
        if (!setup || !setup.active) {
            throw new Error(
                "Apply and activate a College setup before researching a school prompt.",
            );
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
        const setup = getActiveCollegeSetup();
        if (!setup || !setup.active || serializeCollegeSetup(setup) !== setupSerialized) {
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
        const setup = getActiveCollegeSetup();
        if (!setup || !setup.active || serializeCollegeSetup(setup) !== captured.setupSerialized) {
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
        const wordCount = currentProse.trim().split(/\s+/).filter(Boolean).length;
        const characterCount = Array.from(currentProse).length;
        const aiAvailable = appSettings.aiEnabled && hasApiKey();
        const ready = collegeState.status === "ready" && !collegeState.saving;

        return {
            setup,
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

    function applyToExistingTab(setup: CollegeSetup): void {
        assertCurrent();
        assertTabOperationReady();
        if (!target.documentId || get(currentDocumentId) !== target.documentId) {
            throw new Error(STALE_SESSION_MESSAGE);
        }
        const validated = cloneCollegeSetup(setup);
        if (validated.prompts.length !== 1) {
            throw new Error("Choose exactly one prompt before applying it to a tab.");
        }
        beginCollegeTabPick(target.documentId, validated);
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

        const next = cloneCollegeSetup(setup);
        const removeSet = new Set(removeIds);
        next.references = next.references.filter((reference) => !removeSet.has(reference.id));

        const setupKey = collegeResearchSetupKey(setup);
        const referenceKeys = new Set(
            next.references
                .filter(
                    (reference) => !reference.research || reference.research.setupKey === setupKey,
                )
                .map((reference) => findingKey(reference)),
        );
        for (const id of selectedIds) {
            const finding = findingsById.get(id);
            if (!finding) continue;
            const key = findingKey(finding);
            if (referenceKeys.has(key)) continue;

            const researchMetadata = finding.research;
            const appended: CollegeReference = {
                ...JSON.parse(JSON.stringify(finding)),
                research: {
                    snapshotId: researchMetadata?.snapshotId ?? captured.result.id,
                    promptIds:
                        researchMetadata?.promptIds ??
                        captured.result.target.prompts.map((prompt) => prompt.id),
                    school: researchMetadata?.school ?? captured.result.target.school,
                    program: researchMetadata?.program ?? captured.result.target.program,
                    targetCycle: researchMetadata?.targetCycle ?? captured.result.target.cycle,
                    evidence: researchMetadata?.evidence ?? "",
                    setupKey,
                },
            };
            if (next.references.some((reference) => reference.id === appended.id)) {
                throw new Error(
                    "A selected research finding conflicts with an existing source ID.",
                );
            }
            next.references.push(appended);
            referenceKeys.add(key);
        }

        if (next.references.length > 12) {
            throw new Error("This tab can keep at most 12 sources. Remove existing sources first.");
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
        applyToExistingTab,
        openPanel: openPanelFromCapability,
        request,
        research,
        acceptResearch,
    });
}
