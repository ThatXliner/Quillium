<!--
    +page.svelte — Three-panel layout orchestrator and overlay host.

    This is the sole route in the SvelteKit app (static SPA for Tauri).
    It assembles the three main panels:
      1. <AiSidebar />    — left panel (AI writing assistant)
      2. <Editor />        — center panel (CodeMirror document)
      3. Annotations panel — rendered inside Editor.svelte

    It also hosts two overlay layers:
      - The tutorial overlay (shown on first visit or via "?" button)
      - The modal stack (nested revision/diff modals, rendered from
        the global `modalStack` store)

    State interactions:
      - Reads `tutorialActive` to conditionally show <Tutorial>.
      - Reads `modalStack` to render the stack of revision/diff modals.
      - Writes `tutorialActive = true` on mount if the user hasn't
        completed the tutorial (checked via localStorage).
-->
<script lang="ts">
import { page } from "$app/state";
import AiSidebar from "$lib/ai/AISidebar.svelte";
import { getConnectionState, initAuth, isLoading, isOffline, reconnectAuth } from "$lib/auth";
import AuthButton from "$lib/auth/AuthButton.svelte";
import AuthModal from "$lib/auth/AuthModal.svelte";
import GoLiveButton from "$lib/collab/GoLiveButton.svelte";
import { APP_STORE_URL } from "$lib/constants";
import type { EventPayload } from "$lib/db/events";
import DebugPanel from "$lib/debug/DebugPanel.svelte";
import { debugPanelActive } from "$lib/debug/store.svelte";
import DictionaryPopover from "$lib/editor/DictionaryPopover.svelte";
import Editor from "$lib/editor/Editor.svelte";
import HarperTooltip from "$lib/editor/harper/HarperTooltip.svelte";
import CommentModal from "$lib/editor/plugins/annotations/CommentModal.svelte";
import DiffModal from "$lib/editor/plugins/annotations/DiffModal.svelte";
import RevisionModal from "$lib/editor/plugins/annotations/RevisionModal.svelte";
import { restoreBackup } from "$lib/editor/restore";
import type { BackupEntry } from "$lib/errorGuard";
import { exportDocument } from "$lib/export";
import {
    maybeShowAutoSurvey,
    recordWordCount,
    registerSurveyLifecycleListeners,
} from "$lib/feedback/autoSurvey";
import { goToAuthorship, goToHistory, goToLibrary } from "$lib/navigation";
import { showFeedbackSurvey } from "$lib/posthog";
import { appSettings, applySettings, persistSettings } from "$lib/settings.svelte";
import {
    currentDocumentId,
    editorView,
    modalStack,
    settingsOpen,
    statsOpen,
    tutorialActive,
    writingStats,
} from "$lib/stores";
import Tutorial from "$lib/tutorial/Tutorial.svelte";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { onMount } from "svelte";

// On MAS builds the updater/process plugins are not registered, but we still
// check for updates and show the banner — clicking it opens the App Store instead.
const MAS_BUILD = import.meta.env.VITE_MAS === "true";

