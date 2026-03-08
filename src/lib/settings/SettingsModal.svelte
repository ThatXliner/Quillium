<!--
    SettingsModal.svelte — Full settings dialog modal.

    Opens as a <dialog> element. Provides controls for document font,
    document font size, UI font, and the select-text-in-nested-editor toggle.

    Live apply: every change is applied immediately via applySettings().
    Save: persists to localStorage. Close without saving: shake +
    fading red ring on the modal (same pattern as annotation alerts).
    Unsaved changes revert on discard.

    Props:
      - onclose: () => void — called when the modal is fully dismissed.
-->
<script lang="ts">
import { X, Settings2, Check, ChevronDown, Plus, Trash2 } from "lucide-svelte";
import { appSettings, applySettings, persistSettings } from "$lib/settings.svelte";
import type { CustomQuickAction } from "$lib/settings.svelte";

const { onclose }: { onclose: () => void } = $props();

type FontOption = { label: string; value: string; sample: string };

function firstInstalled(...names: string[]): { label: string; cssName: string } {
    for (const name of names) {
        if (document.fonts.check(`12px "${name}"`)) return { label: name, cssName: `"${name}"` };
    }
    // None found — use the last as the labeled fallback
    const last = names[names.length - 1];
    return { label: last, cssName: `"${last}"` };
}

const mono = firstInstalled(
    "SF Mono",
    "JetBrains Mono",
    "Cascadia Code",
    "Fira Code",
    "Consolas",
    "Menlo",
);
const sans = firstInstalled("SF Pro Text", "Inter", "Segoe UI", "Helvetica Neue");

const monoStack = `${mono.cssName}, ui-monospace, monospace`;
const sansStack = `${sans.cssName}, system-ui, sans-serif`;

const DOC_FONTS: FontOption[] = [
    { label: sans.label, value: sansStack, sample: "The quick brown fox jumps" },
    { label: "Georgia", value: "Georgia, serif", sample: "The quick brown fox jumps" },
    { label: mono.label, value: monoStack, sample: "The quick brown fox jumps" },
];

const UI_FONTS: FontOption[] = [
    { label: sans.label, value: sansStack, sample: "App interface" },
    { label: "Georgia", value: "Georgia, serif", sample: "App interface" },
    { label: mono.label, value: monoStack, sample: "App interface" },
];

// Local draft — a shallow copy of persisted settings
let draft = $state({ ...appSettings });

// Snapshot of what was persisted when the modal opened (for discard)
const savedSnapshot = { ...appSettings };

let isDirty = $derived(JSON.stringify(draft) !== JSON.stringify(savedSnapshot));

// Quick actions state
let selectedPanel = $state<"revise" | "feedback" | "chat">("revise");
let newActionLabel = $state("");
let newActionPrompt = $state("");
let panelActions = $derived(
    (draft.customQuickActions ?? []).filter((a) => a.panel === selectedPanel),
);

function addQuickAction() {
    if (!newActionLabel.trim() || !newActionPrompt.trim()) return;
    draft.customQuickActions = [
        ...(draft.customQuickActions ?? []),
        { label: newActionLabel.trim(), prompt: newActionPrompt.trim(), panel: selectedPanel },
    ];
    newActionLabel = "";
    newActionPrompt = "";
}

function removeQuickAction(index: number) {
    const allActions = draft.customQuickActions ?? [];
    // index is relative to panelActions; find absolute index
    const panelItems = allActions
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => a.panel === selectedPanel);
    const absIndex = panelItems[index]?.i;
    if (absIndex === undefined) return;
    draft.customQuickActions = allActions.filter((_, i) => i !== absIndex);
}

let dialogEl = $state<HTMLDialogElement | undefined>(undefined);
let innerEl = $state<HTMLDivElement | undefined>(undefined);

// Shake + ring state — key increments each trigger so CSS animation replays
let alertKey = $state(0);
let alerting = $state(false);

// Which custom dropdown is open: "doc" | "ui" | null
let openDropdown = $state<"doc" | "ui" | null>(null);

$effect(() => {
    if (dialogEl && !dialogEl.open) {
        dialogEl.showModal();
    }
});

// Close dropdowns on outside click
$effect(() => {
    if (!openDropdown) return;
    const handler = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest(".font-dropdown")) {
            openDropdown = null;
        }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
});

function handleChange() {
    applySettings(draft);
}

function save() {
    Object.assign(appSettings, draft);
    persistSettings();
    onclose();
}

function discard() {
    applySettings(savedSnapshot);
    onclose();
}

function tryClose() {
    if (isDirty) {
        triggerAlert();
    } else {
        onclose();
    }
}

function triggerAlert() {
    alertKey += 1;
    alerting = true;
    setTimeout(() => {
        alerting = false;
    }, 1400);
}

function handleBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) tryClose();
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
        e.preventDefault();
        tryClose();
    }
}

function fontLabel(fonts: FontOption[], value: string) {
    return fonts.find((f) => f.value === value)?.label ?? fonts[0].label;
}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="settings-modal"
    onclick={handleBackdropClick}
>
    <div bind:this={innerEl} class="settings-modal-inner">
        <!-- Shake wrapper -->
        <div class="settings-shake-wrapper {alerting ? 'settings-shaking' : ''}">

        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-black/[0.06] shrink-0">
            <div class="flex items-center gap-2">
                <Settings2 size={14} class="text-black/35" />
                <h2 class="text-[13px] font-semibold text-black/60">Settings</h2>
            </div>
            <button
                onclick={tryClose}
                aria-label="Close settings"
                class="p-1 rounded-md text-black/25 hover:text-black/55 hover:bg-black/5 transition-colors"
            >
                <X size={15} />
            </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-0">

            <!-- DOCUMENT section -->
            <div class="section-label">Document</div>

            <!-- Font family row -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Font family</div>
                    <div class="setting-desc">Editor font</div>
                </div>
                <!-- Custom dropdown -->
                <div class="font-dropdown relative" role="none">
                    <button
                        onclick={() => openDropdown = openDropdown === "doc" ? null : "doc"}
                        class="dropdown-trigger {openDropdown === 'doc' ? 'dropdown-trigger-open' : ''}"
                    >
                        <span style="font-family: {draft.docFontFamily}; font-size: 13px;">{fontLabel(DOC_FONTS, draft.docFontFamily)}</span>
                        <ChevronDown size={11} class="text-black/35 transition-transform duration-150 {openDropdown === 'doc' ? 'rotate-180' : ''}" />
                    </button>
                    {#if openDropdown === "doc"}
                        <div class="dropdown-popover">
                            {#each DOC_FONTS as font}
                                {@const selected = draft.docFontFamily === font.value}
                                <button
                                    class="dropdown-option {selected ? 'dropdown-option-active' : ''}"
                                    onclick={() => {
                                        draft.docFontFamily = font.value;
                                        openDropdown = null;
                                        handleChange();
                                    }}
                                >
                                    <div class="flex-1 min-w-0">
                                        <div class="dropdown-option-label">{font.label}</div>
                                        <div class="dropdown-option-sample" style="font-family: {font.value};">{font.sample}</div>
                                    </div>
                                    {#if selected}
                                        <Check size={11} class="text-blue-500 shrink-0" />
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Font size row -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Font size</div>
                    <div class="setting-desc">Text size (14-24 px)</div>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                    <input
                        type="range"
                        min="14"
                        max="24"
                        step="1"
                        bind:value={draft.docFontSize}
                        oninput={handleChange}
                        class="w-28 accent-blue-500 cursor-pointer"
                    />
                    <span class="text-[12px] text-black/50 w-7 text-right tabular-nums">{draft.docFontSize}px</span>
                </div>
            </div>

            <div class="section-divider"></div>

            <!-- INTERFACE section -->
            <div class="section-label">Interface</div>

            <!-- UI font row -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">UI font family</div>
                    <div class="setting-desc">UI font</div>
                </div>
                <div class="font-dropdown relative" role="none">
                    <button
                        onclick={() => openDropdown = openDropdown === "ui" ? null : "ui"}
                        class="dropdown-trigger {openDropdown === 'ui' ? 'dropdown-trigger-open' : ''}"
                    >
                        <span style="font-family: {draft.uiFontFamily}; font-size: 13px;">{fontLabel(UI_FONTS, draft.uiFontFamily)}</span>
                        <ChevronDown size={11} class="text-black/35 transition-transform duration-150 {openDropdown === 'ui' ? 'rotate-180' : ''}" />
                    </button>
                    {#if openDropdown === "ui"}
                        <div class="dropdown-popover">
                            {#each UI_FONTS as font}
                                {@const selected = draft.uiFontFamily === font.value}
                                <button
                                    class="dropdown-option {selected ? 'dropdown-option-active' : ''}"
                                    onclick={() => {
                                        draft.uiFontFamily = font.value;
                                        openDropdown = null;
                                        handleChange();
                                    }}
                                >
                                    <div class="flex-1 min-w-0">
                                        <div class="dropdown-option-label">{font.label}</div>
                                        <div class="dropdown-option-sample" style="font-family: {font.value};">{font.sample}</div>
                                    </div>
                                    {#if selected}
                                        <Check size={11} class="text-blue-500 shrink-0" />
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>

            <div class="section-divider"></div>

            <!-- EDITOR section -->
            <div class="section-label">Editor</div>

            <!-- Show nested editor toggle -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Nested editor in revisions</div>
                    <div class="setting-desc">Inline editor inside revision cards</div>
                </div>
                <button
                    role="switch"
                    aria-checked={draft.showNestedEditor}
                    aria-label="Toggle nested editor in revision card"
                    class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                        {draft.showNestedEditor ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                    onclick={() => {
                        draft.showNestedEditor = !draft.showNestedEditor;
                        handleChange();
                    }}
                >
                    <span
                        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                            transition-transform duration-200
                            {draft.showNestedEditor ? 'translate-x-4' : 'translate-x-0'}"
                    ></span>
                </button>
            </div>

            <!-- Atomic revisions toggle -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Atomic revisions</div>
                    <div class="setting-desc">Edit revision text only in the revision editor</div>
                </div>
                <button
                    role="switch"
                    aria-checked={draft.atomicRevisions}
                    aria-label="Toggle atomic revisions"
                    class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                        {draft.atomicRevisions ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                    onclick={() => {
                        draft.atomicRevisions = !draft.atomicRevisions;
                        handleChange();
                    }}
                >
                    <span
                        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                            transition-transform duration-200
                            {draft.atomicRevisions ? 'translate-x-4' : 'translate-x-0'}"
                    ></span>
                </button>
            </div>

            <!-- Select text toggle -->
            <div class="setting-row {!draft.showNestedEditor ? 'opacity-40 pointer-events-none' : ''}">
                <div class="setting-meta">
                    <div class="setting-title">Select text in nested editor</div>
                    <div class="setting-desc">Highlight selected text when a revision opens</div>
                </div>
                <button
                    role="switch"
                    aria-checked={draft.selectTextInNestedEditor}
                    aria-label="Toggle select text in nested editor"
                    class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                        {draft.selectTextInNestedEditor ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                    onclick={() => {
                        draft.selectTextInNestedEditor = !draft.selectTextInNestedEditor;
                        handleChange();
                    }}
                >
                    <span
                        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                            transition-transform duration-200
                            {draft.selectTextInNestedEditor ? 'translate-x-4' : 'translate-x-0'}"
                    ></span>
                </button>
            </div>

            <div class="section-divider"></div>

            <!-- QUICK ACTIONS section -->
            <div class="section-label">Quick Actions</div>

            <!-- Panel selector -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Panel</div>
                    <div class="setting-desc">Add chips to a specific AI panel</div>
                </div>
                <div class="flex rounded-lg overflow-hidden border border-black/[0.09] shrink-0">
                    {#each (["revise", "feedback", "chat"] as const) as panel}
                        <button
                            onclick={() => { selectedPanel = panel; }}
                            class="px-3 py-1.5 text-[11px] font-medium capitalize transition-colors
                                {selectedPanel === panel
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-white text-black/50 hover:bg-black/[0.04]'}"
                        >{panel}</button>
                    {/each}
                </div>
            </div>

            <!-- Existing chips for selected panel -->
            {#if panelActions.length > 0}
                <div class="flex flex-col gap-1 mb-2">
                    {#each panelActions as action, i}
                        <div class="flex items-start gap-2 px-2 py-2 rounded-lg bg-black/[0.02] border border-black/[0.05]">
                            <div class="flex-1 min-w-0">
                                <div class="text-[12px] font-medium text-black/70 truncate">{action.label}</div>
                                <div class="text-[11px] text-black/38 mt-0.5 line-clamp-2 leading-snug">{action.prompt}</div>
                            </div>
                            <button
                                onclick={() => removeQuickAction(i)}
                                aria-label="Remove quick action"
                                class="shrink-0 mt-0.5 p-1 rounded text-black/25 hover:text-red-400 hover:bg-red-50 transition-colors"
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                    {/each}
                </div>
            {:else}
                <div class="text-[11px] text-black/30 px-0.5 mb-2">No custom chips for this panel yet.</div>
            {/if}

            <!-- Add new chip form -->
            <div class="flex flex-col gap-1.5 px-0.5">
                <input
                    bind:value={newActionLabel}
                    placeholder="Label (shown on chip)"
                    class="w-full px-2.5 py-1.5 text-[12px] border border-black/[0.1] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-black/25"
                />
                <textarea
                    bind:value={newActionPrompt}
                    placeholder="Full prompt sent to AI…"
                    rows="2"
                    class="w-full px-2.5 py-1.5 text-[12px] border border-black/[0.1] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none placeholder:text-black/25"
                ></textarea>
                <button
                    onclick={addQuickAction}
                    disabled={!newActionLabel.trim() || !newActionPrompt.trim()}
                    class="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-medium
                        bg-blue-500/80 text-white rounded-lg hover:bg-blue-600/80 transition-colors
                        disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Plus size={12} />
                    Add chip
                </button>
            </div>

        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between gap-2 px-5 py-3 border-t border-black/[0.06] shrink-0">
            <span class="text-[11px] text-rose-400/80 transition-opacity duration-200 {isDirty ? 'opacity-100' : 'opacity-0'}">
                Unsaved
            </span>
            <div class="flex items-center gap-2">
                <button
                    onclick={tryClose}
                    class="text-xs text-black/40 hover:text-black/60 transition-colors px-2 py-1"
                >Cancel</button>
                {#key alertKey}
                    <button
                        onclick={save}
                        class="text-xs text-white bg-blue-500/80 hover:bg-blue-600/80 transition-colors px-3 py-1.5 rounded-full font-medium {alertKey > 0 ? 'save-alert' : ''}"
                    >Save</button>
                {/key}
            </div>
        </div>

        </div><!-- end shake wrapper -->
    </div>
</dialog>

<style>
    .settings-modal {
        border: none;
        padding: 0;
        background: transparent;
        width: 100vw;
        height: 100vh;
        max-width: 100vw;
        max-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .settings-modal::backdrop {
        background: rgba(0, 0, 0, 0.25);
        backdrop-filter: blur(4px);
    }

    .settings-modal-inner {
        position: relative;
        width: 640px;
        height: 72vh;
        max-height: 82vh;
        background: white;
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.2);
        overflow: hidden;
    }

    /* Shake animation — same curve as annotation pending-shake */
    @keyframes settings-shake {
        0%   { transform: translateX(0); }
        10%  { transform: translateX(-6px); }
        20%  { transform: translateX(6px); }
        30%  { transform: translateX(-5px); }
        40%  { transform: translateX(5px); }
        50%  { transform: translateX(-3px); }
        60%  { transform: translateX(3px); }
        70%  { transform: translateX(-1px); }
        80%  { transform: translateX(1px); }
        100% { transform: translateX(0); }
    }

    .settings-shake-wrapper {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .settings-shaking {
        animation: settings-shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
    }

    /* Fading red ring on Save button */
    .save-alert {
        animation: save-ring-fade 1.4s ease-out both;
    }

    @keyframes save-ring-fade {
        0%   { box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.85); }
        70%  { box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.85); }
        100% { box-shadow: 0 0 0 0px rgba(251, 113, 133, 0); }
    }

    /* Section labels */
    .section-label {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(0, 0, 0, 0.35);
        margin-top: 0.25rem;
        margin-bottom: 0.5rem;
        padding: 0 0.125rem;
    }

    .section-divider {
        height: 1px;
        background: rgba(0, 0, 0, 0.05);
        margin: 0.75rem 0;
    }

    /* Setting row */
    .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.5rem;
        padding: 0.5rem 0.125rem;
    }

    .setting-meta {
        flex: 1;
        min-width: 0;
    }

    .setting-title {
        font-size: 13px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.75);
        line-height: 1.3;
    }

    .setting-desc {
        font-size: 11px;
        color: rgba(0, 0, 0, 0.38);
        margin-top: 1px;
        line-height: 1.4;
    }

    /* Custom font dropdown trigger */
    .dropdown-trigger {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px 5px 11px;
        background: rgba(0, 0, 0, 0.04);
        border: 1px solid rgba(0, 0, 0, 0.09);
        border-radius: 8px;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s, border-color 0.15s;
        min-width: 148px;
        justify-content: space-between;
    }

    .dropdown-trigger:hover {
        background: rgba(0, 0, 0, 0.07);
        border-color: rgba(0, 0, 0, 0.13);
    }

    .dropdown-trigger-open {
        background: rgba(0, 0, 0, 0.06);
        border-color: rgba(59, 130, 246, 0.4);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    /* Dropdown popover */
    .dropdown-popover {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        min-width: 200px;
        background: white;
        border: 1px solid rgba(0, 0, 0, 0.09);
        border-radius: 10px;
        box-shadow:
            0 8px 24px -4px rgba(0, 0, 0, 0.12),
            0 2px 8px -2px rgba(0, 0, 0, 0.07);
        padding: 4px;
        z-index: 50;
        overflow: hidden;
    }

    .dropdown-option {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 7px 9px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.1s;
        text-align: left;
    }

    .dropdown-option:hover {
        background: rgba(0, 0, 0, 0.04);
    }

    .dropdown-option-active {
        background: rgba(59, 130, 246, 0.07);
    }

    .dropdown-option-active:hover {
        background: rgba(59, 130, 246, 0.1);
    }

    .dropdown-option-label {
        font-size: 12px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.7);
        line-height: 1.2;
    }

    .dropdown-option-sample {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.38);
        margin-top: 2px;
        line-height: 1.3;
    }
</style>
