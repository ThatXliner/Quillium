<script lang="ts">
import { EditorSelection } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { ChevronRight, MessageSquare, SparklesIcon } from "lucide-svelte";
import ReadonlyAnnotatedText from "./ReadonlyAnnotatedText.svelte";
import ReadonlyAnnotationCard from "./ReadonlyAnnotationCard.svelte";
import ReadonlyEditorHost from "./ReadonlyEditorHost.svelte";
import ReadonlyThreadMessage from "./ReadonlyThreadMessage.svelte";
import AnnotationPanel from "./cards/AnnotationPanel.svelte";
import ContextViewport from "./cards/ContextViewport.svelte";
import RevisionBreadcrumbsView from "./cards/RevisionBreadcrumbs.svelte";
import RevisionContextPanel from "./cards/RevisionContextPanel.svelte";
import type { RevisionBreadcrumbCrumbView } from "./cards/types";
import { getActiveAnnotation, serializeFromState } from "./core";
import AnnotationModalFrame from "./modals/AnnotationModalFrame.svelte";
import AnnotationModalHeader from "./modals/AnnotationModalHeader.svelte";
import SuggestionModalContent from "./modals/SuggestionModalContent.svelte";
import {
    type AnnotationId,
    type AnnotationPathEntry,
    type RevisionVersionSelections,
    annotationLabel,
    buildDisplayedShare,
    buildRevisionContextLayers,
    findAnnotationPath,
    getSelectedRevisionVersion,
    getSelectedRevisionVersionIndex,
    previewVersionText,
} from "./rendering";
import type { SerializedAnnotation, SerializedRevisionAnnotation } from "./types";

let {
    annotation,
    rootContent = "",
    rootAnnotations = [],
    activeAnnotationId = null,
    revisionVersionSelections = {},
    revisionState = null,
    onClose,
    onSelectAnnotation,
    onSelectRevisionVersion,
    onRevisionSelectionsChange,
}: {
    annotation: SerializedAnnotation;
    rootContent?: string;
    rootAnnotations?: SerializedAnnotation[];
    activeAnnotationId?: AnnotationId | null;
    revisionVersionSelections?: RevisionVersionSelections;
    revisionState?: Record<string, unknown> | null;
    onClose: () => void;
    onSelectAnnotation?: (annotationId: AnnotationId) => void;
    onSelectRevisionVersion: (annotationId: AnnotationId, versionIndex: number) => void;
    onRevisionSelectionsChange?: (selections: RevisionVersionSelections) => void;
} = $props();

let annotationsCollapsed = $state(false);
const COMMENT_CONTEXT_CHUNK = 300;
const COMMENT_CONTEXT_INITIAL = 1500;
let commentContextAnnotationId = $state<AnnotationId | null>(null);
let commentContextBefore = $state(COMMENT_CONTEXT_INITIAL);
let commentContextAfter = $state(COMMENT_CONTEXT_INITIAL);
let modalEditorProjection = $state<{
    key: string;
    content: string;
    annotations: SerializedAnnotation[];
} | null>(null);
let modalEditorActiveAnnotationId = $state<AnnotationId | null>(null);
let modalEditorView = $state<EditorView | null>(null);

const annotationPath = $derived.by((): AnnotationPathEntry[] => {
    return (
        findAnnotationPath(annotation.id, rootContent, rootAnnotations) ?? [
            {
                annotation,
                parentContent: rootContent,
                parentAnnotations: rootAnnotations,
                viaVersionIndex: null,
            },
        ]
    );
});

const revisionCrumbs = $derived(
    annotationPath.filter(
        (entry): entry is AnnotationPathEntry & { annotation: SerializedRevisionAnnotation } =>
            entry.annotation.type === "revision",
    ),
);