// On mobile (iOS/Android) the updater + process plugins are gated out of the
// Rust build entirely (see src-tauri/src/lib.rs), so any check()/relaunch()
// invoke would reject. Updates ship via the App Store / Play Store. Detect the
// mobile webview via user-agent and skip the desktop self-update flow.
// iPadOS 13+ reports a desktop ("Macintosh") user-agent in WKWebView, so the
// UA regex alone misses iPad. A Macintosh UA WITH touch points is an iPad (real
// Macs report maxTouchPoints === 0), so fold that case in.
const IS_MOBILE =
    typeof navigator !== "undefined" &&
    (/android|iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
import AutoAIWidget from "$lib/autoai/AutoAIWidget.svelte";
import { triggerManualReview } from "$lib/autoai/engine";
import { autoAISettings } from "$lib/autoai/settings.svelte";
import changelog from "$lib/changelog.json";
import WordCountOverlay from "$lib/editor/WordCountOverlay.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import type { ExportFormat } from "$lib/export";
import posthog from "$lib/posthog";
import StatsModal from "$lib/stats/StatsModal.svelte";
import AppLogsModal from "$lib/ui/AppLogsModal.svelte";
import BetaDisclaimer from "$lib/ui/BetaDisclaimer.svelte";
import BottomLeftStack from "$lib/ui/BottomLeftStack.svelte";
import ChangelogModal from "$lib/ui/ChangelogModal.svelte";
import LicensesModal from "$lib/ui/LicensesModal.svelte";
import MobileFormatBar from "$lib/ui/MobileFormatBar.svelte";
import MobileMenu from "$lib/ui/MobileMenu.svelte";
import UpdateBanner from "$lib/ui/UpdateBanner.svelte";
import { isGithubRateLimitUpdateError } from "$lib/updater/errors";
import { canCheckForUpdatesNow, deferUpdateChecksAfterRateLimit } from "$lib/updater/schedule";
import { Toaster, toast } from "svelte-sonner";

// If opened as a secondary window with a specific document (URL `/?doc=<id>`),
// set it immediately so Editor.svelte's fromSave picks it up on mount.
const initialDocId = page.url.searchParams.get("doc");
if (initialDocId) {
    currentDocumentId.set(initialDocId);
}

let authModalOpen = $state(false);
let showBetaDisclaimer = $state(false);
let showChangelog = $state(false);
let licensesOpen = $state(false);
let appLogsOpen = $state(false);
let changelogEntry = $state<{ date: string; content: string; version: string } | null>(null);
let updateAvailable = $state(false);
let updateVersion = $state("");
let updateInstalling = $state(false);
let updateReady = $state(false);
// DEV only: allows the debug panel to simulate the banner in either mode.
let debugMasMode = $state<boolean | null>(null);
let effectiveMasMode = $derived(debugMasMode !== null ? debugMasMode : MAS_BUILD);
let authReconnecting = $state(false);
const authLoading = $derived(isLoading());
const authOffline = $derived(isOffline());
const authConnectionState = $derived(getConnectionState());

let editorComponent = $state<{ reload: () => Promise<void>; startEditingTitle: () => void }>();

const betaAccepted = () => !!localStorage.getItem("quillium_beta_accepted");

/** Show the tutorial on first visit if the user hasn't seen it. */
function showTutorialOnFirstVisit() {
    if (!localStorage.getItem("quillium_tutorial_seen")) {
        $tutorialActive = true;
    } else if (!betaAccepted()) {
        // Tutorial already seen (e.g. returning user from private beta),
        // but beta terms not yet accepted — show disclaimer directly.
        showBetaDisclaimer = true;
    } else {
        tryShowChangelog();
    }
}

function handleTutorialComplete() {
    if (!betaAccepted()) {
        showBetaDisclaimer = true;
    } else {
        tryShowChangelog();
    }
}

const CHANGELOG_SEEN_KEY = "quillium_changelog_seen";

/**
 * Extract "major.minor" prefix from a full version string.
 * "0.12.3" → "0.12", "1.2.0-beta" → "1.2"
 */
function minorVersion(version: string): string {
    const parts = version.split(".");
    return `${parts[0]}.${parts[1]}`;
}

/**
 * Compare two "major.minor" version strings.
 * Returns true if a > b.
 */
function isNewerMinor(a: string, b: string): boolean {
    const [aMaj, aMin] = a.split(".").map(Number);
    const [bMaj, bMin] = b.split(".").map(Number);
    return aMaj > bMaj || (aMaj === bMaj && aMin > bMin);
}

function tryShowChangelog() {
    const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
    if (appVersion === "dev") return;

    const currentMinor = minorVersion(appVersion);
    const entry = (changelog as Record<string, { date: string; content: string }>)[currentMinor];
    if (!entry) return;

    const lastSeen = localStorage.getItem(CHANGELOG_SEEN_KEY) ?? "0.0";
    if (!isNewerMinor(currentMinor, lastSeen)) return;

    changelogEntry = { ...entry, version: currentMinor };
    showChangelog = true;
}

function forceShowChangelog(event?: { version?: string }) {
    const log = changelog as Record<string, { date: string; content: string }>;
    const entries = Object.entries(log);
    if (entries.length === 0) return;
    // Show the requested version, or the latest (entries are newest-first).
    const version = event?.version ?? entries[0][0];
    const entry = log[version];
    if (!entry) return;
    changelogEntry = { ...entry, version };
    showChangelog = true;
}

function handleChangelogDismiss() {
    // Only advance the seen-version marker — browsing an older changelog from
    // the dropdown must not regress (or re-trigger) the auto-show tracking.
    if (changelogEntry) {
        const lastSeen = localStorage.getItem(CHANGELOG_SEEN_KEY) ?? "0.0";
        if (isNewerMinor(changelogEntry.version, lastSeen)) {
            localStorage.setItem(CHANGELOG_SEEN_KEY, changelogEntry.version);
        }
    }
    showChangelog = false;
    // Return focus to the editor so the user can keep typing (#122)
    $editorView?.focus();
}

function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        goToLibrary();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        e.preventDefault();
        editorComponent?.startEditingTitle();
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "e") {
        e.preventDefault();
        const view = $editorView;
        if (view) exportDocument(view, "txt");
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "h") {
        e.preventDefault();
        goToHistory();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        $settingsOpen = !$settingsOpen;
    }
    if (e.metaKey || e.ctrlKey) {
        if (e.key === "=" || e.key === "+") {
            e.preventDefault();
            appSettings.uiZoom = Math.round(Math.min(2, appSettings.uiZoom + 0.1) * 10) / 10;
            applySettings(appSettings);
            persistSettings();
        } else if (e.key === "-") {
            e.preventDefault();
            appSettings.uiZoom = Math.round(Math.max(0.5, appSettings.uiZoom - 0.1) * 10) / 10;
            applySettings(appSettings);
            persistSettings();
        } else if (e.key === "0") {
            e.preventDefault();
            appSettings.uiZoom = 1;
            applySettings(appSettings);
            persistSettings();
        }
    }
}

