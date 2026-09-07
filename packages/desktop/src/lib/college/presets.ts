// presets.ts — Source-aware starting points for College writing setups.
//
// Prompt text in this module is deliberately paraphrased. It gives a writer a
// useful place to start while the accepted source snapshots make the boundary
// between editorial guidance and an official requirement visible.

import type { EditorialPreferences } from "$lib/ai/editorialPolicy";
import type { ReaderPersona } from "$lib/readers/presets";
import type { CollegePrompt, CollegeReference, CollegeSetup } from "./model";

export const PRESET_LABELS: Record<CollegeSetup["kind"], string> = {
    "uc-piq": "UC PIQ",
    "common-app": "Personal statement",
    supplemental: "Supplemental",
};

export const UC_PROMPTS = [
    {
        label: "Leadership (summary)",
        text: "Explain how your leadership helped others or a group over time.",
    },
    {
        label: "Creativity (summary)",
        text: "Show how you express creativity.",
    },
    {
        label: "Skill (summary)",
        text: "Trace the development and demonstration of your strongest skill.",
    },
    {
        label: "Education (summary)",
        text: "Explain using an educational opportunity or overcoming an educational barrier.",
    },
    {
        label: "Challenge (summary)",
        text: "Describe your biggest challenge, your response, and its effect on academic achievement.",
    },
    {
        label: "Academic interest (summary)",
        text: "Explain how you pursued an inspiring academic subject.",
    },
    {
        label: "Community (summary)",
        text: "Describe your contribution to improving a community.",
    },
    {
        label: "Additional perspective (summary)",
        text: "Explain what else makes you a strong UC candidate.",
    },
] as const;

export const COMMON_APP_PROMPTS = [
    {
        label: "Identity (summary)",
        text: "Share a defining part of your background, identity, interest, or talent.",
    },
    {
        label: "Obstacle (summary)",
        text: "Reflect on a setback or obstacle, its effect, and what you learned.",
    },
    {
        label: "Belief (summary)",
        text: "Describe questioning an idea or belief, what prompted it, and the outcome.",
    },
    {
        label: "Gratitude (summary)",
        text: "Explore unexpected gratitude, its effect, and how it motivates you.",
    },
    {
        label: "Growth (summary)",
        text: "Describe an experience that led to a new understanding of yourself or others.",
    },
    {
        label: "Curiosity (summary)",
        text: "Explore an idea or interest that captivates you, and how you learn more.",
    },
    {
        label: "Open topic (summary)",
        text: "Choose an existing or custom topic that reveals what matters to you.",
    },
] as const;

const CHECKED_DATE = "2026-09-07";
const UC_SOURCE_URL =
    "https://admission.universityofcalifornia.edu/how-to-apply/applying-as-a-first-year/personal-insight-questions.html";
const COMMON_WORKSHEET_URL =
    "https://www.commonapp.org/static/ff69a4ea4ce044fe419826e26803aa65/Resource_FY_Essays_ENG_2025.06.25_0.pdf";
const COMMON_CURRENT_URL = "https://www.commonapp.org/apply/essay-prompts/";

const DEFAULT_PREFERENCES: EditorialPreferences = {
    stance: "author-first",
    feedbackDensity: "focused",
    voiceLatitude: "preserve",
};

const UC_REQUIREMENT_SUMMARY =
    "First-year applicants answer four of eight questions, with at most 350 words per response. The page does not identify an application cycle.";
const UC_ADVICE_SUMMARY =
    "Choose relevant experiences. Support your points with concrete examples and use your own words.";
const COMMON_WORKSHEET_SUMMARY =
    "Consider experiences and interests that reveal who you are beyond grades. These prompt summaries come from the 2025 worksheet; verify the exact prompt and limit for your cycle.";
const COMMON_CURRENT_SUMMARY =
    "The current page labels its prompts 2026–2027; this preset keeps concise paraphrases of its prompt themes. Verify current length limits in the application.";

function constraint(
    id: string,
    unit: CollegePrompt["constraints"][number]["unit"],
    min: number | null,
    max: number | null,
    detail: string,
): CollegePrompt["constraints"][number] {
    return { id, unit, min, max, detail };
}

function summaryPrompt(
    id: string,
    summary: (typeof UC_PROMPTS)[number] | (typeof COMMON_APP_PROMPTS)[number],
    sourceUrl: string,
    constraints: CollegePrompt["constraints"],
): CollegePrompt {
    return {
        id,
        label: summary.label,
        text: summary.text,
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
        return summaryPrompt("uc-piq-1", UC_PROMPTS[0], UC_SOURCE_URL, [
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
        return summaryPrompt("common-app-identity", COMMON_APP_PROMPTS[0], COMMON_CURRENT_URL, [
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

function referencesFor(kind: CollegeSetup["kind"]): CollegeReference[] {
    if (kind === "uc-piq") {
        return [
            source(
                "uc-piq-requirement",
                "University of California",
                UC_SOURCE_URL,
                "",
                "requirement",
                UC_REQUIREMENT_SUMMARY,
            ),
            source(
                "uc-piq-advice",
                "University of California",
                UC_SOURCE_URL,
                "",
                "official-advice",
                UC_ADVICE_SUMMARY,
            ),
            guidanceReference(kind),
        ];
    }
    if (kind === "common-app") {
        return [
            source(
                "common-app-worksheet-advice",
                "Common App",
                COMMON_WORKSHEET_URL,
                "2025 worksheet; current cycle unverified",
                "official-advice",
                COMMON_WORKSHEET_SUMMARY,
            ),
            source(
                "common-app-current-advice",
                "Common App",
                COMMON_CURRENT_URL,
                "2026–2027",
                "official-advice",
                COMMON_CURRENT_SUMMARY,
            ),
            guidanceReference(kind),
        ];
    }
    return [guidanceReference(kind)];
}

export function newCollegeSetup(kind: CollegeSetup["kind"]): CollegeSetup {
    return {
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
        references: referencesFor(kind),
    };
}
