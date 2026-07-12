<script lang="ts">
/**
 * AnnotationPanel.svelte — Shared collapsible annotation-sidebar shell.
 *
 * Hosts keep ownership of annotation state and card capabilities. This
 * component owns the header, optional toolbar, collapse transition, scroll
 * container, and empty-state switch so modal sidebars cannot drift apart.
 */
import { ChevronDown, ChevronUp } from "lucide-svelte";
import type { Snippet } from "svelte";
import { slide } from "svelte/transition";

let {
    title = "Annotations",
    collapsed = $bindable(false),
    collapsible = true,
    showHeader = true,
    hasContent = true,
    onCollapsedChange,
    toolbar,
    content,
    empty,
}: {
    title?: string;
    collapsed?: boolean;
    collapsible?: boolean;
    showHeader?: boolean;
    hasContent?: boolean;
    onCollapsedChange?: (collapsed: boolean) => void;
    toolbar?: Snippet<[boolean]>;
    content: Snippet;
    empty?: Snippet;
} = $props();

const bodyVisible = $derived(!collapsible || !collapsed);

function toggleCollapsed(): void {
    if (!collapsible) return;
    collapsed = !collapsed;
    onCollapsedChange?.(collapsed);
}
</script>

<section
    class="annotation-panel"
    data-annotation-panel
    data-collapsed={collapsible && collapsed}
    data-has-content={hasContent}
>
    {#if showHeader}
        <div class="panel-header" data-annotation-panel-header>
            {#if collapsible}
                <button
                    class="panel-toggle"
                    type="button"
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
                    data-annotation-panel-toggle
                    onclick={toggleCollapsed}
                >
                    <span class="panel-title">{title}</span>
                    {#if collapsed}
                        <ChevronDown size={10} class="panel-chevron" />
                    {:else}
                        <ChevronUp size={10} class="panel-chevron" />
                    {/if}
                </button>
            {:else}
                <div class="panel-heading">
                    <span class="panel-title">{title}</span>
                </div>
            {/if}

            {#if toolbar}
                <div class="panel-toolbar" data-annotation-panel-toolbar>
                    {@render toolbar(collapsed)}
                </div>
            {/if}
        </div>
    {/if}

    {#if bodyVisible}
        <div
            class="panel-scroll"
            data-annotation-panel-scroll
            transition:slide={{ duration: 180 }}
        >
            {#if hasContent}
                {@render content()}
            {:else if empty}
                {@render empty()}
            {:else}
                <p class="default-empty">No annotations yet.</p>
            {/if}
        </div>
    {/if}
</section>

<style>
    .annotation-panel {
        display: flex;
        min-height: 0;
        flex: 1;
        flex-direction: column;
    }

    .panel-header {
        display: flex;
        flex-shrink: 0;
        align-items: center;
    }

    .panel-toggle,
    .panel-heading {
        display: flex;
        min-width: 0;
        flex: 1;
        align-items: center;
        justify-content: space-between;
        border: 0;
        background: transparent;
        padding: 0.625rem 1rem;
        font: inherit;
    }

    .panel-toggle {
        cursor: pointer;
        transition: background-color 0.15s ease;
    }

    .panel-toggle:hover {
        background: rgba(250, 245, 255, 0.6);
    }

    .panel-title {
        overflow: hidden;
        color: rgba(147, 51, 234, 0.6);
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-overflow: ellipsis;
        text-transform: uppercase;
        white-space: nowrap;
    }

    .panel-toggle :global(.panel-chevron) {
        flex-shrink: 0;
        color: rgba(192, 132, 252, 0.5);
    }

    .panel-toolbar {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        padding-right: 1rem;
    }

    .panel-scroll {
        min-height: 0;
        flex: 1;
        overflow-x: hidden;
        overflow-y: auto;
        padding: 0.5rem;
        scrollbar-width: none;
    }

    .panel-scroll::-webkit-scrollbar {
        display: none;
    }

    .default-empty {
        margin: 0;
        padding: 1rem 0.5rem;
        color: rgba(0, 0, 0, 0.3);
        font-size: 11px;
        line-height: 1.55;
        text-align: center;
    }
</style>
