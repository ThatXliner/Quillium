<script lang="ts">
/**
 * AnnotationModalHeader.svelte — Shared modal header with optional host capabilities.
 *
 * Breadcrumbs/titles and mutation actions remain host-provided snippets. The close affordance and
 * accent border are canonical so read-only and editable modal shells cannot silently drift.
 */
import { X } from "lucide-svelte";
import type { Snippet } from "svelte";
import RestoreSizeButton from "../resize/RestoreSizeButton.svelte";

let {
    accent,
    leading,
    actions,
    onClose,
    closeLabel = "Close modal",
    restoreSize,
}: {
    accent: "revision" | "comment" | "suggestion";
    leading: Snippet;
    actions?: Snippet;
    onClose: () => void;
    closeLabel?: string;
    restoreSize?: () => void;
} = $props();
</script>

<header
    class="annotation-modal-header annotation-modal-header-{accent}"
    data-annotation-modal-header={accent}
>
    <div class="annotation-modal-leading">
        {@render leading()}
    </div>

    <div class="annotation-modal-controls">
        {#if actions}
            <div class="annotation-modal-actions" data-annotation-modal-actions>
                {@render actions()}
            </div>
        {/if}
        <RestoreSizeButton {restoreSize} />
        <button type="button" class="annotation-modal-close" onclick={onClose} aria-label={closeLabel}>
            <span>esc</span>
            <X size={16} />
        </button>
    </div>
</header>

<style>
    .annotation-modal-header {
        display: flex;
        min-width: 0;
        flex-shrink: 0;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        border-bottom: 1px solid;
        padding: 0.75rem 1.25rem;
    }

    .annotation-modal-header-revision {
        border-color: rgba(243, 232, 255, 0.8);
    }

    .annotation-modal-header-comment {
        border-color: rgba(219, 234, 254, 0.8);
    }

    .annotation-modal-header-suggestion {
        border-color: rgba(220, 252, 231, 0.8);
    }

    .annotation-modal-leading {
        display: flex;
        min-width: 0;
        flex: 1;
        align-items: center;
        gap: 0.5rem;
    }

    .annotation-modal-controls,
    .annotation-modal-actions {
        display: flex;
        flex-shrink: 0;
        align-items: center;
    }

    .annotation-modal-controls {
        gap: 0.5rem;
    }

    .annotation-modal-actions {
        gap: 0.5rem;
    }

    .annotation-modal-close {
        display: inline-flex;
        flex-shrink: 0;
        align-items: center;
        gap: 0.25rem;
        border: 0;
        border-radius: 0.375rem;
        background: transparent;
        padding: 0.25rem 0.25rem 0.25rem 0.375rem;
        color: var(--text-faint, rgba(0, 0, 0, 0.3));
        transition:
            background-color 0.15s ease,
            color 0.15s ease;
    }

    .annotation-modal-close span {
        color: var(--text-faint, rgba(0, 0, 0, 0.2));
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 9px;
        line-height: 1;
    }

    .annotation-modal-close:hover {
        background: var(--border, rgba(0, 0, 0, 0.05));
        color: var(--text-soft, rgba(0, 0, 0, 0.6));
    }
</style>