const breadcrumbViews = $derived.by((): RevisionBreadcrumbCrumbView[] =>
    revisionCrumbs.map((crumb) => {
        const selectedIndex = selectedIndexForCrumb(crumb);
        const selectedVersion =
            crumb.annotation.versions.find((version) => version.index === selectedIndex) ??
            crumb.annotation.versions[crumb.annotation.activeVersionIndex] ??
            crumb.annotation.versions[0];
        return {
            id: crumb.annotation.id,
            label: "Revision",
            current: crumb.annotation.id === annotation.id,
            selectedVersionId: selectedVersion?.versionId ?? String(selectedIndex),
            versions: crumb.annotation.versions.map((version) => ({
                id: version.versionId ?? String(version.index),
                label: version.label ?? previewVersionText(version),
                editableLabel: version.label,
            })),
        };
    }),
);

const selectedRevisionVersion = $derived(
    annotation.type === "revision"
        ? getSelectedRevisionVersion(annotation, revisionVersionSelections)
        : null,
);

const fallbackDisplayedRevisionShare = $derived(
    selectedRevisionVersion
        ? buildDisplayedShare(
              selectedRevisionVersion.text,
              selectedRevisionVersion.annotations ?? [],
              revisionVersionSelections,
              { includeNestedAnnotations: false },
          )
        : { content: "", annotations: [] },
);

const selectedRevisionPrefix = $derived(
    annotation.type === "revision" && selectedRevisionVersion
        ? `${annotation.id}.v${selectedRevisionVersion.index}.`
        : "",
);

const modalEditorKey = $derived(
    annotation.type === "revision" && selectedRevisionVersion
        ? `${annotation.id}.v${selectedRevisionVersion.index}`
        : "",
);

const displayedRevisionShare = $derived(
    revisionState && modalEditorProjection?.key === modalEditorKey
        ? modalEditorProjection
        : fallbackDisplayedRevisionShare,
);

const nestedRevisionSelections = $derived.by(
    (): { annotationId: number; versionIndex: number }[] => {
        if (!selectedRevisionPrefix) return [];
        const selections: { annotationId: number; versionIndex: number }[] = [];
        for (const [annotationId, versionIndex] of Object.entries(revisionVersionSelections)) {
            if (!annotationId.startsWith(selectedRevisionPrefix)) continue;
            const localId = annotationId.slice(selectedRevisionPrefix.length);
            if (!/^\d+$/.test(localId)) continue;
            selections.push({ annotationId: Number(localId), versionIndex });
        }
        return selections;
    },
);

const revisionContextLayers = $derived(buildRevisionContextLayers(annotationPath));

$effect(() => {
    if (annotation.type !== "comment" || annotation.id === commentContextAnnotationId) return;
    commentContextAnnotationId = annotation.id;
    commentContextBefore = COMMENT_CONTEXT_INITIAL;
    commentContextAfter = COMMENT_CONTEXT_INITIAL;
});

const commentContextLayers = $derived.by(() => {
    if (annotation.type !== "comment") return [];
    const entry = annotationPath.at(-1);
    if (!entry) return [];
    const from = Math.min(Math.max(annotation.from, 0), entry.parentContent.length);
    const to = Math.min(Math.max(annotation.to, from), entry.parentContent.length);
    const beforeStart = Math.max(0, from - commentContextBefore);
    const afterEnd = Math.min(entry.parentContent.length, to + commentContextAfter);
    return [
        {
            before: entry.parentContent.slice(beforeStart, from),
            revision: entry.parentContent.slice(from, to),
            after: entry.parentContent.slice(to, afterEnd),
            hasMoreBefore: beforeStart > 0,
            hasMoreAfter: afterEnd < entry.parentContent.length,
        },
    ];
});

function selectedIndexForCrumb(
    entry: AnnotationPathEntry & { annotation: SerializedRevisionAnnotation },
) {
    return (
        revisionVersionSelections[entry.annotation.id] ??
        entry.viaVersionIndex ??
        entry.annotation.activeVersionIndex
    );
}

function selectBreadcrumbVersion(crumbId: string, versionId: string) {
    const entry = revisionCrumbs.find((crumb) => crumb.annotation.id === crumbId);
    if (!entry) return;
    const version = entry.annotation.versions.find(
        (version) => (version.versionId ?? String(version.index)) === versionId,
    );
    if (!version) return;
    onSelectRevisionVersion(entry.annotation.id, version.index);
    if (entry.annotation.id !== annotation.id) {
        onSelectAnnotation?.(entry.annotation.id);
    }
}