// In-app menu (mobile) — reuse the SAME export path the native menu uses.
function handleMobileExport(format: ExportFormat) {
    const view = $editorView;
    if (view) exportDocument(view, format);
}

async function installUpdate() {
    if (effectiveMasMode) {
        posthog.capture("update_app_store_opened", { version: updateVersion });
        await openUrl(APP_STORE_URL);
        return;
    }
    updateInstalling = true;
    try {
        if (updateReady) {
            posthog.capture("update_relaunched", { version: updateVersion });
            await relaunch();
        } else {
            posthog.capture("update_started", { version: updateVersion });
            const update = await check();
            if (update) {
                await update.downloadAndInstall();
                updateReady = true;
                posthog.capture("update_ready", { version: updateVersion });
            }
            updateInstalling = false;
        }
    } catch (e) {
        console.error("Update install failed:", e);
        posthog.capture("update_failed", { version: updateVersion, error: String(e) });
        updateInstalling = false;
    }
}

async function handleAuthReconnect() {
    authReconnecting = true;
    try {
        const connected = await reconnectAuth();
        if (!connected) {
            toast.error("Still offline");
        }
    } catch {
        toast.error("Still offline");
    } finally {
        authReconnecting = false;
    }
}

onMount(() => {
    // Initialize auth state
    initAuth();

    showTutorialOnFirstVisit();

    // Check for updates silently in the background.
    // On MAS builds the banner redirects to the App Store instead of self-updating.
    // On mobile the updater plugin isn't registered, so skip entirely.
    if (!IS_MOBILE && appSettings.checkForUpdates && canCheckForUpdatesNow()) {
        check()
            .then((update) => {
                if (update) {
                    const skipped = localStorage.getItem("quillium_skipped_update");
                    if (skipped === update.version) return;
                    updateAvailable = true;
                    updateVersion = update.version;
                    posthog.capture("update_available", { version: update.version });
                }
            })
            .catch((error) => {
                if (isGithubRateLimitUpdateError(error)) {
                    deferUpdateChecksAfterRateLimit(error);
                    return;
                }
                toast.error("Unable to check for updates", {
                    description:
                        "https://github.com/ThatXliner/quillium-releases could not be reached",
                });
            });
    }

    // Handle crash-restore events dispatched by ErrorBanner.svelte.
    function handleRestoreBackup(backup: BackupEntry) {
        const view = $editorView;
        if (!view) return;
        restoreBackup(view, backup.documentText);
    }

    function handleManualReviewEvent() {
        if (appSettings.aiEnabled && autoAISettings.enabled) triggerManualReview();
    }

    function handleShowUpdateBanner(version: string, mas: boolean) {
        updateVersion = version;
        updateAvailable = true;
        updateReady = false;
        updateInstalling = false;
        debugMasMode = mas;
    }

    function handleShowAuthModal() {
        authModalOpen = true;
    }

    const unsubRestoreBackup = appEventBus.on("restore-backup", (event) => {
        handleRestoreBackup(event.backup);
    });
    const unsubManualReview = appEventBus.on("manual-review", handleManualReviewEvent);
    const unsubShowChangelog = appEventBus.on("show-changelog", forceShowChangelog);
    const unsubShowUpdateBanner = appEventBus.on("show-update-banner", (event) => {
        handleShowUpdateBanner(event.version, event.mas);
    });
    const unsubShowAuthModal = appEventBus.on("show-auth-modal", handleShowAuthModal);
    const unsubShowLicenses = appEventBus.on("show-licenses", () => {
        licensesOpen = true;
    });

    // Feedback survey: keep dismiss/submit backoff timers in sync, accrue the
    // cumulative-words engagement signal, then check whether the user is
    // eligible for an automatic prompt on this launch.
    const unsubSurveyLifecycle = registerSurveyLifecycleListeners();
    const unsubWordCount = writingStats.subscribe((s) => recordWordCount(s.words));
    maybeShowAutoSurvey();

    // Listen for Tauri menu events
    let destroyed = false;
    const menuUnlisteners: UnlistenFn[] = [];
    listen("menu:settings", () => {
        if (!destroyed) $settingsOpen = !$settingsOpen;
    }).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));
    listen("menu:history", () => {
        if (!destroyed) goToHistory();
    }).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));
    listen("menu:authorship", () => {
        if (!destroyed) goToAuthorship();
    }).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));
    listen("menu:library", () => {
        if (!destroyed) goToLibrary();
    }).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));
    listen("menu:licenses", () => {
        if (!destroyed) licensesOpen = !licensesOpen;
    }).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));
    listen("menu:feedback", () => {
        if (!destroyed) showFeedbackSurvey("menu");
    }).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));
    listen("menu:app-logs", () => {
        if (!destroyed) appLogsOpen = true;
    }).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));
    listen("menu:export-txt", () => {
        const view = $editorView;
        if (!destroyed && view) exportDocument(view, "txt");
    }).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));
    listen("menu:export-txt-json", () => {
        const view = $editorView;
        if (!destroyed && view) exportDocument(view, "txt+json");
    }).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));
    listen("menu:export-json", () => {
        const view = $editorView;
        if (!destroyed && view) exportDocument(view, "json");
    }).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));
    listen("menu:export-md", () => {
        const view = $editorView;
        if (!destroyed && view) exportDocument(view, "md");
    }).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));
    listen("menu:export-pdf", () => {
        const view = $editorView;
        if (!destroyed && view) exportDocument(view, "pdf");
    }).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));
    listen("menu:export-pdf-annotations", () => {
        const view = $editorView;
        if (!destroyed && view) exportDocument(view, "pdf+annotations");
    }).then((u) => (destroyed ? u() : menuUnlisteners.push(u)));

    return () => {
        destroyed = true;
        unsubRestoreBackup();
        unsubManualReview();
        unsubShowChangelog();
        unsubShowUpdateBanner();
        unsubShowAuthModal();
        unsubShowLicenses();
        unsubSurveyLifecycle();
        unsubWordCount();
        for (const unlisten of menuUnlisteners) unlisten();
    };
});

