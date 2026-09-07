// review.ts — Local source discovery, capture, budgeting, and stale checks.
//
// This module deliberately reads prose only for the exact drafts selected by a
// review group. Candidate discovery is metadata-only, and every captured
// source records a fingerprint of the complete text before its transmitted
// prefix is bounded for the provider.

import {
    getCollegeTabSetup,
    listDocumentStructure,
    listDocuments,
    listTabDrafts,
    listTabs,
    listTrashedDocuments,
    loadDocumentState,
} from "$lib/db";
import type { DocumentMeta, DraftMeta, TabMeta } from "$lib/db/types";
import { getExtensions } from "$lib/editor/extensions";
import { reconstructState } from "$lib/editor/replay";
import { type CollegeSetup, cloneCollegeSetup, parseCollegeSetup } from "./model";
import { researchFingerprint } from "./researchModel";
import {
    type CapturedReviewSource,
    type CollegeReviewGroup,
    type CollegeReviewSourceRef,
    capturedSourceMetadata,
    cloneCollegeReviewGroup,
    collegeReviewGroupSchema,
    collegeReviewSourceRefSchema,
    reviewGroupFingerprint,
    reviewSourceKey,
} from "./reviewModel";

export const REVIEW_SOURCE_CHAR_LIMIT = 12_000;
export const REVIEW_TOTAL_CHAR_LIMIT = 36_000;

/** A metadata-only candidate; it contains no draft prose or preview text. */
export type CollegeEssayCandidate = CollegeReviewSourceRef & {
    sourceRef: CollegeReviewSourceRef;
    sourceKey: string;
    documentLabel: string;
    tabLabel: string;
    draftLabel: string;
    promptLabel: string;
    promptText: string;
    setupSchool: string;
    setupCycle: string;
    setupProgram: string;
    setup: CollegeSetup;
};

/** Exact current prose supplied by the editor for an unsaved active draft. */
export type ActiveReviewSourceOverride =
    | { sourceRef: CollegeReviewSourceRef; documentContent: string }
    | (CollegeReviewSourceRef & { documentContent: string })
    | { ref: CollegeReviewSourceRef; documentContent: string };

export type CrossEssayReviewSendSummary = {
    sourceCount: number;
    transmittedSourceCount: number;
    omittedSourceCount: number;
    totalChars: number;
    sentChars: number;
    omittedChars: number;
    text: string;
};

export type CrossEssayReviewPreview = {
    id: string;
    group: CollegeReviewGroup;
    groupFingerprint: string;
    capturedSources: readonly CapturedReviewSource[];
    sendSummary: CrossEssayReviewSendSummary;
};

export type ReviewFingerprintSnapshot = {
    groupFingerprint: string;
    sourceFingerprints: Readonly<Record<string, string>>;
};

export type ReviewMemberState = "live" | "changed-draft" | "trashed" | "missing";

export type CollegeReviewWorkspaceMember = {
    sourceRef: CollegeReviewSourceRef;
    sourceKey: string;
    state: ReviewMemberState;
    documentLabel: string;
    tabLabel: string;
    draftLabel: string;
    promptLabel: string;
    promptText: string;
    setupSchool: string;
    setupCycle: string;
};

export type CollegeReviewWorkspaceGroup = {
    group: CollegeReviewGroup;
    members: CollegeReviewWorkspaceMember[];
};

export type CollegeReviewWorkspace = {
    groups: CollegeReviewWorkspaceGroup[];
    candidates: CollegeEssayCandidate[];
    currentDraftGroupIds: string[];
    warnings: string[];
};

function uuid(): string {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes]
        .map((byte, index) =>
            [4, 6, 8, 10].includes(index)
                ? `-${byte.toString(16).padStart(2, "0")}`
                : byte.toString(16).padStart(2, "0"),
        )
        .join("");
}

function sourceRefKey(ref: CollegeReviewSourceRef): string {
    return `${ref.documentId}\u0000${ref.tabId}\u0000${ref.draftId}`;
}