function selectNestedAnnotation(annotationId: AnnotationId) {
    onSelectAnnotation?.(annotationId);
}

function activateNestedAnnotation(annotationId: AnnotationId): void {
    modalEditorActiveAnnotationId = annotationId;
    if (!revisionState || !modalEditorView) return;
    const nestedAnnotation = displayedRevisionShare.annotations.find(
        (candidate) => candidate.id === annotationId,
    );
    if (!nestedAnnotation) return;
    modalEditorView.dispatch({
        selection: EditorSelection.cursor(nestedAnnotation.from),
        scrollIntoView: true,
    });
}

function syncModalEditor(view: EditorView): void {
    const projection = serializeFromState(view.state, selectedRevisionPrefix);
    modalEditorProjection = { key: modalEditorKey, ...projection };
    const active = getActiveAnnotation(view.state);
    modalEditorActiveAnnotationId = active ? `${selectedRevisionPrefix}${active.id}` : null;
    onRevisionSelectionsChange?.(
        Object.fromEntries(
            projection.annotations
                .filter(
                    (nestedAnnotation): nestedAnnotation is SerializedRevisionAnnotation =>
                        nestedAnnotation.type === "revision",
                )
                .map((nestedAnnotation) => [
                    nestedAnnotation.id,
                    nestedAnnotation.activeVersionIndex,
                ]),
        ),
    );
}

function handleModalEditorReady(view: EditorView | null): void {
    modalEditorView = view;
    if (!view) {
        modalEditorProjection = null;
        modalEditorActiveAnnotationId = null;
        return;
    }
    syncModalEditor(view);
}

function handleModalEditorUpdate(update: ViewUpdate): void {
    if (!update.docChanged && !update.selectionSet) return;
    syncModalEditor(update.view);
}

function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    onClose();
}
</script>

