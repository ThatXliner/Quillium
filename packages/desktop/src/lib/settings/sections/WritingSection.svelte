<!--
    WritingSection.svelte — Settings: editor mode, grammar check, dialect,
    plus the advanced-only shortcut-hints and word-count toggles.
    Mutates the shared settings draft and calls onchange() for live apply.
-->
<script lang="ts">
import type { AppSettings } from "$lib/settings.svelte";
import SettingSegmented from "../SettingSegmented.svelte";
import SettingToggle from "../SettingToggle.svelte";

const {
    draft,
    onchange,
    advanced,
}: {
    draft: AppSettings;
    onchange: () => void;
    advanced: boolean;
} = $props();
</script>

<div class="section-label">Writing</div>

<SettingSegmented
    title="Editor mode"
    description="Write in plain text or with Markdown formatting for headings, emphasis, quotes, and lists"
    options={[
        ["plain", "Plain text"],
        ["markdown", "Markdown"],
    ]}
    value={draft.editorMode}
    defaultValue="markdown"
    onchange={(value) => {
        draft.editorMode = value as AppSettings["editorMode"];
        onchange();
    }}
/>

<SettingToggle
    title="Grammar & spell check"
    description="Highlight spelling and grammar errors with squiggly underlines"
    checked={draft.grammarCheckEnabled}
    defaultChecked={true}
    ariaLabel="Toggle grammar check"
    onchange={(checked) => {
        draft.grammarCheckEnabled = checked;
        onchange();
    }}
/>

<!-- English dialect dropdown -->
<div class="setting-row {!draft.grammarCheckEnabled ? 'opacity-40 pointer-events-none' : ''}">
    <div class="setting-meta">
        <div class="setting-title">English dialect</div>
        <div class="setting-desc">Which English spelling and grammar rules to use</div>
    </div>
    <div class="shrink-0">
        <select
            class="text-sm bg-white/60 border border-black/10 rounded-md px-2 py-1 cursor-pointer"
            value={draft.grammarDialect}
            onchange={(e) => {
                draft.grammarDialect = e.currentTarget.value as typeof draft.grammarDialect;
                onchange();
            }}
        >
            <option value="american">American English</option>
            <option value="british">British English</option>
            <option value="australian">Australian English</option>
        </select>
    </div>
</div>

{#if advanced}
    <SettingToggle
        title="Shortcut hints"
        description="Show a floating cheat-sheet of annotation shortcuts (comment, revision, dictionary) next to your text selection"
        checked={draft.showShortcutHints}
        defaultChecked={true}
        ariaLabel="Toggle shortcut hints"
        onchange={(checked) => {
            draft.showShortcutHints = checked;
            onchange();
        }}
    />

    <SettingToggle
        title="Word count overlay"
        description="Show a floating word/character count pill (click it to change display mode)"
        checked={draft.showWordCount}
        defaultChecked={true}
        ariaLabel="Toggle word count overlay"
        onchange={(checked) => {
            draft.showWordCount = checked;
            onchange();
        }}
    />
{/if}