function label(value: string, fallback: string): string {
    const trimmed = value.trim();
    return trimmed || fallback;
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
    if (typeof value !== "object" || value === null || seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
    return Object.freeze(value);
}

function parsedSetup(raw: string): CollegeSetup | null {
    try {
        return cloneCollegeSetup(parseCollegeSetup(raw));
    } catch {
        // A malformed/future setup is unavailable to review until the writer
        // explicitly repairs it; it is not safe to guess its prompt metadata.
        return null;
    }
}

function candidateFromMetadata(
    document: DocumentMeta,
    tab: TabMeta,
    draft: DraftMeta,
    setup: CollegeSetup,
): CollegeEssayCandidate | null {
    const prompt = setup.prompts[0];
    if (!prompt) return null;
    const sourceRef = {
        documentId: document.id,
        tabId: tab.id,
        draftId: draft.id,
    } satisfies CollegeReviewSourceRef;
    return {
        ...sourceRef,
        sourceRef,
        sourceKey: reviewSourceKey(sourceRef),
        documentLabel: label(document.title, document.id),
        tabLabel: label(tab.label, tab.id),
        draftLabel: label(draft.label, draft.id),
        promptLabel: prompt.label,
        promptText: prompt.text,
        setupSchool: setup.school,
        setupCycle: setup.cycle,
        setupProgram: setup.program,
        setup,
    };
}

/**
 * Enumerate live College-configured drafts using metadata and setup JSON only.
 * In particular, this function never calls `loadDocumentState` or reads the
 * reactive editor content store.
 */
export async function listCollegeEssayCandidates(): Promise<CollegeEssayCandidate[]> {
    const documents = await listDocuments();
    const candidates: CollegeEssayCandidate[] = [];
    for (const document of documents) {
        const tabs = await listTabs(document.id);
        for (const tab of tabs) {
            const rawSetup = await getCollegeTabSetup(document.id, tab.id);
            if (rawSetup === null) continue;
            const setup = parsedSetup(rawSetup);
            if (!setup) continue;
            const drafts = await listTabDrafts(tab.id);
            for (const draft of drafts) {
                const candidate = candidateFromMetadata(document, tab, draft, setup);
                if (candidate) candidates.push(candidate);
            }
        }
    }
    return candidates;
}

function normalizeOverride(
    override: ActiveReviewSourceOverride | undefined,
): { sourceRef: CollegeReviewSourceRef; documentContent: string } | null {
    if (!override) return null;
    const value = override as {
        sourceRef?: unknown;
        ref?: unknown;
        documentId?: unknown;
        tabId?: unknown;
        draftId?: unknown;
        documentContent?: unknown;
    };
    const sourceRef =
        value.sourceRef ??
        value.ref ??
        (typeof value.documentId === "string" &&
        typeof value.tabId === "string" &&
        typeof value.draftId === "string"
            ? {
                  documentId: value.documentId,
                  tabId: value.tabId,
                  draftId: value.draftId,
              }
            : null);
    if (!sourceRef || typeof value.documentContent !== "string") {
        throw new Error("The active review source override is invalid.");
    }
    const parsedRef = collegeReviewSourceRefSchema.parse(sourceRef);
    return { sourceRef: parsedRef, documentContent: value.documentContent };
}

async function loadPersistedContent(candidate: CollegeEssayCandidate): Promise<string> {
    const loaded = await loadDocumentState(candidate.documentId, candidate.draftId);
    const state = reconstructState(
        loaded.snapshotStateJson,
        loaded.eventsSince,
        getExtensions({ persist: false, history: false }),
    );
    return state.doc.toString();
}

function contentFingerprint(content: string): string {
    return researchFingerprint(content);
}

async function captureCandidate(
    candidate: CollegeEssayCandidate,
    override: { sourceRef: CollegeReviewSourceRef; documentContent: string } | null,
    remaining: { value: number },
): Promise<CapturedReviewSource> {
    const fullContent =
        override && sourceRefKey(override.sourceRef) === sourceRefKey(candidate.sourceRef)
            ? override.documentContent
            : await loadPersistedContent(candidate);
    if (fullContent.trim().length === 0) {
        throw new Error(`The selected source “${candidate.draftLabel}” is empty.`);
    }
    const sentChars = Math.max(
        0,
        Math.min(REVIEW_SOURCE_CHAR_LIMIT, remaining.value, fullContent.length),
    );
    const sentContent = fullContent.slice(0, sentChars);
    const totalChars = fullContent.length;
    const omittedChars = totalChars - sentChars;
    remaining.value -= sentChars;
    return {
        sourceKey: candidate.sourceKey,
        documentId: candidate.documentId,
        tabId: candidate.tabId,
        draftId: candidate.draftId,
        documentLabel: candidate.documentLabel,
        tabLabel: candidate.tabLabel,
        draftLabel: candidate.draftLabel,
        promptLabel: candidate.promptLabel,
        promptText: candidate.promptText,
        setupSchool: candidate.setupSchool,
        setupCycle: candidate.setupCycle,
        contentFingerprint: contentFingerprint(fullContent),
        totalChars,
        sentChars,
        omittedChars,
        sentContent,
    };
}

function sendSummaryFor(
    capturedSources: readonly CapturedReviewSource[],
): CrossEssayReviewSendSummary {
    const totalChars = capturedSources.reduce((sum, source) => sum + source.totalChars, 0);
    const sentChars = capturedSources.reduce((sum, source) => sum + source.sentChars, 0);
    const omittedChars = capturedSources.reduce((sum, source) => sum + source.omittedChars, 0);
    const transmittedSourceCount = capturedSources.filter((source) => source.sentChars > 0).length;
    const omittedSourceCount = capturedSources.filter((source) => source.omittedChars > 0).length;
    const text = `${transmittedSourceCount} of ${capturedSources.length} sources transmitted; ${sentChars.toLocaleString()} of ${totalChars.toLocaleString()} characters sent${omittedChars > 0 ? `; ${omittedChars.toLocaleString()} omitted from the suffix.` : "."}`;
    return {
        sourceCount: capturedSources.length,
        transmittedSourceCount,
        omittedSourceCount,
        totalChars,
        sentChars,
        omittedChars,
        text,
    };
}

function ensureGroup(group: CollegeReviewGroup): CollegeReviewGroup {
    const parsed = collegeReviewGroupSchema.safeParse(group);
    if (!parsed.success) {
        throw new Error(
            `The review group is invalid: ${parsed.error.issues[0]?.message ?? "check its fields"}.`,
        );
    }
    return cloneCollegeReviewGroup(parsed.data);
}

function findCandidate(
    candidates: readonly CollegeEssayCandidate[],
    sourceRef: CollegeReviewSourceRef,
): CollegeEssayCandidate {
    const candidate = candidates.find(
        (entry) => sourceRefKey(entry.sourceRef) === sourceRefKey(sourceRef),
    );
    if (!candidate) {
        throw new Error("A selected College essay source is no longer live or configured.");
    }
    return candidate;
}

function assertSchoolMatches(group: CollegeReviewGroup, candidate: CollegeEssayCandidate): void {
    if (
        candidate.setupSchool.trim() !== "" &&
        candidate.setupSchool.trim().toLocaleLowerCase() !== group.school.trim().toLocaleLowerCase()
    ) {
        throw new Error(
            `The source “${candidate.draftLabel}” belongs to a different school. Update the group or setup first.`,
        );
    }
}

/** Capture the selected live drafts in group order under the fixed budgets. */
export async function prepareCrossEssayReview(
    inputGroup: CollegeReviewGroup,
    activeOverride?: ActiveReviewSourceOverride,
): Promise<CrossEssayReviewPreview> {
    const group = ensureGroup(inputGroup);
    const override = normalizeOverride(activeOverride);
    if (
        override &&
        !group.sources.some((source) => sourceRefKey(source) === sourceRefKey(override.sourceRef))
    ) {
        throw new Error("The active review source is not a member of this review group.");
    }
    const candidates = await listCollegeEssayCandidates();
    const remaining = { value: REVIEW_TOTAL_CHAR_LIMIT };
    const capturedSources: CapturedReviewSource[] = [];
    for (const sourceRef of group.sources) {
        const candidate = findCandidate(candidates, sourceRef);
        assertSchoolMatches(group, candidate);
        capturedSources.push(await captureCandidate(candidate, override, remaining));
    }
    const preview: CrossEssayReviewPreview = {
        id: uuid(),
        group,
        groupFingerprint: reviewGroupFingerprint(group),
        capturedSources,
        sendSummary: sendSummaryFor(capturedSources),
    };
    return deepFreeze(preview);
}

async function fingerprintSources(
    preview: CrossEssayReviewPreview,
    activeOverride?: ActiveReviewSourceOverride,
): Promise<ReviewFingerprintSnapshot> {
    const group = ensureGroup(preview.group);
    if (reviewGroupFingerprint(group) !== preview.groupFingerprint) {
        throw new Error("This cross-essay review is stale because its group changed.");
    }
    const override = normalizeOverride(activeOverride);
    const candidates = await listCollegeEssayCandidates();
    const sourceFingerprints: Record<string, string> = {};
    for (const captured of preview.capturedSources) {
        const sourceRef = {
            documentId: captured.documentId,
            tabId: captured.tabId,
            draftId: captured.draftId,
        } satisfies CollegeReviewSourceRef;
        const expected = group.sources.find(
            (source) => sourceRefKey(source) === sourceRefKey(sourceRef),
        );
        if (!expected || captured.sourceKey !== reviewSourceKey(sourceRef)) {
            throw new Error("This cross-essay review is stale because a source identity changed.");
        }
        const candidate = findCandidate(candidates, expected);
        assertSchoolMatches(group, candidate);
        const fullContent =
            override && sourceRefKey(override.sourceRef) === sourceRefKey(sourceRef)
                ? override.documentContent
                : await loadPersistedContent(candidate);
        if (fullContent.trim().length === 0)
            throw new Error("A selected review source is now empty.");
        sourceFingerprints[captured.sourceKey] = contentFingerprint(fullContent);
    }
    if (Object.keys(sourceFingerprints).length !== preview.capturedSources.length) {
        throw new Error("This cross-essay review is stale because a selected source is missing.");
    }
    return { groupFingerprint: preview.groupFingerprint, sourceFingerprints };
}

/** Reload exact source state and prove the group and full prose are unchanged. */
export async function reloadReviewFingerprints(
    preview: CrossEssayReviewPreview,
    activeOverride?: ActiveReviewSourceOverride,
): Promise<ReviewFingerprintSnapshot> {
    return fingerprintSources(preview, activeOverride);
}

/** Throw a clear stale error if any selected source or group changed. */
export async function validateCrossEssayReviewPreview(
    preview: CrossEssayReviewPreview,
    activeOverride?: ActiveReviewSourceOverride,
): Promise<void> {
    const current = await fingerprintSources(preview, activeOverride);
    for (const captured of preview.capturedSources) {
        if (current.sourceFingerprints[captured.sourceKey] !== captured.contentFingerprint) {
            throw new Error(
                `This cross-essay review is stale because “${captured.draftLabel}” changed. Prepare it again.`,
            );
        }
    }
}

/** Compatibility alias used by capability consumers. */
export const validateReviewPreview = validateCrossEssayReviewPreview;

/** Return a stable full-content fingerprint for a source string. */
export function fingerprintReviewContent(content: string): string {
    return contentFingerprint(content);
}

function memberFromCandidate(
    candidate: CollegeEssayCandidate,
    state: ReviewMemberState,
): CollegeReviewWorkspaceMember {
    return {
        sourceRef: clone(candidate.sourceRef),
        sourceKey: candidate.sourceKey,
        state,
        documentLabel: candidate.documentLabel,
        tabLabel: candidate.tabLabel,
        draftLabel: candidate.draftLabel,
        promptLabel: candidate.promptLabel,
        promptText: candidate.promptText,
        setupSchool: candidate.setupSchool,
        setupCycle: candidate.setupCycle,
    };
}

/**
 * Resolve global saved groups against current local metadata. Missing and
 * soft-deleted identities are retained in the result so the UI can explain
 * why a group cannot currently run.
 */
export async function resolveCollegeReviewWorkspace(
    groups: readonly CollegeReviewGroup[],
    currentDraftId?: string | null,
): Promise<CollegeReviewWorkspace> {
    const candidates = await listCollegeEssayCandidates();
    const candidateByRef = new Map(
        candidates.map((candidate) => [sourceRefKey(candidate.sourceRef), candidate]),
    );
    const availableDocuments = await listDocuments();
    const documentIds = new Set(availableDocuments.map((document) => document.id));
    let trashedDocuments: DocumentMeta[] = [];
    try {
        trashedDocuments = await listTrashedDocuments();
    } catch {
        // Older host mocks/embedders may not expose trash enumeration; those
        // identities remain distinguishable as missing below.
    }
    const trashedDocumentById = new Map(
        trashedDocuments.map((document) => [document.id, document]),
    );
    const structures = new Map<string, Awaited<ReturnType<typeof listDocumentStructure>>>();
    const warnings: string[] = [];
    const groupsWithMembers: CollegeReviewWorkspaceGroup[] = [];
    for (const rawGroup of groups) {
        const group = ensureGroup(rawGroup);
        const members: CollegeReviewWorkspaceMember[] = [];
        for (const sourceRef of group.sources) {
            const key = sourceRefKey(sourceRef);
            const candidate = candidateByRef.get(key);
            if (candidate) {
                let state: ReviewMemberState = "live";
                const prior = group.latestReport?.capturedSources.find(
                    (captured) => captured.sourceKey === candidate.sourceKey,
                );
                if (prior) {
                    try {
                        const current = await loadPersistedContent(candidate);
                        if (contentFingerprint(current) !== prior.contentFingerprint) {
                            state = "changed-draft";
                        }
                    } catch {
                        warnings.push(
                            `Could not compare the saved draft “${candidate.draftLabel}”.`,
                        );
                    }
                }
                members.push(memberFromCandidate(candidate, state));
                continue;
            }

            if (!documentIds.has(sourceRef.documentId)) {
                const trashed = trashedDocumentById.get(sourceRef.documentId);
                members.push({
                    sourceRef: clone(sourceRef),
                    sourceKey: reviewSourceKey(sourceRef),
                    state: trashed ? "trashed" : "missing",
                    documentLabel: trashed?.title ?? "Missing document",
                    tabLabel: "Missing tab",
                    draftLabel: "Missing draft",
                    promptLabel: "",
                    promptText: "",
                    setupSchool: "",
                    setupCycle: "",
                });
                continue;
            }

            let structure = structures.get(sourceRef.documentId);
            if (!structure) {
                try {
                    structure = await listDocumentStructure(sourceRef.documentId);
                    structures.set(sourceRef.documentId, structure);
                } catch {
                    warnings.push(
                        `Could not resolve the structure for document ${sourceRef.documentId}.`,
                    );
                }
            }
            const draft = structure?.drafts.find((entry) => entry.id === sourceRef.draftId);
            // DocumentStructure includes soft-deleted rows. A retained draft
            // proves the identity was trashed; a missing draft is no longer
            // recoverable even when its former tab still exists.
            const tab = structure?.tabs.find((entry) => entry.id === sourceRef.tabId);
            const state: ReviewMemberState = draft ? "trashed" : "missing";
            members.push({
                sourceRef: clone(sourceRef),
                sourceKey: reviewSourceKey(sourceRef),
                state,
                documentLabel:
                    availableDocuments.find((doc) => doc.id === sourceRef.documentId)?.title ??
                    sourceRef.documentId,
                tabLabel: tab?.label ?? "Missing tab",
                draftLabel: draft?.label ?? "Missing draft",
                promptLabel: "",
                promptText: "",
                setupSchool: "",
                setupCycle: "",
            });
        }
        groupsWithMembers.push({ group, members });
    }
    return {
        groups: groupsWithMembers,
        candidates,
        currentDraftGroupIds: currentDraftId
            ? groupsWithMembers
                  .filter((entry) =>
                      entry.group.sources.some((source) => source.draftId === currentDraftId),
                  )
                  .map((entry) => entry.group.id)
            : [],
        warnings,
    };
}

/** Convert report metadata into the only source shape accepted for storage. */
export function capturedMetadataForReport(source: CapturedReviewSource) {
    return capturedSourceMetadata(source);
}
