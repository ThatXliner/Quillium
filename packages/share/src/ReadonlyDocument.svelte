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
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { onDestroy, onMount } from "svelte";
import "./core/annotations.css";
import { fade, fly } from "svelte/transition";
import ReadonlyAnnotationCard from "./ReadonlyAnnotationCard.svelte";
import ReadonlyAnnotationModal from "./ReadonlyAnnotationModal.svelte";
import {
    type PersonaColor,
    annotationField,
    getReadonlyExtensions,
    isAnnotationOfType,
    readonlySavedFields,
    serializeFromState,
    setActiveRevisionVersion,
} from "./core";
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

let host = $state<HTMLDivElement | null>(null);
let view: EditorView | null = null;
// Bumped after every dispatch so the projection recomputes off the new state.
let rev = $state(0);
let mountError = $state<string | null>(null);

let activeInlineAnnotationId = $state<AnnotationId | null>(null);
let modalAnnotationStack = $state<AnnotationId[]>([]);
// Client-side selections used ONLY by the modal explorer (drilling into
// non-active nested versions). The main document body is editor-authoritative.
let modalRevisionSelections = $state<RevisionVersionSelections>({});

const projection = $derived.by(() => {
    void rev;
    return view ? serializeFromState(view.state) : { content: "", annotations: [] };
});
const annotations = $derived(projection.annotations);
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

/** Map a top-level serialized annotation id back to its numeric field key. */
function fieldKeyOf(id: AnnotationId): number | null {
    if (!view || id.includes(".v")) return null; // nested versions not switchable here
    const map = view.state.field(annotationField, false);
    if (!map) return null;
    for (const key of Object.keys(map)) {
        if (String(key) === id) return Number(key);
    }
    return null;
}

function selectAnnotation(id: AnnotationId) {
    activeInlineAnnotationId = id;
    const annotation = annotations.find((a) => a.id === id);
    if (!view || !annotation) return;
    // Move the (hidden) cursor into the range so getActiveAnnotation lights up
    // the highlight, matching the desktop editor's active styling.
    view.dispatch({ selection: EditorSelection.cursor(annotation.from) });
    rev += 1;
}

function switchRevisionVersion(annotationId: AnnotationId, versionIndex: number) {
    if (!view) return;
    const key = fieldKeyOf(annotationId);
    if (key === null) return;
    const revision = view.state.field(annotationField, false)?.[key];
    if (!revision || !isAnnotationOfType(revision, "revision")) return;
    const target = revision.versions[versionIndex];
    if (!target) return;
    view.dispatch(setActiveRevisionVersion(view.state, key, target.id, { moveCursor: true }));
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

function selectModalRevisionVersion(annotationId: AnnotationId, versionIndex: number) {
    modalRevisionSelections = { ...modalRevisionSelections, [annotationId]: versionIndex };
}

onMount(() => {
    if (!host) return;
    try {
        const editorState = EditorState.fromJSON(
            serializedState,
            { extensions: getReadonlyExtensions({ atomicRevisions, personaColors }) },
            readonlySavedFields,
        );
        view = new EditorView({ state: editorState, parent: host });
        rev += 1;
        activeInlineAnnotationId = serializeFromState(view.state).annotations[0]?.id ?? null;
    } catch (err) {
        mountError = err instanceof Error ? err.message : String(err);
    }
});

onDestroy(() => {
    view?.destroy();
    view = null;
});
</script>

<div class="editor-stage">
	<section class="editor-sheet" in:fade={{ duration: 420 }}>
		{#if mountError}
			<p class="mount-error">This document couldn't be rendered.</p>
		{/if}
		<div class="share-document" class:is-indented={indented} bind:this={host}></div>
	</section>

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
</div>

{#if modalAnnotation}
	<ReadonlyAnnotationModal
		annotation={modalAnnotation}
		rootContent={projection.content}
		rootAnnotations={annotations}
		activeAnnotationId={activeInlineAnnotationId}
		revisionVersionSelections={modalRevisionSelections}
		onClose={closeAnnotationModal}
		onSelectAnnotation={openAnnotationModal}
		onSelectRevisionVersion={selectModalRevisionVersion}
	/>
{/if}

<style>
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

	.mount-error {
		margin: 0 0 0.75rem;
		color: var(--text-soft);
		font-size: 0.9rem;
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