// DEV only: expose window.__runScenario__(id) for the screenshot script.
// Runs the same save+reload cycle as DebugPanel without opening the panel UI.
if (import.meta.env.DEV) {
    onMount(async () => {
        const { scenarios } = await import("$lib/debug/scenarios");
        const { EditorState } = await import("@codemirror/state");
        const { EditorView } = await import("@codemirror/view");
        const { getExtensions, savedFields } = await import("$lib/editor/extensions");
        const {
            resetDb,
            createDocument,
            createDraft,
            appendEvent,
            createSnapshot,
            updateDocumentMeta,
        } = await import("$lib/db");
        const { buildEventPayload } = await import("$lib/editor/listeners");
        const { currentDocumentId, currentDocumentTitle, currentDraftId } = await import(
            "$lib/stores"
        );

        const { createRevision } = await import("$lib/editor/plugins/annotations");

        (window as unknown as Record<string, unknown>).__modalStack__ = modalStack;
        (window as unknown as Record<string, unknown>).__editorView__ = editorView;
        (window as unknown as Record<string, unknown>).__createRevision__ = createRevision;
        // Client-side nav to the authorship playback page, preserving the
        // stores seeded by __runScenario__ (a full page.goto would reset them).
        (window as unknown as Record<string, unknown>).__goToAuthorship__ = () => goToAuthorship();

        (window as unknown as Record<string, unknown>).__runScenario__ = async (id: string) => {
            const scenario = scenarios.find((s) => s.id === id);
            if (!scenario) {
                console.warn(`[screenshot] unknown scenario: ${id}`);
                return false;
            }
            try {
                const collectedPayloads: EventPayload[] = [];

                const tempState = EditorState.create({
                    doc: scenario.doc,
                    extensions: getExtensions({
                        persist: false,
                        updateListener(update) {
                            const payload = buildEventPayload(update);
                            if (payload) collectedPayloads.push(payload);
                        },
                    }),
                });
                const tempParent = document.createElement("div");
                const tempView = new EditorView({ state: tempState, parent: tempParent });
                scenario.setup(tempView);
                const finalState = tempView.state;
                tempView.destroy();

                await resetDb();
                const docId = await createDocument(scenario.label);
                const draftId = await createDraft(docId, "Draft");

                let lastEventId = -1;
                for (const payload of collectedPayloads) {
                    const result = await appendEvent(draftId, JSON.stringify(payload));
                    lastEventId = result.eventId;
                }

                const stateJson = JSON.stringify(finalState.toJSON(savedFields));
                await createSnapshot(draftId, stateJson, lastEventId);

                const docText = finalState.doc.toString();
                const wordCount = docText.trim().split(/\s+/).filter(Boolean).length;
                await updateDocumentMeta(
                    docId,
                    scenario.label,
                    wordCount,
                    docText.slice(0, 200),
                    "[]",
                    docText,
                );

                // Set stores after snapshot is written to avoid a race
                // where the Editor subscription loads an empty state.
                currentDocumentId.set(docId);
                currentDocumentTitle.set(scenario.label);
                currentDraftId.set(draftId);

                await editorComponent?.reload();
                return true;
            } catch (e) {
                console.error("[screenshot] runScenario failed:", e);
                return false;
            }
        };
    });
}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if appSettings.aiEnabled}
    <AiSidebar />
{/if}
<DictionaryPopover />
<HarperTooltip />

