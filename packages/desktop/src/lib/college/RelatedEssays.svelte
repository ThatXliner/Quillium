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
    onExpandedChange,
}: {
    college: CollegeCapabilities;
    view: CollegeCapabilitiesSnapshot;
    onExpandedChange: (expanded: boolean) => void;
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
let selectedGroupId = $state("");
const selectedGroup = $derived(
    workspace?.groups.find((entry) => entry.group.id === selectedGroupId),
);
const targetKey = $derived(`${view.documentId ?? ""}:${view.tabId ?? ""}:${view.draftId ?? ""}`);

$effect(() => {
    if (targetKey === previousTarget) return;
    previousTarget = targetKey;
    reviewController?.abort();
    reviewController = null;
    editing = false;
    preview = null;
    report = null;
    selectedGroupId = "";
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
        if (!workspace.groups.some((entry) => entry.group.id === selectedGroupId)) {
            selectedGroupId =
                workspace.currentDraftGroupIds[0] ?? workspace.groups[0]?.group.id ?? "";
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
    school =
        group?.school ??
        (view.setup?.school || (view.setup?.kind === "uc-piq" ? "University of California" : ""));
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
    if (busy || selectedCount() < 2 || !school.trim()) return;
    busy = true;
    error = "";
    try {
        const saved = await college.saveReviewGroup({
            version: 1,
            id: editingId ?? undefined,
            name:
                name.trim() === "Application review" ? school.trim() : name.trim() || school.trim(),
            school: school.trim(),
            cycle: cycle.trim(),
            sources: chosenSources(),
        });
        editing = false;
        editingId = null;
        selectedGroupId = saved.id;
        await loadWorkspace();
        report = null;
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
    report = null;
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
    const controller = new AbortController();
    reviewController = controller;
    try {
        report = await college.runReview(preview.id, controller.signal);
        preview = null;
        await loadWorkspace();
    } catch (cause) {
        if (!controller.signal.aborted) {
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

<details class="related border-t border-black/10 pt-3" ontoggle={(event) => onExpandedChange(event.currentTarget.open)}>
    <summary class="text-xs cursor-pointer font-medium">Related essays</summary>
    <div class="space-y-3 pt-3 text-xs">
        {#if error}<p role="alert" class="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>{/if}
        {#if loading}<p role="status">Loading essays…</p>{/if}

        {#if editing}
            <div class="space-y-3">
                <label>School<input maxlength="200" bind:value={school} placeholder="Which school will read these?" /></label>
                <fieldset class="space-y-1" disabled={busy}>
                    <legend class="mb-2 font-medium">Choose essays <span class="text-black/50">· {selectedCount()} selected</span></legend>
                    {#each choices() as choice (choice.key)}
                        {@const selectedDraft = selectedDrafts[choice.key]}
                        {@const available = choice.candidates.some(schoolMatches)}
                        <div class="essay-choice" class:unavailable={!available}>
                            <label class="essay-toggle">
                                <input type="checkbox" checked={Boolean(selectedDraft)}
                                    disabled={!available && !selectedDraft}
                                    onchange={(event) => toggleEssay(choice, event.currentTarget.checked)} />
                                <span class="min-w-0">
                                    <strong class="font-medium">{choice.tabLabel}</strong>
                                    {#if choice.documentId !== view.documentId}<span class="block text-black/60">{choice.documentLabel}</span>{/if}
                                    {#if !available}<span class="block text-black/60">For another school</span>{/if}
                                </span>
                            </label>
                            {#if selectedDraft && choice.candidates.length > 1}
                                <label class="draft-choice">
                                    Draft
                                    <select value={selectedDraft} onchange={(event) => selectDraft(choice, event.currentTarget.value)}>
                                        {#each choice.candidates as candidate (candidate.draftId)}
                                            <option value={candidate.draftId}>{candidate.draftLabel}</option>
                                        {/each}
                                    </select>
                                </label>
                            {:else if selectedDraft}
                                <span class="draft-caption">{choice.candidates[0]?.draftLabel}</span>
                            {/if}
                        </div>
                    {/each}
                </fieldset>
                <details>
                    <summary class="muted">Name and cycle</summary>
                    <div class="space-y-2 pt-2">
                        <label>Application name<input maxlength="200" bind:value={name} /></label>
                        <label>Cycle<input maxlength="100" bind:value={cycle} placeholder="Optional" /></label>
                    </div>
                </details>
                <div class="actions">
                    <button class="primary" disabled={busy || selectedCount() < 2 || selectedCount() > 8 || !school.trim() || choices().some((choice) => selectedDrafts[choice.key] && !choice.candidates.some(schoolMatches))} onclick={saveGroup}>
                        {busy ? "Saving…" : "Done"}
                    </button>
                    <button class="secondary" disabled={busy} onclick={() => (editing = false)}>Cancel</button>
                </div>
                {#if selectedCount() < 2}<p class="muted">Choose at least two essays.</p>{/if}
                {#if selectedCount() > 8}<p class="muted">Choose up to eight essays.</p>{/if}
            </div>
        {:else if preview}
            <section class="space-y-3" aria-label="Review confirmation">
                <div class="row">
                    <h3 class="font-medium">Review {preview.capturedSources.length} essays together</h3>
                    <button class="text-action" disabled={busy} onclick={() => (preview = null)}>Back</button>
                </div>
                <ul class="space-y-1" aria-label="Drafts to review">
                    {#each preview.capturedSources as source (source.sourceKey)}
                        <li class="row source-preview">
                            <span>{source.tabLabel}<span class="block muted">{source.draftLabel}</span></span>
                            {#if source.omittedChars}<span class="muted">{source.sentChars ? "Shortened" : "Omitted"}</span>{/if}
                        </li>
                    {/each}
                </ul>
                {#if preview.sendSummary.omittedChars}
                    <p class="muted">{preview.sendSummary.omittedSourceCount} of {preview.capturedSources.length} drafts shortened or omitted.</p>
                {/if}
                <details>
                    <summary class="muted">What’s sent?</summary>
                    <div class="space-y-2 pt-2 muted">
                        <p>These drafts, their prompts, and the application school/cycle go to your model. Other documents, shared notes, and school research stay private.</p>
                        {#each preview.capturedSources as source (source.sourceKey)}
                            <p>{source.documentLabel} · {source.tabLabel} · {source.sentChars.toLocaleString()} of {source.totalChars.toLocaleString()} characters</p>
                        {/each}
                    </div>
                </details>
                {#if view.canRequest}
                    <div class="actions">
                        <button class="primary" disabled={busy} onclick={runReview}>{busy ? "Reviewing…" : "Review together"}</button>
                        {#if reviewController}<button class="secondary" onclick={stopReview}>Stop</button>{/if}
                    </div>
                {:else}
                    <button class="primary" onclick={() => college.openPanel("settings")}>Connect a model to review</button>
                {/if}
            </section>
        {:else if !report && workspace}
            {#if workspace.groups.length > 1}
                <select aria-label="Application" bind:value={selectedGroupId}>
                    {#each workspace.groups as entry (entry.group.id)}<option value={entry.group.id}>{entry.group.name}</option>{/each}
                </select>
            {/if}
            {#if selectedGroup}
                {@const entry = selectedGroup}
                <section class="space-y-3" aria-label={entry.group.name}>
                    <div class="row">
                        <h3 class="font-medium">{entry.group.name}</h3>
                        <button class="text-action" disabled={busy} onclick={() => beginGroup(entry.group)}>Change</button>
                    </div>
                    <ul class="space-y-1" aria-label="Selected essays">
                        {#each entry.members as member (member.sourceKey)}
                            <li>
                                <button class="member-link" disabled={member.state === "missing" || member.state === "trashed"} onclick={() => openMember(member)}>
                                    <span>{member.tabLabel}</span>
                                    <span class="block muted">{member.draftLabel}{member.sourceRef.draftId === view.draftId ? " · Current" : ""}{member.state === "trashed" ? " · In Trash" : member.state === "missing" ? " · Missing" : ""}</span>
                                    {#if member.sourceRef.documentId !== view.documentId}<span class="block muted">{member.documentLabel}</span>{/if}
                                </button>
                            </li>
                        {/each}
                    </ul>
                    <button class="primary" disabled={busy || entry.members.some((member) => member.state !== "live" && member.state !== "changed-draft")} onclick={() => prepare(entry.group)}>
                        {busy ? "Preparing…" : "Review together"}
                    </button>
                    <details>
                        <summary class="muted">More</summary>
                        <div class="space-y-2 pt-2">
                            {#if entry.group.latestReport}<button class="text-action" onclick={() => (report = entry.group.latestReport ?? null)}>Last review</button>{/if}
                            <button class="text-action" disabled={busy} onclick={() => beginGroup()}>New application</button>
                            {#if removingGroupId === entry.group.id}
                                <p>Remove this selection and its review?</p>
                                <div class="actions">
                                    <button class="secondary" onclick={() => (removingGroupId = null)}>Cancel</button>
                                    <button class="remove-action" disabled={busy} onclick={() => removeGroup(entry.group)}>Remove</button>
                                </div>
                            {:else}
                                <button class="remove-action" disabled={busy} onclick={() => (removingGroupId = entry.group.id)}>Remove selection…</button>
                            {/if}
                        </div>
                    </details>
                </section>
            {:else}
                <p class="muted">See what your essays add together.</p>
                <button class="primary" disabled={busy || choices().length < 2} onclick={() => beginGroup()}>Choose essays</button>
                {#if choices().length < 2}<p class="muted">Add a College prompt to another tab first.</p>{/if}
            {/if}
        {/if}

        {#if report && !editing && !preview}
            {@const currentReport = report}
            <section class="report space-y-4" aria-label="Cross-essay review report">
                <div>
                    <div class="row"><h3 class="font-medium">Your essays together</h3><button class="text-action" onclick={() => (report = null)}>Back</button></div>
                    <p class="text-black/50">{currentReport.providerLabel} · {new Date(currentReport.createdAt).toLocaleDateString()}</p>
                </div>
                <div class="space-y-2">
                    <h4 class="font-medium">Repeated stories</h4>
                    {#each currentReport.repeatedStories as finding}
                        <article class="finding"><p>{finding.summary}</p><details><summary class="muted">Passages</summary>{#each finding.citations as citation}<button class="citation" onclick={() => openCitation(citation, currentReport)}><span>{sourceLabel(citation.sourceKey, currentReport)}</span><q>{citation.quote}</q></button>{/each}</details></article>
                    {:else}<p class="text-black/50">No repeated stories found.</p>{/each}
                </div>
                <div class="space-y-2">
                    <h4 class="font-medium">What each essay adds</h4>
                    {#each currentReport.contributions as finding}
                        <article class="finding"><p>{finding.summary}</p><details><summary class="muted">Passages</summary>{#each finding.citations as citation}<button class="citation" onclick={() => openCitation(citation, currentReport)}><span>{sourceLabel(citation.sourceKey, currentReport)}</span><q>{citation.quote}</q></button>{/each}</details></article>
                    {/each}
                </div>
                <div class="space-y-2">
                    <h4 class="font-medium">Questions to resolve</h4>
                    {#each currentReport.contradictions as finding}
                        <article class="finding"><p>{finding.question}</p><details><summary class="muted">Passages</summary>{#each finding.citations as citation}<button class="citation" onclick={() => openCitation(citation, currentReport)}><span>{sourceLabel(citation.sourceKey, currentReport)}</span><q>{citation.quote}</q></button>{/each}</details></article>
                    {:else}<p class="text-black/50">No contradictions found.</p>{/each}
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
    .essay-choice { padding:.65rem; border-radius:.55rem; background:rgb(255 255 255 / .35); }
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
    .row { display:flex; align-items:center; justify-content:space-between; gap:.6rem; }
    .actions { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; }
    .muted { color:rgb(0 0 0 / .6); }
    .text-action { color:rgb(0 0 0 / .65); text-align:left; display:block; padding:.25rem 0; }
    .text-action:hover { color:#2563eb; }
    .draft-caption { display:block; margin-left:1.55rem; color:rgb(0 0 0 / .6); }
    .related { overflow-wrap:anywhere; }
    summary { cursor:pointer; }
    .remove-action { color:#991b1b; }
    .remove-action:hover:not(:disabled) { text-decoration:underline; text-underline-offset:3px; }
    button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline:2px solid #2563eb; outline-offset:2px; }
</style>
