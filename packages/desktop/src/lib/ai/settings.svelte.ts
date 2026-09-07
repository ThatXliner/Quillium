import {
    getDocumentEditorialDecisions,
    getDocumentWriterBrief,
    setDocumentEditorialDecisions,
    setDocumentWriterBrief,
} from "$lib/db";
import { appEventBus } from "$lib/events/appEventBus";
import { currentDocumentId, currentDraftId } from "$lib/stores";
/**
 * Reactive AI settings store (Svelte 5 runes).
 *
 * This file is the single source of truth for all user-configurable AI
 * state. It owns three reactive objects:
 *
 * - `aiSettings` — provider, model ID, and API key (key loaded from
 *   the system keychain via Tauri at startup).
 * - `documentContext` — the active document's writer brief and explicit editorial
 *   decisions, persisted in SQLite.
 * - `personaModes` — per-mode opt-in for reader personas (default OFF
 *   because personas multiply token cost); persisted to localStorage.
 * - `aiProcessing` — boolean flag consumed by the sidebar glow
 *   animation; toggled by each chat component via `setAiProcessing`.
 *
 * Persistence strategy:
 *   provider/model  -> localStorage
 *   API key         -> system keychain (via Tauri `get_api_key` /
 *                      `set_api_key` commands)
 *   documentContext -> SQLite, scoped by document
 *
 * Data flow:
 *   AISettings.svelte  -->  aiSettings / documentContext (writes)
 *   chatFactory.ts     <--  aiSettings (reads provider/model/key)
 *   clientStreams.ts    <--  documentContext (reads context fields)
 *   Sidebar.svelte      <--  aiProcessing (reads glow flag)
 */
import { invoke } from "@tauri-apps/api/core";
import type { UIMessage } from "ai";
import { untrack } from "svelte";
import { derived, get } from "svelte/store";
import {
    DEFAULT_EDITORIAL_PREFERENCES,
    type EditorialPreferences,
    type EditorialStance,
    type FeedbackDensity,
    type VoiceLatitude,
} from "./editorialPolicy";
import {
    type AiConversationMode,
    isPersistentConversationMode,
    loadAiConversation,
} from "./persistence";
import type { Provider } from "./provider";

const PROVIDER_KEY = "quillium-ai-provider";
const MODEL_KEY = "quillium-ai-model";
const BASE_URL_KEY = "quillium-ai-base-url";
const DOCUMENT_CONTEXT_KEY = "quillium-document-context";
const PERSONA_MODES_KEY = "quillium-ai-persona-modes";
const EDITORIAL_PREFERENCES_KEY = "quillium-ai-editorial-preferences";
export const HAS_API_KEY_KEY = "quillium-has-api-key";
export const HAS_OPENAI_OAUTH_KEY = "quillium-has-openai-oauth";

export type DocumentContext = {
    freeform: string;
    decisions: string[];
};

function loadLegacyDocumentContext(): Pick<DocumentContext, "freeform"> {
    if (typeof localStorage === "undefined") return { freeform: "" };
    try {
        const stored = localStorage.getItem(DOCUMENT_CONTEXT_KEY);
        if (stored) {
            const parsed = JSON.parse(stored) as Partial<DocumentContext> | null;
            if (typeof parsed?.freeform === "string") return { freeform: parsed.freeform };
        }
    } catch {}
    return { freeform: "" };
}

const legacyDocumentContext = loadLegacyDocumentContext();

let documentContextDocumentId: string | null = null;
let documentContextReady = false;
let legacyDocumentContextClaimed = false;

function parseEditorialDecisions(value: string | null): string[] {
    if (!value) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((decision): decision is string => typeof decision === "string")
            .map((decision) => decision.trim())
            .filter((decision) => decision.length > 0 && decision.length <= 500);
    } catch {
        return [];
    }
}

function persistDocumentContext(documentId: string, context: DocumentContext): Promise<void> {
    return Promise.all([
        setDocumentWriterBrief(documentId, context.freeform),
        setDocumentEditorialDecisions(documentId, JSON.stringify(context.decisions)),
    ]).then(() => undefined);
}

export function saveDocumentContext() {
    if (!documentContextDocumentId || !documentContextReady) return;
    void persistDocumentContext(documentContextDocumentId, {
        freeform: documentContext.freeform,
        decisions: [...documentContext.decisions],
    }).catch((error) => {
        console.error("[aiSettings] failed to save document context", error);
    });
}

export const documentContext = $state<DocumentContext>({ freeform: "", decisions: [] });

