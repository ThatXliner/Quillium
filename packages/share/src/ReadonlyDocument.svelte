<script lang="ts">
/**
 * ReadonlyDocument.svelte — Renders a shared document through the REAL
 * read-only CodeMirror editor (the same annotation core the desktop app
 * uses), so highlights, revisions, and linked revisions (version groups)
 * render with exact fidelity.
 *
 * The EditorView is the source of truth: its doc already has the active
 * revision versions materialized. The annotation sidebar is a live projection
 * of the editor state (serializeFromState), recomputed after each dispatch.
 * Switching a revision version dispatches into the editor, which cascades
 * through any linked version groups automatically.
 */
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { onMount, tick } from "svelte";
import { fade, fly } from "svelte/transition";
import ReadonlyAnnotationCard from "./ReadonlyAnnotationCard.svelte";
import ReadonlyAnnotationModal from "./ReadonlyAnnotationModal.svelte";
import ReadonlyEditorHost from "./ReadonlyEditorHost.svelte";
import { type PersonaColor, ReadonlyEditorController, resolveRevisionVersionState } from "./core";
import {
    AnnotationColumn,
    type AnnotationLayoutId,
    TOP_CLAMP,
    canFloatAnnotationColumn,
} from "./layout";
import { type AnnotationId, type RevisionVersionSelections, findAnnotationPath } from "./rendering";
import type { SerializedAnnotation } from "./types";

let {
    serializedState,
    personaColors = [],
    atomicRevisions = true,
    indented = true,
}: {
    /** Serialized CM state object (state.toJSON(readonlySavedFields)). */
    serializedState: Record<string, unknown>;
    personaColors?: PersonaColor[];
    atomicRevisions?: boolean;
    indented?: boolean;
} = $props();

type AnnotationPath = NonNullable<ReturnType<typeof findAnnotationPath>>;

let editorSheet = $state<HTMLElement | null>(null);
let view = $state<EditorView | null>(null);
const editorController = new ReadonlyEditorController();
// Bumped after every dispatch so the projection recomputes off the new state.
let rev = $state(0);

let activeInlineAnnotationId = $state<AnnotationId | null>(null);
let modalAnnotationStack = $state<AnnotationId[]>([]);
// Client-side selections used ONLY by the modal explorer (drilling into
// non-active nested versions). The main document body is editor-authoritative.
let modalRevisionSelections = $state<RevisionVersionSelections>({});
let floatingCards = $state(true);

const projection = $derived.by(() => {
    void rev;
    return editorController.snapshot();
});
const annotations = $derived(projection.annotations);
const annotationIds = $derived(annotations.map((annotation) => annotation.id));
const modalAnnotationId = $derived(modalAnnotationStack.at(-1) ?? null);

const modalAnnotationPath = $derived(
    modalAnnotationId
        ? ((findAnnotationPath(
              modalAnnotationId,
              projection.content,
              annotations,
          ) as AnnotationPath | null) ?? [])
        : [],
);
const modalAnnotation = $derived(
    (modalAnnotationPath.at(-1)?.annotation as SerializedAnnotation | undefined) ?? null,
);
const modalRevisionState = $derived(
    view && modalAnnotation?.type === "revision"
        ? resolveRevisionVersionState(view.state, modalAnnotation.id, modalRevisionSelections)
        : null,
);

function selectAnnotation(id: AnnotationId) {
    if (!editorController.selectAnnotation(id, { focus: true })) return;
    activeInlineAnnotationId = id;
    rev += 1;
}

function getAnnotationViewportY(id: AnnotationLayoutId): number {
    const annotation = annotations.find((candidate) => candidate.id === String(id));
    if (!view || !annotation) return TOP_CLAMP;
    try {
        const coordinates = view.coordsAtPos(annotation.from);
        return coordinates ? coordinates.top - 10 : TOP_CLAMP;
    } catch {
        return TOP_CLAMP;
    }
}

function getAnnotationColumnGeometry(): { left: number; width: number } {
    if (!editorSheet) return { left: 0, width: 0 };
    const left = editorSheet.getBoundingClientRect().right + 16;
    return {
        left,
        width: Math.min(360, Math.max(0, window.innerWidth - left - 32)),
    };
}

function switchRevisionVersion(annotationId: AnnotationId, versionIndex: number) {
    if (!editorController.switchRevisionVersion(annotationId, versionIndex)) return;
    rev += 1;
}

