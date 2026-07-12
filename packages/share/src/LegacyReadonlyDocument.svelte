<script lang="ts">
/**
 * LegacyReadonlyDocument.svelte — Compatibility renderer for public shares
 * published before serialized CodeMirror state was available.
 *
 * This component intentionally owns the old flat annotation projection and
 * static HTML rendering path. New read-only behavior belongs in
 * ReadonlyDocument.svelte and must not be added here unless legacy payloads
 * require it.
 */
import { fade, fly } from "svelte/transition";
import ReadonlyAnnotatedText from "./ReadonlyAnnotatedText.svelte";
import ReadonlyAnnotationCard from "./ReadonlyAnnotationCard.svelte";
import ReadonlyAnnotationModal from "./ReadonlyAnnotationModal.svelte";
import {
    type AnnotationId,
    type RevisionVersionSelections,
    buildDisplayedShare,
    findAnnotationPath,
    getSelectedRevisionVersionIndex,
} from "./rendering";
import type { SerializedAnnotation } from "./types";

let {
    content,
    annotations,
}: {
    content: string;
    annotations: SerializedAnnotation[];
} = $props();

type AnnotationPath = NonNullable<ReturnType<typeof findAnnotationPath>>;

let activeInlineAnnotationId = $state<AnnotationId | null>(null);
let modalAnnotationStack = $state<AnnotationId[]>([]);
let initializedSelection = $state(false);
let revisionVersionSelections = $state<RevisionVersionSelections>({});

const modalAnnotationId = $derived(modalAnnotationStack.at(-1) ?? null);

function selectAnnotation(id: AnnotationId): void {
    activeInlineAnnotationId = id;
}

function openAnnotationModal(id: AnnotationId): void {
    activeInlineAnnotationId = id;
    const path = findAnnotationPath(id, content, annotations) as AnnotationPath | null;
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

function closeAnnotationModal(): void {
    const nextStack = modalAnnotationStack.slice(0, -1);
    modalAnnotationStack = nextStack;
    if (nextStack.length > 0) {
        activeInlineAnnotationId = nextStack.at(-1) ?? activeInlineAnnotationId;
    }
}

function selectRevisionVersion(annotationId: AnnotationId, versionIndex: number): void {
    revisionVersionSelections = {
        ...revisionVersionSelections,
        [annotationId]: versionIndex,
    };
}

const sortedAnnotations = $derived(
    [...annotations].sort((a, b) => a.from - b.from || a.to - b.to || a.id.localeCompare(b.id)),
);

const displayedShare = $derived(
    buildDisplayedShare(content, sortedAnnotations, revisionVersionSelections),
);
const displayAnnotations = $derived(displayedShare.annotations);

const modalAnnotationPath = $derived(
    modalAnnotationId
        ? ((findAnnotationPath(modalAnnotationId, content, annotations) as AnnotationPath | null) ??
              [])
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
</script>

<!-- This hook keeps the compatibility path explicit in tests and diagnostics. -->
<div class="editor-stage" data-readonly-renderer="legacy-static">
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
                        selectedRevisionVersionIndex={annotation.type === "revision"
                            ? getSelectedRevisionVersionIndex(
                                  annotation,
                                  revisionVersionSelections,
                              )
                            : null}
                        onSelect={() => selectAnnotation(annotation.id)}
                        onSelectAnnotation={openAnnotationModal}
                        onOpen={() => openAnnotationModal(annotation.id)}
                        onSelectRevisionVersion={(versionIndex) =>
                            selectRevisionVersion(annotation.id, versionIndex)}
                    />
                {/each}
            {:else}
                <p class="annotation-empty-state">
                    This snapshot does not have any annotations yet.
                </p>
            {/if}
        </div>
    </aside>
</div>

{#if modalAnnotation}
    <ReadonlyAnnotationModal
        annotation={modalAnnotation}
        rootContent={content}
        rootAnnotations={annotations}
        activeAnnotationId={activeInlineAnnotationId}
        {revisionVersionSelections}
        onClose={closeAnnotationModal}
        onSelectAnnotation={openAnnotationModal}
        onSelectRevisionVersion={selectRevisionVersion}
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
        font-family: var(--doc-font-family, "SF Pro Text", system-ui, sans-serif);
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