export function hasDocumentContext(): boolean {
    return documentContext.freeform.trim().length > 0 || documentContext.decisions.length > 0;
}

/** Loads the writer brief for each active document and flushes the old one before switching. */
export function useDocumentContextEffects() {
    $effect(() => {
        let generation = 0;
        // Store subscriptions run synchronously during effect setup. Keep context reads and writes
        // untracked so remounting the sidebar cannot make this effect depend on its own mutations.
        return currentDocumentId.subscribe((documentId) =>
            untrack(() => {
                generation += 1;
                const loadGeneration = generation;
                if (documentContextDocumentId && documentContextReady) {
                    void persistDocumentContext(documentContextDocumentId, {
                        freeform: documentContext.freeform,
                        decisions: [...documentContext.decisions],
                    }).catch((error) => {
                        console.error("[aiSettings] failed to save document context", error);
                    });
                }

                documentContextDocumentId = documentId;
                documentContextReady = false;
                documentContext.freeform = "";
                documentContext.decisions = [];
                if (!documentId) return;
                const loadingFreeform = documentContext.freeform;
                const loadingDecisions = documentContext.decisions;

                void Promise.all([
                    getDocumentWriterBrief(documentId),
                    getDocumentEditorialDecisions(documentId),
                ])
                    .then(async ([writerBrief, decisionsJson]) => {
                        if (
                            loadGeneration !== generation ||
                            documentId !== get(currentDocumentId)
                        ) {
                            return;
                        }
                        if (
                            documentContext.freeform !== loadingFreeform ||
                            documentContext.decisions !== loadingDecisions
                        ) {
                            documentContextReady = true;
                            saveDocumentContext();
                            return;
                        }

                        if (
                            writerBrief === null &&
                            !legacyDocumentContextClaimed &&
                            legacyDocumentContext.freeform.trim()
                        ) {
                            legacyDocumentContextClaimed = true;
                            documentContext.freeform = legacyDocumentContext.freeform;
                            await setDocumentWriterBrief(documentId, documentContext.freeform);
                            if (
                                loadGeneration !== generation ||
                                documentId !== get(currentDocumentId)
                            ) {
                                return;
                            }
                            if (typeof localStorage !== "undefined") {
                                localStorage.removeItem(DOCUMENT_CONTEXT_KEY);
                            }
                        } else {
                            documentContext.freeform = writerBrief ?? "";
                        }
                        documentContext.decisions = parseEditorialDecisions(decisionsJson);
                        documentContextReady = true;
                    })
                    .catch((error) => {
                        if (loadGeneration !== generation) return;
                        documentContextReady = true;
                        console.error("[aiSettings] failed to load document context", error);
                    });
            }),
        );
    });

    $effect(() => {
        const writerBrief = documentContext.freeform;
        const decisions = [...documentContext.decisions];
        if (!documentContextDocumentId || !documentContextReady) return;
        const documentId = documentContextDocumentId;
        const timer = setTimeout(() => {
            void persistDocumentContext(documentId, {
                freeform: writerBrief,
                decisions,
            }).catch((error) => {
                console.error("[aiSettings] failed to save document context", error);
            });
        }, 350);
        return () => clearTimeout(timer);
    });
}

// ---------------------------------------------------------------------------
// Per-mode persona opt-in.
//
// Reader personas fan a single request out into one parallel AI stream PER
// enabled persona, so they cost roughly N× the tokens of a normal request.
// Because of that they default to OFF and are an explicit, per-mode opt-in:
// each mode (feedback / revise) remembers its own choice. When a mode's flag
// is false the panel uses a single plain stream regardless of how many
// personas are enabled in the Readers tab. See GitHub issue #259.
// ---------------------------------------------------------------------------
export type PersonaMode = "feedback" | "revise";
export type PersonaModes = Record<PersonaMode, boolean>;

function loadPersonaModes(): PersonaModes {
    const defaults: PersonaModes = { feedback: false, revise: false };
    if (typeof localStorage === "undefined") return defaults;
    try {
        const stored = localStorage.getItem(PERSONA_MODES_KEY);
        if (stored) {
            const parsed = JSON.parse(stored) as Partial<PersonaModes>;
            return {
                feedback: typeof parsed.feedback === "boolean" ? parsed.feedback : false,
                revise: typeof parsed.revise === "boolean" ? parsed.revise : false,
            };
        }
    } catch {}
    return defaults;
}

export const personaModes = $state<PersonaModes>(loadPersonaModes());

export function personasEnabledFor(mode: PersonaMode): boolean {
    return personaModes[mode];
}