function openAnnotationModal(id: AnnotationId) {
    activeInlineAnnotationId = id;
    const path = findAnnotationPath(id, projection.content, annotations) as AnnotationPath | null;
    if (path) {
        const selections = { ...modalRevisionSelections };
        for (const entry of path) {
            if (entry.annotation.type === "revision" && entry.viaVersionIndex !== null) {
                selections[entry.annotation.id] = entry.viaVersionIndex;
            }
        }
        modalRevisionSelections = selections;
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

function handleEditorReady(nextView: EditorView | null): void {
    view = nextView;
    editorController.attach(nextView);
    rev += 1;
    activeInlineAnnotationId = nextView ? editorController.activeAnnotationId() : null;
}

function handleEditorUpdate(update: ViewUpdate): void {
    if (!update.docChanged && !update.selectionSet) return;
    rev += 1;
    activeInlineAnnotationId = editorController.activeAnnotationId();
}

function selectModalRevisionVersion(annotationId: AnnotationId, versionIndex: number) {
    const { [annotationId]: _previousSelection, ...otherSelections } = modalRevisionSelections;
    modalRevisionSelections = { ...otherSelections, [annotationId]: versionIndex };
}

function syncModalRevisionSelections(selections: RevisionVersionSelections) {
    const nextSelections = { ...modalRevisionSelections, ...selections };
    const currentKeys = Object.keys(modalRevisionSelections);
    const nextKeys = Object.keys(nextSelections);
    if (
        currentKeys.length === nextKeys.length &&
        nextKeys.every((key) => modalRevisionSelections[key] === nextSelections[key])
    ) {
        return;
    }
    modalRevisionSelections = nextSelections;
}

onMount(() => {
    let frame: number | undefined;
    const updateFloatingCards = () => {
        const next = canFloatAnnotationColumn(getAnnotationColumnGeometry());
        if (floatingCards !== next) {
            floatingCards = next;
            // The inline fallback changes flex participation. Measure again
            // after Svelte applies the stacked layout, rather than relying on
            // a viewport breakpoint that can disagree with the real geometry.
            tick().then(() => {
                frame = requestAnimationFrame(updateFloatingCards);
            });
        }
    };
    window.addEventListener("resize", updateFloatingCards);
    frame = requestAnimationFrame(updateFloatingCards);
    return () => {
        window.removeEventListener("resize", updateFloatingCards);
        if (frame !== undefined) cancelAnimationFrame(frame);
    };
});
</script>

<div class="editor-stage" class:is-stacked={!floatingCards}>
	<section class="editor-sheet" bind:this={editorSheet} in:fade={{ duration: 420 }}>
		<div class="share-document" class:is-indented={indented}>
			<ReadonlyEditorHost
				{serializedState}
				{personaColors}
				{atomicRevisions}
				onReady={handleEditorReady}
				onUpdate={handleEditorUpdate}
			/>
		</div>
	</section>

	{#if floatingCards}
		<AnnotationColumn
			ids={annotationIds}
			activeId={activeInlineAnnotationId}
			layoutVersion={rev}
			getViewportY={getAnnotationViewportY}
			getColumnGeometry={getAnnotationColumnGeometry}
			scrollTargets={view ? [view.scrollDOM] : []}
			onActivate={(id) => selectAnnotation(String(id))}
		>
			{#snippet card(id, active)}
				{@const annotation = annotations.find((candidate) => candidate.id === String(id))}
				{#if annotation}
					<ReadonlyAnnotationCard
						{annotation}
						{active}
						activeAnnotationId={activeInlineAnnotationId}
						selectedRevisionVersionIndex={annotation.type === 'revision'
							? annotation.activeVersionIndex
							: null}
						onSelect={() => selectAnnotation(annotation.id)}
						onSelectAnnotation={openAnnotationModal}
						onOpen={() => openAnnotationModal(annotation.id)}
						onSelectRevisionVersion={(versionIndex) =>
							switchRevisionVersion(annotation.id, versionIndex)}
					/>
				{/if}
			{/snippet}
		</AnnotationColumn>
	{:else}
	<aside class="annotation-column" in:fly={{ x: 20, duration: 420, delay: 60 }}>
		<div class="annotation-card-stack">
			{#if annotations.length > 0}
				{#each annotations as annotation (annotation.id)}
					<ReadonlyAnnotationCard
						{annotation}
						active={activeInlineAnnotationId === annotation.id}
						activeAnnotationId={activeInlineAnnotationId}
						selectedRevisionVersionIndex={annotation.type === 'revision'
							? annotation.activeVersionIndex
							: null}
						onSelect={() => selectAnnotation(annotation.id)}
						onSelectAnnotation={openAnnotationModal}
						onOpen={() => openAnnotationModal(annotation.id)}
						onSelectRevisionVersion={(versionIndex) =>
							switchRevisionVersion(annotation.id, versionIndex)}
					/>
				{/each}
			{:else}
				<p class="annotation-empty-state">This snapshot does not have any annotations yet.</p>
			{/if}
		</div>
	</aside>
	{/if}
</div>

{#if modalAnnotation}
	<ReadonlyAnnotationModal
		annotation={modalAnnotation}
		rootContent={projection.content}
		rootAnnotations={annotations}
		activeAnnotationId={activeInlineAnnotationId}
		revisionVersionSelections={modalRevisionSelections}
		revisionState={modalRevisionState as Record<string, unknown> | null}
		onClose={closeAnnotationModal}
		onSelectAnnotation={openAnnotationModal}
		onSelectRevisionVersion={selectModalRevisionVersion}
		onRevisionSelectionsChange={syncModalRevisionSelections}
	/>
{/if}

<style>
	.editor-stage {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		gap: 1.5rem;
	}

	.editor-stage.is-stacked {
		display: grid;
	}

	.editor-sheet {
		width: min(816px, 100%);
		min-height: calc(100vh - 4rem);
		padding: 0.75rem 0.25rem;
		border-radius: 0.5rem;
		background: var(--surface);
		box-shadow: 0 20px 46px rgba(var(--shadow-color), 0.18);
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

	/* Neutralize CodeMirror's chrome so the doc reads like prose, not a code editor. */
	.share-document :global(.cm-editor) {
		background: transparent;
	}
	.share-document :global(.cm-editor.cm-focused) {
		outline: none;
	}
	.share-document :global(.cm-scroller) {
		font-family: inherit;
		line-height: inherit;
	}
	.share-document :global(.cm-content) {
		padding: 0;
	}
	.share-document :global(.cm-gutters) {
		display: none;
	}
	.share-document :global(.cm-line) {
		padding: 0;
	}
	.share-document.is-indented :global(.cm-line) {
		text-indent: 2em;
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

	@media (max-width: 980px) {
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
