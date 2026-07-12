<script lang="ts">
import { onMount } from "svelte";
import { fly } from "svelte/transition";
import LegacyReadonlyDocument from "./LegacyReadonlyDocument.svelte";
import ReadonlyDocument from "./ReadonlyDocument.svelte";
import { type ReadonlyShareDocument, isReadonlyShareStateV2 } from "./types";

let {
    share,
    downloadUrl = "/?utm_source=shared-doc&utm_medium=share-page&utm_campaign=public-readonly-share#download",
    onInstallClick,
    onView,
}: {
    share: ReadonlyShareDocument;
    downloadUrl?: string;
    onInstallClick?: (location: "toolbar") => void;
    onView?: () => void;
} = $props();

function formatPublishedAt(value: string | null): string {
    if (!value) return "Shared from Quillium";
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}

const multiTabState = $derived(isReadonlyShareStateV2(share.state) ? share.state : null);
let selectedTabId = $state<string | null>(null);
const selectedTab = $derived(
    multiTabState?.tabs.find((tab) => tab.id === selectedTabId) ?? multiTabState?.tabs[0] ?? null,
);

$effect(() => {
    if (!multiTabState) return;
    if (multiTabState.tabs.some((tab) => tab.id === selectedTabId)) return;
    selectedTabId = multiTabState.activeTabId ?? multiTabState.tabs[0]?.id ?? null;
});

onMount(() => {
    onView?.();
});
</script>

<main class="share-shell min-h-screen px-4 pt-4 pb-12 sm:px-6">
	<section class="mx-auto max-w-[1320px]">
		<div class="share-topbar-shell">
			<div class="share-topbar" in:fly={{ y: -18, duration: 420 }}>
				<div class="share-status">
					<span class="share-status-dot"></span>
					<span>Read-only</span>
				</div>
				<div class="share-topbar-divider"></div>
				<div class="share-title-block">
					<p class="share-title">{share.title}</p>
					<p class="share-topbar-meta">
						{share.authorName || 'Shared from Quillium'} · {formatPublishedAt(share.publishedAt)}
					</p>
				</div>
				<div class="share-topbar-divider share-topbar-divider-optional"></div>
				<a
					href={downloadUrl}
					onclick={() => onInstallClick?.('toolbar')}
					class="btn-primary share-install-button"
				>
					Edit in Quillium
				</a>
			</div>
		</div>

		{#if multiTabState && multiTabState.tabs.length > 1}
			<nav class="share-tabs" aria-label="Published tabs">
				{#each multiTabState.tabs as tab (tab.id)}
					<button
						type="button"
						class:active={tab.id === selectedTab?.id}
						onclick={() => (selectedTabId = tab.id)}
					>
						{tab.label}
					</button>
				{/each}
			</nav>
		{/if}

		{#if selectedTab}
			<ReadonlyDocument serializedState={selectedTab.state} indented />
		{:else if share.state}
			<!-- New path: render through the real read-only CodeMirror editor. -->
			<ReadonlyDocument serializedState={share.state} indented />
		{:else}
			<!-- Compatibility path for shares published before serialized CM state. -->
			<LegacyReadonlyDocument content={share.content} annotations={share.annotations} />
		{/if}
	</section>
</main>

<style>
	.share-shell {
		background: var(--bg);
		transition:
			background-color 300ms ease,
			color 300ms ease;
	}

	.share-topbar-shell {
		position: sticky;
		top: 1rem;
		z-index: 40;
		display: flex;
		justify-content: center;
		margin-bottom: 3rem;
		pointer-events: none;
	}

	.share-tabs {
		display: flex;
		gap: 0.35rem;
		max-width: min(100%, 52rem);
		margin: -1.75rem auto 1.5rem;
		overflow-x: auto;
		padding: 0.25rem;
		border: 1px solid var(--border);
		border-radius: 0.65rem;
		background: var(--surface);
	}

	.share-tabs button {
		flex: 0 0 auto;
		max-width: 14rem;
		overflow: hidden;
		padding: 0.55rem 0.9rem;
		border: 0;
		border-radius: 0.45rem;
		background: transparent;
		color: var(--text-faint);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.share-tabs button.active {
		background: var(--surface-2);
		color: var(--text-strong);
	}

	.share-topbar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		max-width: min(100%, 42rem);
		min-width: 0;
		padding: 0.5rem 1.5rem;
		border: 1px solid var(--nav-glass-border);
		border-radius: 2rem;
		background: var(--nav-glass);
		box-shadow: 0 10px 24px rgba(var(--shadow-color), 0.12);
		backdrop-filter: blur(14px);
		animation: shareTopbarSettle 560ms cubic-bezier(0.16, 1, 0.3, 1);
		pointer-events: auto;
	}

	.share-status {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--text-strong);
	}

	.share-status-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: #4ade80;
	}

	.share-topbar-divider {
		flex-shrink: 0;
		width: 1px;
		height: 2rem;
		background: var(--border-strong);
	}

	.share-title-block {
		min-width: 0;
		text-align: center;
	}

	.share-title {
		max-width: min(24rem, 42vw);
		overflow: hidden;
		color: var(--text-soft);
		font-size: 0.875rem;
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.share-topbar-meta {
		margin-top: 0.05rem;
		color: var(--text-faint);
		font-size: 0.68rem;
	}

	.share-install-button {
		min-height: 2.4rem;
		padding: 0 1rem;
		border-radius: 999px;
		box-shadow:
			0 10px 28px rgba(37, 99, 235, 0.22),
			inset 0 1px 0 rgba(255, 255, 255, 0.16);
		font-size: 0.78rem;
		white-space: nowrap;
	}

	@keyframes shareTopbarSettle {
		from {
			transform: translateY(-8px) scale(0.98);
			opacity: 0;
		}
		to {
			transform: translateY(0) scale(1);
			opacity: 1;
		}
	}

	@media (max-width: 980px) {
		.share-topbar {
			max-width: 100%;
			padding-inline: 1rem;
		}

		.share-topbar-divider-optional,
		.share-install-button {
			display: none;
		}

		.share-title {
			max-width: 58vw;
		}
	}
</style>