export function setPersonasForMode(mode: PersonaMode, enabled: boolean) {
    personaModes[mode] = enabled;
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(PERSONA_MODES_KEY, JSON.stringify(personaModes));
    }
}

const EDITORIAL_STANCES = new Set<EditorialStance>([
    "author-first",
    "collaborative",
    "exploratory",
]);
const FEEDBACK_DENSITIES = new Set<FeedbackDensity>(["quiet", "focused", "thorough"]);
const VOICE_LATITUDES = new Set<VoiceLatitude>(["preserve", "adapt", "transform"]);

function loadEditorialPreferences(): EditorialPreferences {
    if (typeof localStorage === "undefined") return { ...DEFAULT_EDITORIAL_PREFERENCES };
    try {
        const stored = localStorage.getItem(EDITORIAL_PREFERENCES_KEY);
        if (!stored) return { ...DEFAULT_EDITORIAL_PREFERENCES };
        const parsed = JSON.parse(stored) as Partial<EditorialPreferences>;
        return {
            stance: EDITORIAL_STANCES.has(parsed.stance as EditorialStance)
                ? (parsed.stance as EditorialStance)
                : DEFAULT_EDITORIAL_PREFERENCES.stance,
            feedbackDensity: FEEDBACK_DENSITIES.has(parsed.feedbackDensity as FeedbackDensity)
                ? (parsed.feedbackDensity as FeedbackDensity)
                : DEFAULT_EDITORIAL_PREFERENCES.feedbackDensity,
            voiceLatitude: VOICE_LATITUDES.has(parsed.voiceLatitude as VoiceLatitude)
                ? (parsed.voiceLatitude as VoiceLatitude)
                : DEFAULT_EDITORIAL_PREFERENCES.voiceLatitude,
        };
    } catch {
        return { ...DEFAULT_EDITORIAL_PREFERENCES };
    }
}

export const editorialPreferences = $state<EditorialPreferences>(loadEditorialPreferences());

export function persistEditorialPreferences() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(EDITORIAL_PREFERENCES_KEY, JSON.stringify(editorialPreferences));
}

// ---------------------------------------------------------------------------
// AI processing indicator — purely for UI feedback (e.g. sidebar glow).
// Long-running requests should use beginAiTask/endAiTask so overlapping
// requests keep the indicator active until the last one finishes. The older
// setAiProcessing API remains as a compatibility wrapper.
// ---------------------------------------------------------------------------
export const aiProcessing = $state({ active: false });

const aiTasks = new Set<symbol>();
let legacyProcessing = false;

function syncAiProcessing() {
    aiProcessing.active = legacyProcessing || aiTasks.size > 0;
}

export function beginAiTask(label = "ai"): symbol {
    const task = Symbol(label);
    aiTasks.add(task);
    syncAiProcessing();
    return task;
}

export function endAiTask(task: symbol | null | undefined) {
    if (!task) return;
    aiTasks.delete(task);
    syncAiProcessing();
}

export function setAiProcessing(value: boolean) {
    legacyProcessing = value;
    syncAiProcessing();
}

/**
 * Wire up the standard processing-indicator and stop-listener effects
 * for a Chat instance. Must be called during component initialisation
 * (i.e. at the top-level of a Svelte component's `<script>` block) so
 * `$effect` has a valid owner.
 */
export function useAiChatEffects(
    chat: {
        status: string;
        stop: () => void;
        messages: UIMessage[];
    },
    mode: AiConversationMode | "dictionary",
) {
    let processingTask: symbol | null = null;

    $effect(() => {
        const active = chat.status === "submitted" || chat.status === "streaming";
        if (active && !processingTask) processingTask = beginAiTask("chat");
        if (!active && processingTask) {
            endAiTask(processingTask);
            processingTask = null;
        }
    });

    $effect(() => {
        const unsub = appEventBus.on("stop-ai", () => {
            if (chat.status === "submitted" || chat.status === "streaming") {
                chat.stop();
            }
        });
        return unsub;
    });

    $effect(() => {
        let generation = 0;
        const scope = derived([currentDocumentId, currentDraftId], ([$documentId, $draftId]) => ({
            documentId: $documentId,
            draftId: $draftId,
        }));
        return scope.subscribe(({ documentId, draftId }) =>
            untrack(() => {
                generation += 1;
                const loadGeneration = generation;
                if (chat.status === "submitted" || chat.status === "streaming") chat.stop();
                chat.messages = [];
                const loadingPlaceholder = chat.messages;

                if (!documentId || !draftId || !isPersistentConversationMode(mode)) return;
                void loadAiConversation(draftId, mode)
                    .then((messages) => {
                        if (
                            loadGeneration !== generation ||
                            documentId !== get(currentDocumentId) ||
                            draftId !== get(currentDraftId) ||
                            chat.status !== "ready" ||
                            chat.messages !== loadingPlaceholder
                        ) {
                            return;
                        }
                        chat.messages = messages;
                    })
                    .catch((error) => {
                        if (loadGeneration !== generation) return;
                        console.error("[aiSettings] failed to load AI conversation", error);
                    });
            }),
        );
    });
}

