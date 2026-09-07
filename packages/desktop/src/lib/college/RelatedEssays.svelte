<!-- RelatedEssays.svelte — Explicit application groups and citation-backed review. -->
<script lang="ts">
import type { CollegeCapabilities, CollegeCapabilitiesSnapshot } from "./capabilities";
import type {
    CollegeEssayCandidate,
    CollegeReviewWorkspace,
    CollegeReviewWorkspaceGroup,
    CrossEssayReviewPreview,
} from "./review";
import type { Citation, CollegeReviewGroup, CollegeReviewSourceRef, Report } from "./reviewModel";

let {
    college,
    view,
}: {
    college: CollegeCapabilities;
    view: CollegeCapabilitiesSnapshot;
} = $props();

type EssayChoice = {
    key: string;
    documentId: string;
    tabId: string;
    documentLabel: string;
    tabLabel: string;
    candidates: CollegeEssayCandidate[];
};

let workspace = $state<CollegeReviewWorkspace | null>(null);
let loading = $state(false);
let busy = $state(false);
let error = $state("");
let editing = $state(false);
let editingId = $state<string | null>(null);
let name = $state("");
let school = $state("");
let cycle = $state("");
let selectedDrafts = $state<Record<string, string>>({});
let preview = $state<CrossEssayReviewPreview | null>(null);
let report = $state<Report | null>(null);
let removingGroupId = $state<string | null>(null);
let reviewController = $state<AbortController | null>(null);
let previousTarget = "";
const targetKey = $derived(`${view.documentId ?? ""}:${view.tabId ?? ""}:${view.draftId ?? ""}`);

$effect(() => {
    if (targetKey === previousTarget) return;
    previousTarget = targetKey;
    reviewController?.abort();
    reviewController = null;
    editing = false;
    preview = null;
    report = null;
    removingGroupId = null;
    void loadWorkspace();
});

function essayKey(source: Pick<CollegeEssayCandidate, "documentId" | "tabId">): string {
    return `${source.documentId}\u0000${source.tabId}`;
}

function choices(): EssayChoice[] {
    const byEssay = new Map<string, EssayChoice>();
    for (const candidate of workspace?.candidates ?? []) {
        const key = essayKey(candidate);
        const existing = byEssay.get(key);
        if (existing) {
            existing.candidates.push(candidate);
        } else {
            byEssay.set(key, {
                key,
                documentId: candidate.documentId,
                tabId: candidate.tabId,
                documentLabel: candidate.documentLabel,
                tabLabel: candidate.tabLabel,
                candidates: [candidate],
            });
        }
    }
    return [...byEssay.values()];
}

function selectedCount(): number {
    return Object.values(selectedDrafts).filter(Boolean).length;
}

function schoolMatches(candidate: CollegeEssayCandidate): boolean {
    const sourceSchool = candidate.setupSchool.trim().toLocaleLowerCase();
    return sourceSchool === "" || sourceSchool === school.trim().toLocaleLowerCase();
}

async function loadWorkspace(): Promise<void> {
    loading = true;
    error = "";
    try {
        workspace = await college.loadReviewWorkspace();
        if (!report) {
            const currentGroup = workspace.groups.find((entry) =>
                workspace?.currentDraftGroupIds.includes(entry.group.id),
            );
            report = currentGroup?.group.latestReport ?? null;
        }
    } catch (cause) {
        error = cause instanceof Error ? cause.message : "Could not load related essays.";
    } finally {
        loading = false;
    }
}

