// capabilities.ts — Target-scoped capabilities exposed to the College panel.
//
// A capability captures the document/tab/draft session that created it. Every
// mutating operation checks that session before touching College state or
// opening another panel, so a late click cannot act on a newly selected tab.

import { getEffectiveDocumentContext, hasApiKey } from "$lib/ai/settings.svelte";
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
import { type CollegeSetup, cloneCollegeSetup } from "./model";
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
    canRequest: boolean;
    requestCount: number;
};

export interface CollegeCapabilities {
    readonly read: () => CollegeCapabilitiesSnapshot;
    readonly save: (setup: CollegeSetup | null) => Promise<void>;
    readonly retry: () => Promise<void>;
    readonly openPanel: (id: CollegeOpenPanel) => void;
    readonly request: (action: CollegeAction) => void;
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

    function assertCurrent(): void {
        if (!session.isCurrent()) throw new Error(STALE_SESSION_MESSAGE);
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
            canRequest: false,
            requestCount: 1,
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
            canRequest: collegeState.hostEnabled && aiAvailable && ready,
            requestCount: readersRequestCount(setup),
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

    return Object.freeze({
        read,
        save,
        retry,
        openPanel: openPanelFromCapability,
        request,
    });
}