/**
 * Global abort controller for all AI requests. Calling `stopAllAi()`
 * aborts any in-flight streams and emits an app event so each panel
 * can call `chat.stop()` on its own Chat instance.
 */
let _aiAbortController: AbortController | null = null;

export function getAiAbortSignal(): AbortSignal {
    if (!_aiAbortController) _aiAbortController = new AbortController();
    return _aiAbortController.signal;
}

export function stopAllAi() {
    if (_aiAbortController) {
        _aiAbortController.abort();
        _aiAbortController = null;
    }
    appEventBus.emit({ type: "stop-ai" });
    aiTasks.clear();
    legacyProcessing = false;
    aiProcessing.active = false;
}

function loadString(key: string, defaultValue: string): string {
    if (typeof localStorage === "undefined") return defaultValue;
    return localStorage.getItem(key) ?? defaultValue;
}

function loadBaseUrl(): string {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem(BASE_URL_KEY) ?? "";
}

export const aiSettings = $state({
    provider: loadString(PROVIDER_KEY, "openai") as Provider,
    model: loadString(MODEL_KEY, "gpt-5.6-sol"),
    apiKey: "",
    baseURL: loadBaseUrl(),
});

export const aiConnectionState = $state({
    oauthConnected:
        typeof localStorage !== "undefined" && !!localStorage.getItem(HAS_OPENAI_OAUTH_KEY),
});

export function setOpenAIOAuthConnected(connected: boolean) {
    aiConnectionState.oauthConnected = connected;
    if (typeof localStorage === "undefined") return;
    if (connected) {
        localStorage.setItem(HAS_OPENAI_OAUTH_KEY, "1");
    } else {
        localStorage.removeItem(HAS_OPENAI_OAUTH_KEY);
    }
}

export function hasApiKey(): boolean {
    if (aiSettings.provider === "openai-oauth") {
        return aiConnectionState.oauthConnected;
    }
    if (aiSettings.provider === "openai-compatible") return aiSettings.baseURL.trim().length > 0;
    if (aiSettings.apiKey.trim().length > 0) return true;
    // The key hasn't loaded from the keychain yet, but we know one
    // exists — avoid flashing "no API key" UI on startup.
    if (typeof localStorage !== "undefined" && !!localStorage.getItem(HAS_API_KEY_KEY)) {
        return true;
    }
    return false;
}

export async function loadApiKeyForProvider(provider: Provider) {
    if (provider === "openai-oauth") {
        aiSettings.apiKey = "";
        return;
    }
    try {
        const key = await invoke<string | null>("get_api_key", { provider });
        aiSettings.apiKey = key ?? "";
    } catch {
        aiSettings.apiKey = "";
    }
}

// Lazy-load the API key on first access rather than at module import
// time. This avoids triggering the macOS keychain permission prompt
// immediately on app startup — the prompt will only appear when the
// user actually interacts with AI features.
let _apiKeyLoadPromise: Promise<void> | null = null;

export function ensureApiKeyLoaded(): Promise<void> {
    if (aiSettings.provider === "openai-oauth") {
        aiSettings.apiKey = "";
        return Promise.resolve();
    }
    if (_apiKeyLoadPromise) return _apiKeyLoadPromise;
    if (typeof window === "undefined" || !localStorage.getItem(HAS_API_KEY_KEY)) {
        return Promise.resolve();
    }
    _apiKeyLoadPromise = loadApiKeyForProvider(aiSettings.provider);
    return _apiKeyLoadPromise;
}

/**
 * Reset the cached API-key load promise so that the next call to
 * `ensureApiKeyLoaded()` will re-check localStorage / the keychain.
 * Called after the user deletes their API key.
 */
export function resetApiKeyLoadPromise() {
    _apiKeyLoadPromise = null;
}

export function persistBaseUrl(url: string) {
    if (typeof localStorage === "undefined") return;
    if (url) {
        localStorage.setItem(BASE_URL_KEY, url);
    } else {
        localStorage.removeItem(BASE_URL_KEY);
    }
    aiSettings.baseURL = url;
}
