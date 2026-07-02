<script lang="ts">
import { onMount } from "svelte";
import { fade, fly } from "svelte/transition";
import ReadonlyAnnotatedText from "./ReadonlyAnnotatedText.svelte";
import ReadonlyAnnotationCard from "./ReadonlyAnnotationCard.svelte";
import ReadonlyAnnotationModal from "./ReadonlyAnnotationModal.svelte";
import {
    buildDisplayedShare,
    findAnnotationPath,
    getSelectedRevisionVersionIndex,
    type AnnotationId,
    type RevisionVersionSelections,
} from "./rendering";
import type { ReadonlyShareDocument, SerializedAnnotation } from "./types";

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

type AnnotationPath = NonNullable<ReturnType<typeof findAnnotationPath>>;

let activeInlineAnnotationId = $state<AnnotationId | null>(null);
let modalAnnotationStack = $state<AnnotationId[]>([]);
let initializedSelection = $state(false);
let revisionVersionSelections = $state<RevisionVersionSelections>({});

const modalAnnotationId = $derived(modalAnnotationStack.at(-1) ?? null);

function formatPublishedAt(value: string | null): string {
    if (!value) return "Shared from Quillium";
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}

function selectAnnotation(id: AnnotationId) {
    activeInlineAnnotationId = id;
}

function openAnnotationModal(id: AnnotationId) {
    activeInlineAnnotationId = id;
    const path = findAnnotationPath(id, share.content, share.annotations) as AnnotationPath | null;
    if (path) {
        const selections = { ...revisionVersionSelections };
        for (const entry of path) {
            if (entry.annotation.type === "revision" && entry.viaVersionIndex !== null) {
                selections[entry.annotation.id] = entry.viaVersionIndex;
            }
        }
        revisionVersionSelections = selections;
    }
    modalAnnotationStack = path?.map((entry) => entry.annotation.id) ?? [id];
}

function closeAnnotationModal() {
    const nextStack = modalAnnotationStack.slice(0, -1);
    modalAnnotationStack = nextStack;
    if (nextStack.length > 0) {
        activeInlineAnnotationId = nextStack.at(-1) ?? activeInlineAnnotationId;
    }
}

function selectRevisionVersion(annotationId: AnnotationId, versionIndex: number) {
    revisionVersionSelections = {
        ...revisionVersionSelections,
        [annotationId]: versionIndex,
    };
}

const sortedAnnotations = $derived(
    [...share.annotations].sort(
        (a, b) => a.from - b.from || a.to - b.to || a.id.localeCompare(b.id),
    ),
);

const displayedShare = $derived(
    buildDisplayedShare(share.content, sortedAnnotations, revisionVersionSelections),
);

const displayAnnotations = $derived(displayedShare.annotations);

const modalAnnotationPath = $derived(
    modalAnnotationId
        ? ((findAnnotationPath(
              modalAnnotationId,
              share.content,
              share.annotations,
          ) as AnnotationPath | null) ?? [])
        : [],
);

const modalAnnotation = $derived(
    (modalAnnotationPath.at(-1)?.annotation as SerializedAnnotation | undefined) ?? null,
);

const activeDocumentAnnotationId = $derived(
    displayAnnotations.some((annotation) => annotation.id === activeInlineAnnotationId)
        ? activeInlineAnnotationId
        : ((modalAnnotationPath[0]?.annotation.id as AnnotationId | undefined) ??
              activeInlineAnnotationId),
);

$effect(() => {
    if (initializedSelection) return;
    activeInlineAnnotationId = displayAnnotations[0]?.id ?? sortedAnnotations[0]?.id ?? null;
    initializedSelection = true;
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

		<div class="editor-stage">
			<section class="editor-sheet" in:fade={{ duration: 420 }}>
				<div class="share-document">
					<ReadonlyAnnotatedText
						content={displayedShare.content}
						annotations={displayAnnotations}
						activeAnnotationId={activeDocumentAnnotationId}
						{revisionVersionSelections}
						onSelectAnnotation={selectAnnotation}
						indented
					/>
				</div>
			</section>

			<aside class="annotation-column" in:fly={{ x: 20, duration: 420, delay: 60 }}>
				<div class="annotation-card-stack">
					{#if displayAnnotations.length > 0}
						{#each displayAnnotations as annotation (annotation.id)}
							<ReadonlyAnnotationCard
								{annotation}
								active={activeDocumentAnnotationId === annotation.id}
								activeAnnotationId={activeInlineAnnotationId}
								{revisionVersionSelections}
								selectedRevisionVersionIndex={annotation.type === 'revision'
									? getSelectedRevisionVersionIndex(annotation, revisionVersionSelections)
									: null}
								onSelect={() => selectAnnotation(annotation.id)}
								onSelectAnnotation={openAnnotationModal}
								onOpen={() => openAnnotationModal(annotation.id)}
								onSelectRevisionVersion={(versionIndex) =>
									selectRevisionVersion(annotation.id, versionIndex)}
							/>
						{/each}
					{:else}
						<p class="annotation-empty-state">This snapshot does not have any annotations yet.</p>
					{/if}
				</div>
			</aside>
		</div>
	</section>
</main>

{#if modalAnnotation}
	<ReadonlyAnnotationModal
		annotation={modalAnnotation}
		rootContent={share.content}
		rootAnnotations={share.annotations}
		activeAnnotationId={activeInlineAnnotationId}
		{revisionVersionSelections}
		onClose={closeAnnotationModal}
		onSelectAnnotation={openAnnotationModal}
		onSelectRevisionVersion={selectRevisionVersion}
	/>
{/if}

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

	.editor-stage {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		gap: 1.5rem;
	}

	.editor-sheet {
		width: min(816px, 100%);
		min-height: calc(100vh - 4rem);
		padding: 0.75rem 0.25rem;
		border-radius: 0.5rem;
		background: var(--surface);
		box-shadow: 0 20px 46px rgba(var(--shadow-color), 0.18);
		animation: documentSheetSettle 620ms cubic-bezier(0.16, 1, 0.3, 1);
		transition:
			background-color 300ms ease,
			color 300ms ease;
	}

	.share-document {
		max-width: 816px;
		margin: 0 auto;
		padding: 0.5rem clamp(0.35rem, 1vw, 0.75rem) 3rem;
		color: var(--text);
		font-family: var(--doc-font-family, 'SF Pro Text', system-ui, sans-serif);
		font-size: 18px;
		line-height: 1.6;
	}

	.annotation-column {
		position: sticky;
		top: 6rem;
		width: min(360px, 32vw);
		max-height: calc(100vh - 7rem);
		overflow-y: auto;
		padding: 0.2rem 0.2rem 1rem;
		scrollbar-width: thin;
		scrollbar-color: var(--border-strong) transparent;
	}

	.annotation-card-stack {
		display: grid;
		gap: 0.75rem;
	}

	.annotation-empty-state {
		margin: 0;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		color: var(--text-soft);
		font-size: 0.9rem;
		line-height: 1.5;
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

	@keyframes documentSheetSettle {
		from {
			transform: translateY(14px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
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

		.editor-stage {
			display: grid;
		}

		.annotation-column {
			position: static;
			width: min(100%, 816px);
			max-height: none;
			margin: 0 auto;
			padding-bottom: 3rem;
		}
	}
</style>