{#snippet revisionHeaderLeading()}
    <RevisionBreadcrumbsView
        crumbs={breadcrumbViews}
        onNavigate={(crumbId) => onSelectAnnotation?.(crumbId)}
        onSelectVersion={selectBreadcrumbVersion}
    />
{/snippet}

{#snippet commentHeaderLeading()}
    <MessageSquare size={13} class="shrink-0 text-blue-500/70" />
    <nav class="comment-breadcrumbs">
        {#each revisionCrumbs as crumb}
            <button
                class="max-w-[120px] shrink-0 truncate text-[10px] text-blue-500/60 transition-colors hover:text-blue-700/80"
                type="button"
                onclick={() => onSelectAnnotation?.(crumb.annotation.id)}
            >
                Revision
            </button>
            <ChevronRight size={10} class="shrink-0 text-blue-300/60" />
        {/each}
        <span
            class="shrink-0 text-[10px] font-semibold tracking-wider text-blue-700/70 uppercase"
            >Comment</span
        >
    </nav>
{/snippet}

{#snippet suggestionHeaderLeading()}
    <SparklesIcon size={13} class="shrink-0 text-green-500/70" />
    <nav class="suggestion-breadcrumbs">
        {#each revisionCrumbs as crumb}
            <button
                class="max-w-[120px] shrink-0 truncate text-[10px] text-green-500/60 transition-colors hover:text-green-700/80"
                type="button"
                onclick={() => onSelectAnnotation?.(crumb.annotation.id)}
            >
                Revision
            </button>
            <ChevronRight size={10} class="shrink-0 text-green-300/60" />
        {/each}
        <span
            class="truncate text-[10px] font-semibold tracking-wider text-green-700/70 uppercase"
            >{annotationLabel(annotation)}</span
        >
    </nav>
{/snippet}

<svelte:window onkeydown={handleWindowKeydown} />

<div
	class="readonly-modal"
	role="presentation"
	onclick={(event) => event.currentTarget === event.target && onClose()}
>
	{#if annotation.type === 'revision'}
		<AnnotationModalFrame variant="revision">
			<AnnotationModalHeader
				accent="revision"
				leading={revisionHeaderLeading}
				onClose={onClose}
				closeLabel="Close revision"
			/>

			<div class="revision-modal-body">
				<div class="revision-modal-thread">
					<div class="thread-panel-header">
						<span>Thread</span>
					</div>
					<div class="thread-panel-body">
						{#if annotation.thread.length === 0}
							<p class="empty-state">No messages yet.</p>
						{:else}
							<div class="thread-stack">
								{#each annotation.thread as message (message.time)}
									<ReadonlyThreadMessage {message} />
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<div class="revision-modal-editor">
					<div
						class="revision-modal-document"
						class:real-editor={!!revisionState}
						data-revision-modal-editor={revisionState ? 'codemirror' : 'legacy-static'}
					>
						{#if revisionState}
							<ReadonlyEditorHost
								serializedState={revisionState}
								revisionSelections={nestedRevisionSelections}
								onReady={handleModalEditorReady}
								onUpdate={handleModalEditorUpdate}
								onActiveAnnotationChange={(localId) => {
									modalEditorActiveAnnotationId = localId === null
										? null
										: `${selectedRevisionPrefix}${localId}`;
								}}
							/>
						{:else}
							<ReadonlyAnnotatedText
								content={selectedRevisionVersion?.text ?? ''}
								annotations={selectedRevisionVersion?.annotations ?? []}
								activeAnnotationId={modalEditorActiveAnnotationId ?? activeAnnotationId}
								{revisionVersionSelections}
								onSelectAnnotation={selectNestedAnnotation}
							/>
						{/if}
					</div>
				</div>

				<div class="revision-right-panel">
					<RevisionContextPanel layers={revisionContextLayers} />

					{#snippet annotationPanelContent()}
						<div class="space-y-2">
							{#each displayedRevisionShare.annotations as nestedAnnotation (nestedAnnotation.id)}
								<ReadonlyAnnotationCard
									annotation={nestedAnnotation}
									active={(modalEditorActiveAnnotationId ?? activeAnnotationId) ===
										nestedAnnotation.id}
									activeAnnotationId={modalEditorActiveAnnotationId ?? activeAnnotationId}
									{revisionVersionSelections}
									selectedRevisionVersionIndex={nestedAnnotation.type === 'revision'
										? revisionState
											? nestedAnnotation.activeVersionIndex
											: getSelectedRevisionVersionIndex(
													nestedAnnotation,
													revisionVersionSelections
												)
										: null}
									onSelect={() => activateNestedAnnotation(nestedAnnotation.id)}
									onSelectAnnotation={selectNestedAnnotation}
									onOpen={() => onSelectAnnotation?.(nestedAnnotation.id)}
									onSelectRevisionVersion={(versionIndex) =>
										onSelectRevisionVersion(nestedAnnotation.id, versionIndex)}
								/>
							{/each}
						</div>
					{/snippet}

					<AnnotationPanel
						bind:collapsed={annotationsCollapsed}
						hasContent={displayedRevisionShare.annotations.length > 0}
						content={annotationPanelContent}
					/>
				</div>
			</div>
		</AnnotationModalFrame>
	{:else if annotation.type === 'comment'}
		<AnnotationModalFrame variant="comment">
			<AnnotationModalHeader
				accent="comment"
				leading={commentHeaderLeading}
				onClose={onClose}
				closeLabel="Close comment"
			/>

			<div class="comment-modal-body">
				<div class="comment-thread-main">
					{#if annotation.thread.length > 0}
						<div class="thread-stack">
							{#each annotation.thread as message (message.time)}
								<ReadonlyThreadMessage {message} />
							{/each}
						</div>
					{:else}
						<p class="empty-state">No thread messages were attached to this comment.</p>
					{/if}
				</div>
				<div class="comment-context-panel">
					<ContextViewport
						layers={commentContextLayers}
						variant="comment"
						targetLabel="comment"
						centerKey={annotation.id}
						fill
						onLoadMoreBefore={() => (commentContextBefore += COMMENT_CONTEXT_CHUNK)}
						onLoadMoreAfter={() => (commentContextAfter += COMMENT_CONTEXT_CHUNK)}
					/>
				</div>
			</div>
		</AnnotationModalFrame>
	{:else}
		<AnnotationModalFrame variant="suggestion">
			<AnnotationModalHeader
				accent="suggestion"
				leading={suggestionHeaderLeading}
				onClose={onClose}
				closeLabel="Close suggestion"
			/>

			<div class="diff-modal-body">
				<SuggestionModalContent
					selectionKey={annotation.id}
					originalText={annotation.selectedText}
					replacements={annotation.replacements}
					messages={annotation.thread}
				/>
			</div>
		</AnnotationModalFrame>
	{/if}
</div>

<style>
	.readonly-modal {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: rgba(0, 0, 0, 0.3);
		backdrop-filter: blur(4px);
	}

	.comment-breadcrumbs,
	.suggestion-breadcrumbs {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
	}

	.revision-modal-body,
	.comment-modal-body,
	.diff-modal-body {
		display: flex;
		min-height: 0;
		flex: 1;
		overflow: hidden;
	}

	.revision-modal-thread {
		display: flex;
		width: 220px;
		min-height: 0;
		flex-shrink: 0;
		flex-direction: column;
		border-right: 1px solid var(--tint-purple-border);
		background: var(--tint-purple-active);
	}

	.thread-panel-header {
		flex-shrink: 0;
		border-bottom: 1px solid rgba(243, 232, 255, 0.5);
		padding: 0.75rem 1rem;
	}

	.thread-panel-header span {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: rgba(147, 51, 234, 0.6);
	}

	.thread-panel-body {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem 1rem;
	}

	.thread-stack {
		display: grid;
		gap: 0.8rem;
	}

	.revision-modal-editor {
		min-width: 0;
		flex: 1;
		overflow-y: auto;
		background: transparent;
		font-family: var(--doc-font-family, system-ui, sans-serif);
	}

	.revision-modal-document {
		min-height: 100%;
		padding: 20px 32px 32px;
		font-family: var(--doc-font-family, system-ui, sans-serif);
		font-size: 15px;
		line-height: 1.7;
		color: var(--text);
	}

	.revision-modal-document.real-editor {
		height: 100%;
		min-height: 0;
		padding: 0;
	}

	.revision-modal-document.real-editor :global(.cm-scroller) {
		overflow: auto;
		line-height: 1.7;
	}

	.revision-modal-document.real-editor :global(.cm-content) {
		min-height: 100%;
		padding: 20px 32px 32px;
		font-family: var(--doc-font-family, system-ui, sans-serif);
		font-size: 15px;
	}

	.revision-modal-document.real-editor :global(.cm-line) {
		padding: 0;
	}

	.revision-right-panel {
		display: flex;
		width: 18rem;
		min-height: 0;
		flex-shrink: 0;
		flex-direction: column;
		overflow-x: hidden;
		border-left: 1px solid rgba(243, 232, 255, 0.6);
		background: rgba(250, 245, 255, 0.2);
	}

	.comment-thread-main {
		min-width: 0;
		flex: 1;
		overflow-y: auto;
		padding: 1.25rem 1.5rem;
	}

	.comment-context-panel {
		display: flex;
		width: 33.333%;
		min-height: 0;
		flex-shrink: 0;
		flex-direction: column;
		border-left: 1px solid rgba(219, 234, 254, 0.6);
		background: rgba(239, 246, 255, 0.2);
	}

	.empty-state {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.55;
		color: var(--text-faint);
	}

	@media (max-width: 860px) {
		.readonly-modal {
			padding: 0.75rem;
		}

		.revision-modal-body,
		.comment-modal-body {
			display: block;
			overflow-y: auto;
		}

		.revision-modal-thread,
		.revision-right-panel,
		.comment-context-panel {
			width: auto;
			border-width: 1px 0;
		}

		.revision-modal-editor,
		.comment-thread-main {
			min-height: 18rem;
		}
	}
</style>