function beginGroup(group?: CollegeReviewGroup): void {
    editing = true;
    editingId = group?.id ?? null;
    name =
        group?.name ??
        (view.setup?.school ? `${view.setup.school} application` : "Application review");
    school = group?.school ?? view.setup?.school ?? "";
    cycle = group?.cycle ?? view.setup?.cycle ?? "";
    const next: Record<string, string> = {};
    for (const source of group?.sources ?? []) {
        next[`${source.documentId}\u0000${source.tabId}`] = source.draftId;
    }
    if (!group && view.documentId && view.tabId) {
        const current = workspace?.candidates.find(
            (candidate) =>
                candidate.documentId === view.documentId &&
                candidate.tabId === view.tabId &&
                candidate.draftId === view.draftId,
        );
        if (current) next[essayKey(current)] = current.draftId;
    }
    selectedDrafts = next;
    preview = null;
    report = group?.latestReport ?? null;
    error = "";
}

function toggleEssay(choice: EssayChoice, checked: boolean): void {
    const next = { ...selectedDrafts };
    if (checked) {
        const preferred = choice.candidates.find((candidate) => candidate.draftId === view.draftId);
        next[choice.key] = preferred?.draftId ?? choice.candidates[0]?.draftId ?? "";
    } else {
        delete next[choice.key];
    }
    selectedDrafts = next;
}

function selectDraft(choice: EssayChoice, draftId: string): void {
    selectedDrafts = { ...selectedDrafts, [choice.key]: draftId };
}

function chosenSources(): CollegeReviewSourceRef[] {
    return choices().flatMap((choice) => {
        const draftId = selectedDrafts[choice.key];
        if (!draftId) return [];
        return [{ documentId: choice.documentId, tabId: choice.tabId, draftId }];
    });
}

async function saveGroup(): Promise<void> {
    if (busy || selectedCount() < 2 || !school.trim() || !name.trim()) return;
    busy = true;
    error = "";
    try {
        const saved = await college.saveReviewGroup({
            version: 1,
            id: editingId ?? undefined,
            name: name.trim(),
            school: school.trim(),
            cycle: cycle.trim(),
            sources: chosenSources(),
        });
        editing = false;
        editingId = null;
        await loadWorkspace();
        const resolved = workspace?.groups.find((entry) => entry.group.id === saved.id);
        report = resolved?.group.latestReport ?? null;
    } catch (cause) {
        error = cause instanceof Error ? cause.message : "Could not save this application group.";
    } finally {
        busy = false;
    }
}

async function removeGroup(group: CollegeReviewGroup): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    try {
        await college.deleteReviewGroup(group.id);
        removingGroupId = null;
        if (report?.groupId === group.id) report = null;
        preview = null;
        await loadWorkspace();
    } catch (cause) {
        error = cause instanceof Error ? cause.message : "Could not remove this application group.";
    } finally {
        busy = false;
    }
}

async function prepare(group: CollegeReviewGroup): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    report = group.latestReport ?? null;
    try {
        preview = await college.prepareReview(group);
    } catch (cause) {
        error = cause instanceof Error ? cause.message : "Could not prepare these essays.";
    } finally {
        busy = false;
    }
}

async function runReview(): Promise<void> {
    if (!preview || busy) return;
    busy = true;
    error = "";
    reviewController = new AbortController();
    try {
        report = await college.runReview(preview.id, reviewController.signal);
        preview = null;
        await loadWorkspace();
    } catch (cause) {
        if (!reviewController.signal.aborted) {
            error = cause instanceof Error ? cause.message : "Could not review these essays.";
        }
    } finally {
        reviewController = null;
        busy = false;
    }
}

function stopReview(): void {
    reviewController?.abort(new DOMException("Cross-essay review was cancelled.", "AbortError"));
}

function openMember(member: CollegeReviewWorkspaceGroup["members"][number]): void {
    if (member.state === "missing" || member.state === "trashed") return;
    college.navigateToReviewSource(member.sourceRef);
}

function openCitation(item: Citation, currentReport: Report): void {
    const source = currentReport.capturedSources.find(
        (candidate) => candidate.sourceKey === item.sourceKey,
    );
    if (!source) return;
    college.navigateToReviewSource(
        { documentId: source.documentId, tabId: source.tabId, draftId: source.draftId },
        item,
        source.contentFingerprint,
    );
}

