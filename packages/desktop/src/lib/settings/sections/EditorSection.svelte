<!--
    EditorSection.svelte — Settings (advanced): revision/nested-editor behavior
    and annotation layout.
    Mutates the shared settings draft and calls onchange() for live apply.
-->
<script lang="ts">
import type { AppSettings } from "$lib/settings.svelte";
import SettingSegmented from "../SettingSegmented.svelte";
import SettingToggle from "../SettingToggle.svelte";

const { draft, onchange }: { draft: AppSettings; onchange: () => void } = $props();
</script>

<div class="section-label">Editor</div>

<SettingToggle
    title="Nested editor in revisions"
    description="Inline editor inside revision cards"
    checked={draft.showNestedEditor}
    defaultChecked={true}
    ariaLabel="Toggle nested editor in revision card"
    onchange={(checked) => {
        draft.showNestedEditor = checked;
        onchange();
    }}
/>

<SettingToggle
    title="Atomic revisions"
    description="Edit revision text only in the revision editor"
    checked={draft.atomicRevisions}
    defaultChecked={true}
    ariaLabel="Toggle atomic revisions"
    onchange={(checked) => {
        draft.atomicRevisions = checked;
        onchange();
    }}
/>

<SettingToggle
    title="Select text in nested editor"
    description="Highlight selected text when a revision opens"
    checked={draft.selectTextInNestedEditor}
    defaultChecked={true}
    ariaLabel="Toggle select text in nested editor"
    dimmed={!draft.showNestedEditor}
    onchange={(checked) => {
        draft.selectTextInNestedEditor = checked;
        onchange();
    }}
/>

<SettingToggle
    title="Auto-create version on revision"
    description="Automatically add a new empty version when creating a revision"
    checked={draft.autoVersionOnRevisionCreate}
    defaultChecked={true}
    ariaLabel="Toggle auto-create version on revision"
    onchange={(checked) => {
        draft.autoVersionOnRevisionCreate = checked;
        onchange();
    }}
/>

<SettingToggle
    title="Undo after restart for new documents"
    description="Store undo history when Quillium closes. Documents created before July 14, 2026 keep their current behavior."
    checked={draft.persistUndoHistoryForNewDocuments}
    defaultChecked={false}
    ariaLabel="Keep undo history after restart for new documents"
    onchange={(checked) => {
        draft.persistUndoHistoryForNewDocuments = checked;
        onchange();
    }}
/>

<!-- Annotation layout (only takes effect when AI is off) -->
<SettingSegmented
    title="Annotation layout"
    description="Where comment and revision cards sit beside your text. Balanced and By type use both sides of the page — only when AI features are off (the AI panel occupies the left)."
    options={[
        ["visual-split", "Balanced"],
        ["by-type", "By type"],
        ["single", "One side"],
    ]}
    value={draft.annotationLayout}
    defaultValue="visual-split"
    dimmed={draft.aiEnabled}
    onchange={(value) => {
        draft.annotationLayout = value as AppSettings["annotationLayout"];
        onchange();
    }}
/>
