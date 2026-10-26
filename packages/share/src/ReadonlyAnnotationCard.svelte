<script lang="ts">
import CommentCard from "./cards/CommentCard.svelte";
import RevisionCard from "./cards/RevisionCard.svelte";
import SuggestionCard from "./cards/SuggestionCard.svelte";
import ThreadList from "./cards/ThreadList.svelte";
import type { RevisionVersionView } from "./cards/types";
import { wordDiff } from "./diff";
import { type AnnotationId, type RevisionVersionSelections, previewVersionText } from "./rendering";
import type { SerializedAnnotation } from "./types";
import { hasIdenticalTextContent } from "./versionComparison";

let {
    annotation,
    active,
    activeAnnotationId = null,
    revisionVersionSelections = {},
    selectedRevisionVersionIndex,
    onSelect,
    onSelectAnnotation,
    onOpen,
    onSelectRevisionVersion,
}: {
    annotation: SerializedAnnotation;
    active: boolean;
    activeAnnotationId?: AnnotationId | null;
    revisionVersionSelections?: RevisionVersionSelections;
    selectedRevisionVersionIndex: number | null;
    onSelect: () => void;
    onSelectAnnotation?: (annotationId: AnnotationId) => void;
    onOpen?: () => void;
    onSelectRevisionVersion: (versionIndex: number) => void;
} = $props();

const revisionVersions = $derived.by((): RevisionVersionView[] => {
    if (annotation.type !== "revision") return [];
    const selected =
        annotation.versions.find((version) => version.index === selectedRevisionVersionIndex) ??
        annotation.versions[annotation.activeVersionIndex] ??
        annotation.versions[0];
    return annotation.versions.map((version, index) => ({
        id: version.versionId ?? `${annotation.id}:${version.index}`,
        index: version.index,
        label: version.label ?? previewVersionText(version),
        text: version.text,
        active: version.index === selected?.index,
        identicalToPrevious:
            index > 0 &&
            hasIdenticalTextContent(version.text, annotation.versions[index - 1]?.text ?? ""),
        group: version.group,
    }));
});

const suggestionReplies = $derived(
    annotation.type === "suggestion" && annotation.thread[0]?.author === "AI"
        ? annotation.thread.slice(1)
        : annotation.thread,
);
</script>

{#snippet readonlyThread()}
    {#if annotation.thread.length > 0}
        <ThreadList thread={annotation.thread} previewOnly={!active} />
    {:else}
        <p class="text-xs leading-relaxed text-black/70">
            No thread messages were attached to this comment.
        </p>
    {/if}
{/snippet}

{#snippet readonlySuggestionReplies()}
    <ThreadList thread={suggestionReplies} previewOnly={!active} />
{/snippet}

{#if annotation.type === "comment"}
    <CommentCard
        annotationId={annotation.id}
        {active}
        selectedText={annotation.selectedText}
        onSelectText={onSelect}
        {onOpen}
        thread={readonlyThread}
    />
{:else if annotation.type === "suggestion"}
    <SuggestionCard
        annotationId={annotation.id}
        {active}
        scrollOnActivate={false}
        replacements={annotation.replacements}
        overallComment={annotation.thread[0]?.author === "AI"
            ? annotation.thread[0].message
            : undefined}
        onReplacementSelect={onSelect}
        getDiffOperations={(index) =>
            wordDiff(annotation.selectedText, annotation.replacements[index]?.text ?? "")}
        {onOpen}
        thread={suggestionReplies.length > 0 ? readonlySuggestionReplies : undefined}
    />
{:else}
    <RevisionCard
        revisionId={annotation.id}
        {active}
        versions={revisionVersions}
        onOpen={onOpen}
        onSelectVersion={(version) => {
            onSelect();
            onSelectRevisionVersion(version.index);
        }}
        thread={annotation.thread.length > 0 ? readonlyThread : undefined}
    />
{/if}