function sourceLabel(sourceKey: string, currentReport: Report): string {
    const source = currentReport.capturedSources.find(
        (candidate) => candidate.sourceKey === sourceKey,
    );
    return source ? `${source.tabLabel} · ${source.draftLabel}` : "Captured passage";
}
</script>

<details class="related border-t border-black/10 pt-3">
    <summary class="text-xs cursor-pointer font-medium">Related essays</summary>
    <div class="space-y-3 pt-3 text-xs">
        <p class="text-black/60">
            Group the exact drafts one school will read together. Quillium only opens or reviews the essays you choose.
        </p>

        {#if error}<p role="alert" class="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>{/if}
        {#if loading}<p role="status">Loading related essays…</p>{/if}

        {#if editing}
            <div class="space-y-3 rounded-lg bg-white/35 p-3">
                <label>Application name<input maxlength="200" bind:value={name} /></label>
                <div class="grid grid-cols-2 gap-2">
                    <label>School<input maxlength="200" bind:value={school} placeholder="Required" /></label>
                    <label>Cycle<input maxlength="100" bind:value={cycle} placeholder="Optional" /></label>
                </div>
                <fieldset class="space-y-2" disabled={busy}>
                    <legend class="font-medium">Essays and drafts</legend>
                    {#each choices() as choice (choice.key)}
                        {@const selectedDraft = selectedDrafts[choice.key]}
                        {@const available = choice.candidates.some(schoolMatches)}
                        <div class="essay-choice" class:unavailable={!available}>
                            <label class="essay-toggle">
                                <input
                                    type="checkbox"
                                    checked={Boolean(selectedDraft)}
                                    disabled={!available}
                                    onchange={(event) => toggleEssay(choice, event.currentTarget.checked)}
                                />
                                <span>
                                    <strong class="font-medium">{choice.tabLabel}</strong>
                                    <span class="block text-black/50">{choice.documentLabel}</span>
                                </span>
                            </label>
                            {#if selectedDraft}
                                <label class="draft-choice">
                                    Draft
                                    <select
                                        value={selectedDraft}
                                        onchange={(event) => selectDraft(choice, event.currentTarget.value)}
                                    >
                                        {#each choice.candidates.filter(schoolMatches) as candidate (candidate.draftId)}
                                            <option value={candidate.draftId}>{candidate.draftLabel}</option>
                                        {/each}
                                    </select>
                                </label>
                            {:else if !available}
                                <p class="text-black/50">This essay is set up for another school.</p>
                            {/if}
                        </div>
                    {/each}
                </fieldset>
                <p class="text-black/50">Choose one draft from at least two essay tabs. Alternate drafts are never added automatically.</p>
                <div class="flex flex-wrap gap-2">
                    <button class="primary" disabled={busy || selectedCount() < 2 || !name.trim() || !school.trim()} onclick={saveGroup}>
                        {busy ? "Saving…" : "Save selection"}
                    </button>
                    <button class="secondary" disabled={busy} onclick={() => (editing = false)}>Cancel</button>
                </div>
            </div>
        {:else if workspace}
            {#each workspace.groups as entry (entry.group.id)}
                <section class="group-card space-y-3" aria-label={entry.group.name}>
                    <div>
                        <h3 class="font-medium text-black/80">{entry.group.name}</h3>
                        <p class="text-black/50">{[entry.group.school, entry.group.cycle].filter(Boolean).join(" · ")}</p>
                    </div>
                    <ul class="space-y-1" aria-label="Selected essays">
                        {#each entry.members as member (member.sourceKey)}
                            <li>
                                <button
                                    class="member-link"
                                    disabled={member.state === "missing" || member.state === "trashed"}
                                    onclick={() => openMember(member)}
                                >
                                    <span>{member.tabLabel} · {member.draftLabel}</span>
                                    <span class="block text-black/50">{member.documentLabel}{member.sourceRef.draftId === view.draftId ? " · Current draft" : ""}{member.state === "trashed" ? " · In Trash" : member.state === "missing" ? " · Missing" : ""}</span>
                                </button>
                            </li>
                        {/each}
                    </ul>
                    <div class="flex flex-wrap gap-2">
                        <button class="primary" disabled={busy || entry.members.some((member) => member.state !== "live" && member.state !== "changed-draft")} onclick={() => prepare(entry.group)}>
                            {busy ? "Preparing…" : "Review selection"}
                        </button>
                        {#if entry.group.latestReport}
                            <button class="secondary" disabled={busy} onclick={() => (report = entry.group.latestReport ?? null)}>View last review</button>
                        {/if}
                        <button class="secondary" disabled={busy} onclick={() => beginGroup(entry.group)}>Edit selection</button>
                    </div>
                    <details>
                        <summary class="text-black/50">Group settings</summary>
                        {#if removingGroupId === entry.group.id}
                            <p class="mt-2 text-black/60">Remove this group and its saved report? Your essays and College setups stay.</p>
                            <div class="mt-2 flex flex-wrap gap-2">
                                <button class="secondary" disabled={busy} onclick={() => (removingGroupId = null)}>Cancel</button>
                                <button class="remove-action" disabled={busy} onclick={() => removeGroup(entry.group)}>Remove group</button>
                            </div>
                        {:else}
                            <button class="remove-action mt-2" disabled={busy} onclick={() => (removingGroupId = entry.group.id)}>Remove group…</button>
                        {/if}
                    </details>
                </section>
            {:else}
                <p>No related essays selected yet.</p>
            {/each}
            <button class="secondary" disabled={busy || workspace.candidates.length < 2} onclick={() => beginGroup()}>
                Add application group
            </button>
            {#if workspace.candidates.length < 2}
                <p class="text-black/50">Set up College prompts on at least two essay tabs first.</p>
            {/if}
        {/if}

        {#if preview}
            <section class="confirmation space-y-3" aria-label="Review confirmation">
                <div>
                    <h3 class="font-medium">What will be sent</h3>
                    <p class="text-black/60">{preview.sendSummary.text}</p>
                </div>
                <ul class="space-y-2">
                    {#each preview.capturedSources as source (source.sourceKey)}
                        <li class="source-preview">
                            <strong class="font-medium">{source.tabLabel} · {source.draftLabel}</strong>
                            <span class="block text-black/50">{source.documentLabel} · {source.sentChars.toLocaleString()} of {source.totalChars.toLocaleString()} characters{source.omittedChars ? ` · ${source.omittedChars.toLocaleString()} omitted` : ""}</span>
                        </li>
                    {/each}
                </ul>
                <p class="text-black/50">Prompts and the application school/cycle are included. Other Library documents, shared notes, and school research are not sent.</p>
                {#if view.canRequest}
                    <div class="flex flex-wrap gap-2">
                        <button class="primary" disabled={busy} onclick={runReview}>{busy ? "Reviewing…" : "Review these essays"}</button>
                        {#if reviewController}<button class="secondary" onclick={stopReview}>Stop</button>{/if}
                        <button class="secondary" disabled={busy} onclick={() => (preview = null)}>Back</button>
                    </div>
                {:else}
                    <p>Connect a model to review this selection. You can still save groups and open related drafts without one.</p>
                    <button class="secondary" onclick={() => college.openPanel("settings")}>AI settings</button>
                {/if}
            </section>
        {/if}

        {#if report}
            {@const currentReport = report}
            <section class="report space-y-4" aria-label="Cross-essay review report">
                <div>
                    <h3 class="font-medium">Cross-essay review</h3>
                    <p class="text-black/50">{currentReport.providerLabel} · {new Date(currentReport.createdAt).toLocaleDateString()}</p>
                </div>
                <div class="space-y-2">
                    <h4 class="font-medium">Repeated stories</h4>
                    {#each currentReport.repeatedStories as finding}
                        <article class="finding"><p>{finding.summary}</p>{#each finding.citations as citation}<button class="citation" onclick={() => openCitation(citation, currentReport)}><span>{sourceLabel(citation.sourceKey, currentReport)}</span><q>{citation.quote}</q></button>{/each}</article>
                    {:else}<p class="text-black/50">No repeated story was supported by the captured passages.</p>{/each}
                </div>
                <div class="space-y-2">
                    <h4 class="font-medium">What each essay adds</h4>
                    {#each currentReport.contributions as finding}
                        <article class="finding"><p>{finding.summary}</p>{#each finding.citations as citation}<button class="citation" onclick={() => openCitation(citation, currentReport)}><span>{sourceLabel(citation.sourceKey, currentReport)}</span><q>{citation.quote}</q></button>{/each}</article>
                    {/each}
                </div>
                <div class="space-y-2">
                    <h4 class="font-medium">Questions to resolve</h4>
                    {#each currentReport.contradictions as finding}
                        <article class="finding"><p>{finding.question}</p>{#each finding.citations as citation}<button class="citation" onclick={() => openCitation(citation, currentReport)}><span>{sourceLabel(citation.sourceKey, currentReport)}</span><q>{citation.quote}</q></button>{/each}</article>
                    {:else}<p class="text-black/50">No contradictory claim was supported by the captured passages.</p>{/each}
                </div>
                {#if currentReport.warnings.length}
                    <details>
                        <summary class="text-black/50">Review limits</summary>
                        <ul class="list-disc space-y-1 pl-4 pt-2 text-black/60">{#each currentReport.warnings as warning}<li>{warning}</li>{/each}</ul>
                    </details>
                {/if}
            </section>
        {/if}
    </div>
</details>

<style>
    label:not(.essay-toggle) { display:flex; flex-direction:column; gap:.35rem; }
    input, select { width:100%; min-width:0; padding:.5rem; border:1px solid rgb(0 0 0 / .15); border-radius:.45rem; background:rgb(255 255 255 / .8); }
    button { cursor:pointer; }
    button:disabled { opacity:.45; cursor:default; }
    .primary { padding:.55rem .7rem; border-radius:.45rem; background:#2563eb; color:white; }
    .secondary { padding:.45rem .65rem; border-radius:.4rem; background:rgb(255 255 255 / .7); }
    .essay-choice, .group-card, .confirmation, .report { padding:.7rem; border-radius:.55rem; background:rgb(255 255 255 / .35); }
    .essay-toggle { display:flex; gap:.6rem; align-items:flex-start; }
    .essay-toggle input { width:auto; margin-top:.15rem; accent-color:#2563eb; }
    .draft-choice { margin:.6rem 0 0 1.55rem; }
    .unavailable { opacity:.7; }
    .member-link { width:100%; text-align:left; padding:.45rem .5rem; border-radius:.4rem; background:rgb(255 255 255 / .45); }
    .member-link:hover:not(:disabled), .secondary:hover:not(:disabled) { background:rgb(255 255 255 / .9); }
    .source-preview, .finding { padding:.6rem; border-radius:.45rem; background:rgb(255 255 255 / .45); }
    .finding { display:flex; flex-direction:column; gap:.45rem; }
    .citation { display:block; width:100%; text-align:left; padding:.5rem; border-left:2px solid rgb(37 99 235 / .45); background:rgb(255 255 255 / .5); }
    .citation span { display:block; color:rgb(0 0 0 / .5); margin-bottom:.2rem; }
    .citation q { display:block; color:rgb(0 0 0 / .75); }
    .citation:hover { background:rgb(255 255 255 / .9); }
    .remove-action { color:#991b1b; }
    .remove-action:hover:not(:disabled) { text-decoration:underline; text-underline-offset:3px; }
    button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline:2px solid #2563eb; outline-offset:2px; }
</style>
