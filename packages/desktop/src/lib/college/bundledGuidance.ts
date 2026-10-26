// bundledGuidance.ts — Local guidance snapshots and explicit update previews.

import { BUNDLED_GUIDANCE, BUNDLED_GUIDANCE_VERSION } from "./bundledGuidanceData";
import type { CollegeReference, CollegeSetup } from "./model";
import { COMMON_APP_PROMPTS, UC_PROMPTS } from "./promptCatalog";
import {
    collegeResearchPromptKey,
    isCollegeReferenceCurrent,
    researchFingerprint,
} from "./researchModel";

function normalized(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Match official wording, never labels or IDs that a writer may reuse. */
export function bundledReferencesFor(setup: CollegeSetup): CollegeReference[] {
    if (setup.kind === "supplemental") return [];
    const catalog = setup.kind === "uc-piq" ? UC_PROMPTS : COMMON_APP_PROMPTS;
    return setup.prompts.flatMap((prompt) => {
        const promptIndex = catalog.findIndex(
            (candidate) => normalized(candidate.text) === normalized(prompt.text),
        );
        if (promptIndex < 0) return [];
        const promptKey = collegeResearchPromptKey(setup, prompt);
        return BUNDLED_GUIDANCE.filter(
            (entry) =>
                entry.kind === setup.kind &&
                (entry.promptIndex === undefined || entry.promptIndex === promptIndex),
        ).map((entry) => ({
            id: `bundle-${researchFingerprint(`${entry.key}:${prompt.id}:${promptKey}`)}`,
            publisher: entry.publisher,
            url: entry.url,
            checkedDate: entry.checkedDate,
            cycle: entry.cycle,
            kind: entry.classification,
            summary: entry.summary,
            bundle: {
                version: BUNDLED_GUIDANCE_VERSION,
                key: entry.key,
                promptIds: [prompt.id],
                promptKeys: { [prompt.id]: promptKey },
            },
        }));
    });
}

export type BundledGuidancePreview = {
    added: CollegeReference[];
    changed: { previous: CollegeReference; next: CollegeReference }[];
    removed: CollegeReference[];
    references: CollegeReference[];
};

/** Reading this preview never mutates accepted or detached snapshots. */
export function previewBundledGuidance(setup: CollegeSetup): BundledGuidancePreview {
    const candidates = bundledReferencesFor(setup);
    const available = new Map(candidates.map((reference) => [reference.id, reference]));
    const added: CollegeReference[] = [];
    const changed: BundledGuidancePreview["changed"] = [];
    const removed: CollegeReference[] = [];
    const references: CollegeReference[] = [];
    for (const previous of setup.references) {
        if (!previous.bundle || !isCollegeReferenceCurrent(previous, setup)) {
            references.push(previous);
            continue;
        }
        const next = available.get(previous.id);
        if (!next) {
            removed.push(previous);
            continue;
        }
        available.delete(previous.id);
        if (JSON.stringify(previous) !== JSON.stringify(next)) changed.push({ previous, next });
        references.push(next);
    }
    for (const next of available.values()) {
        // An unrelated manually saved reference may happen to use the same ID.
        if (references.some((reference) => reference.id === next.id)) continue;
        added.push(next);
        references.push(next);
    }
    return JSON.parse(
        JSON.stringify({ added, changed, removed, references }),
    ) as BundledGuidancePreview;
}