<!-- In-app overflow menu — only visible on small/touch viewports (<900px).
     Reaches Settings / Library / History / Licenses / Export, the same
     actions the desktop-only native menu bar triggers. -->
<MobileMenu
    onsettings={() => ($settingsOpen = !$settingsOpen)}
    onlibrary={goToLibrary}
    onhistory={goToHistory}
    onexport={handleMobileExport}
/>

<!-- Keyboard accessory toolbar — floats on top of the on-screen keyboard so
     formatting + annotation commands are reachable without a hardware keyboard.
     Only active on mobile; hides itself when the keyboard is closed. -->
<MobileFormatBar enabled={IS_MOBILE} />

<div class="h-screen w-full">
    <Editor bind:this={editorComponent} />
</div>

<!-- Update banner — shown when a new version is available -->
{#if updateAvailable}
    <UpdateBanner
        version={updateVersion}
        installing={updateInstalling}
        ready={updateReady}
        masMode={effectiveMasMode}
        oninstall={installUpdate}
        ondismiss={() => {
            posthog.capture("update_dismissed", { version: updateVersion });
            localStorage.setItem("quillium_skipped_update", updateVersion);
            updateAvailable = false;
            debugMasMode = null;
        }}
    />
{/if}

<!-- Stats modal -->
{#if $statsOpen}
    <StatsModal onclose={() => ($statsOpen = false)} />
{/if}

<!-- Tutorial overlay — rendered when tutorialActive store is true -->
{#if $tutorialActive}
    <Tutorial onComplete={handleTutorialComplete} />
{/if}

<!-- Beta disclaimer — shown once after tutorial or on first visit for returning users -->
{#if showBetaDisclaimer}
    <BetaDisclaimer onaccept={() => { showBetaDisclaimer = false; tryShowChangelog(); }} />
{/if}

<!-- What's New changelog — shown after beta disclaimer on minor version bumps -->
{#if showChangelog && changelogEntry}
    <ChangelogModal
        date={changelogEntry.date}
        content={changelogEntry.content}
        version={changelogEntry.version}
        ondismiss={handleChangelogDismiss}
    />
{/if}

<!-- Open Source Licenses modal -->
{#if licensesOpen}
    <LicensesModal
        ondismiss={() => {
            licensesOpen = false;
            // Return focus to the editor so the user can keep typing (#122)
            $editorView?.focus();
        }}
    />
{/if}

<!-- App logs modal -->
{#if appLogsOpen}
    <AppLogsModal
        ondismiss={() => {
            appLogsOpen = false;
            $editorView?.focus();
        }}
    />
{/if}

<!-- Debug panel — DEV only, never rendered in production builds -->
{#if import.meta.env.DEV && $debugPanelActive}
    <DebugPanel
        reloadEditor={() => editorComponent?.reload()}
    />
{/if}

<!-- Bottom-left corner stack — word count + AutoAI pushed up from corner -->
<BottomLeftStack>
    {#if appSettings.aiEnabled}
        <AutoAIWidget />
    {/if}
    <WordCountOverlay />
</BottomLeftStack>
<Toaster position="bottom-right" />

<!-- Top-right collab + account entry points -->
<div class="fixed top-8 right-8 z-40 flex items-center gap-3">
    {#if authLoading && authConnectionState === "connecting" && authReconnecting}
        <button
            disabled
            class="px-4 py-2 text-xs font-semibold text-red-700/60 bg-red-50/70 backdrop-blur-md
                rounded-full shadow-md inset-shadow-sm inset-shadow-white
                ring-1 ring-red-200/60 cursor-default"
        >
            Reconnecting
        </button>
    {:else if authLoading}
        <div class="h-8 w-[74px] rounded-full bg-black/[0.06] animate-pulse" aria-hidden="true"></div>
        <div class="h-8 w-[84px] rounded-full bg-black/[0.06] animate-pulse" aria-hidden="true"></div>
    {:else if authOffline}
        <button
            onclick={handleAuthReconnect}
            class="px-4 py-2 text-xs font-semibold text-red-700 bg-red-50/90 backdrop-blur-md
                rounded-full shadow-md inset-shadow-sm inset-shadow-white
                ring-1 ring-red-200/80 hover:text-red-800 hover:bg-red-100/90 transition-colors"
        >
            Reconnect
        </button>
    {:else}
        <AuthButton onauthclick={() => (authModalOpen = true)} />
        <GoLiveButton onauthclick={() => (authModalOpen = true)} />
    {/if}
</div>

<!-- Auth modal -->
{#if authModalOpen}
    <AuthModal onclose={() => (authModalOpen = false)} />
{/if}

<!-- Modal stack — render all entries so parent editors stay alive when a
     child modal is pushed on top. Each modal manages its own dialog
     visibility via `isTop` (only the topmost shows its <dialog>). -->
{#each $modalStack as entry, i (i)}
    {#if entry.type === "diff"}
        <DiffModal suggestionId={entry.suggestionId} parentView={entry.parentView} stackIndex={i} />
    {:else if entry.type === "revision"}
        <RevisionModal revisionId={entry.revisionId} view={entry.parentView} stackIndex={i} />
    {:else if entry.type === "comment"}
        <CommentModal commentId={entry.commentId} parentView={entry.parentView} stackIndex={i} />
    {/if}
{/each}

<style>
    :global(html) {
        background-color: #e5e7eb; /* gray-200 */
    }
</style>
