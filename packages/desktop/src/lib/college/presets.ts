// presets.ts — Official, source-linked starting points for College writing setups.

import type { EditorialPreferences } from "$lib/ai/editorialPolicy";
import type { ReaderPersona } from "$lib/readers/presets";
import { bundledReferencesFor } from "./bundledGuidance";
import type { CollegePrompt, CollegeReference, CollegeSetup } from "./model";
import { COMMON_APP_PROMPTS, UC_PROMPTS } from "./promptCatalog";

export const PRESET_LABELS: Record<CollegeSetup["kind"], string> = {
    "uc-piq": "UC PIQ",
    "common-app": "Personal statement",
    supplemental: "Supplemental",
};

export { COMMON_APP_PROMPTS, UC_PROMPTS } from "./promptCatalog";

const CHECKED_DATE = "2026-09-11";
const UC_SOURCE_URL =
    "https://admission.universityofcalifornia.edu/how-to-apply/applying-as-a-first-year/personal-insight-questions.html";
const COMMON_CURRENT_URL =
    "https://www.commonapp.org/blog/announcing-2026-2027-common-app-essay-prompts/";

const DEFAULT_PREFERENCES: EditorialPreferences = {
    stance: "author-first",
    feedbackDensity: "focused",
    voiceLatitude: "preserve",
};

function constraint(
    id: string,
    unit: CollegePrompt["constraints"][number]["unit"],
    min: number | null,
    max: number | null,
    detail: string,
): CollegePrompt["constraints"][number] {
    return { id, unit, min, max, detail };
}

function officialPrompt(
    id: string,
    prompt: (typeof UC_PROMPTS)[number] | (typeof COMMON_APP_PROMPTS)[number],
    sourceUrl: string,
    constraints: CollegePrompt["constraints"],
): CollegePrompt {
    return {
        id,
        label: prompt.label,
        text: prompt.text,
        sourceUrl,
        constraints,
    };
}

function source(
    id: string,
    publisher: string,
    url: string,
    cycle: string,
    kind: CollegeReference["kind"],
    summary: string,
): CollegeReference {
    return { id, publisher, url, checkedDate: CHECKED_DATE, cycle, kind, summary };
}

function guidanceReference(kind: CollegeSetup["kind"]): CollegeReference {
    const summaryByKind: Record<CollegeSetup["kind"], string> = {
        "uc-piq":
            "Quillium editorial guidance for UC-style responses: diagnose the writer's evidence and reflection without predicting an admissions outcome.",
        "common-app":
            "Quillium editorial guidance for Common App-style responses: diagnose the writer's evidence and reflection without predicting an admissions outcome.",
        supplemental:
            "Quillium editorial guidance for a school-specific supplemental response: verify the school's prompt and limits, then diagnose evidence and reflection without predicting an admissions outcome.",
    };
    return source(
        `quillium-guidance-${kind}`,
        "Quillium",
        "",
        "",
        "editorial-guidance",
        summaryByKind[kind],
    );
}

const COLLEGE_READERS: readonly ReaderPersona[] = [
    {
        id: "college-prompt-fit",
        name: "Prompt fit",
        emoji: "🎯",
        color: "#2563eb",
        description: "Checks whether the response addresses the actual prompt.",
        instruction:
            "Diagnose whether the draft answers the actual prompt. Ask for evidence from the writer's draft or experience, never invent experiences, and preserve the writer's language.",
        builtin: true,
        enabled: true,
        chattiness: "quiet",
    },
    {
        id: "college-specificity",
        name: "Specificity and reflection",
        emoji: "🔎",
        color: "#7c3aed",
        description: "Finds places where concrete evidence or reflection would help.",
        instruction:
            "Diagnose where the draft needs concrete evidence or reflection. Ask questions that help the writer supply their own details, never invent experiences, and preserve the writer's language.",
        builtin: true,
        enabled: false,
        chattiness: "quiet",
    },
    {
        id: "college-voice",
        name: "Voice",
        emoji: "✍️",
        color: "#db2777",
        description: "Protects the writer's distinctive language and perspective.",
        instruction:
            "Diagnose where the draft's voice or perspective becomes generic. Ask for the writer's own evidence, never invent experiences, and preserve the writer's language.",
        builtin: true,
        enabled: false,
        chattiness: "quiet",
    },
];

function cloneReaders(): ReaderPersona[] {
    return COLLEGE_READERS.map((reader) => ({
        ...reader,
        profile: reader.profile
            ? {
                  ...reader.profile,
                  goodFor: [...reader.profile.goodFor],
              }
            : undefined,
    }));
}

export function newCollegePrompt(): CollegePrompt {
    return {
        id: `college-prompt-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
        label: "Supplemental prompt",
        text: "",
        sourceUrl: "",
        constraints: [
            constraint(
                "length",
                "other",
                null,
                null,
                "No limit recorded; verify the school's current application source.",
            ),
        ],
    };
}

function presetPrompt(kind: CollegeSetup["kind"]): CollegePrompt {
    if (kind === "uc-piq") {
        return officialPrompt("uc-piq-1", UC_PROMPTS[0], UC_SOURCE_URL, [
            constraint(
                "word-limit",
                "words",
                null,
                350,
                "At most 350 words; verify the current cycle.",
            ),
        ]);
    }
    if (kind === "common-app") {
        return officialPrompt("common-app-identity", COMMON_APP_PROMPTS[0], COMMON_CURRENT_URL, [
            constraint(
                "word-limit",
                "words",
                null,
                null,
                "Length unknown in the current source snapshot; verify your cycle.",
            ),
        ]);
    }
    return newCollegePrompt();
}

export function newCollegeSetup(kind: CollegeSetup["kind"]): CollegeSetup {
    const setup: CollegeSetup = {
        version: 1,
        presetVersion: 1,
        kind,
        cycle: kind === "common-app" ? "2026–2027" : "",
        school: "",
        program: "",
        intent: "",
        feedbackFocus: "",
        prompts: [presetPrompt(kind)],
        preferences: { ...DEFAULT_PREFERENCES },
        readers: cloneReaders(),
        feedbackReaders: false,
        reviseReaders: false,
        active: true,
        references: kind === "supplemental" ? [guidanceReference(kind)] : [],
    };
    setup.references.push(...bundledReferencesFor(setup));
    return setup;
}
