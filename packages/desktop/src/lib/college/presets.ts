// presets.ts — Official, source-linked starting points for College writing setups.

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
        label: "Leadership",
        text: "Describe an example of your leadership experience in which you have positively influenced others, helped resolve disputes or contributed to group efforts over time.",
    },
    {
        label: "Creativity",
        text: "Every person has a creative side, and it can be expressed in many ways: problem solving, original and innovative thinking, and artistically, to name a few. Describe how you express your creative side.",
    },
    {
        label: "Skill",
        text: "What would you say is your greatest talent or skill? How have you developed and demonstrated that talent over time?",
    },
    {
        label: "Education",
        text: "Describe how you have taken advantage of a significant educational opportunity or worked to overcome an educational barrier you have faced.",
    },
    {
        label: "Challenge",
        text: "Describe the most significant challenge you have faced and the steps you have taken to overcome this challenge. How has this challenge affected your academic achievement?",
    },
    {
        label: "Academic interest",
        text: "Think about an academic subject that inspires you. Describe how you have furthered this interest inside and/or outside of the classroom.",
    },
    {
        label: "Community",
        text: "What have you done to make your school or your community a better place?",
    },
    {
        label: "Additional perspective",
        text: "Beyond what has already been shared in your application, what do you believe makes you a strong candidate for admissions to the University of California?",
    },
] as const;

export const COMMON_APP_PROMPTS = [
    {
        label: "Identity",
        text: "Some students have a background, identity, interest, or talent that is so meaningful they believe their application would be incomplete without it. If this sounds like you, then please share your story.",
    },
    {
        label: "Obstacle",
        text: [
            "The lessons we take from obstacles we encounter can be fundamental to later success.",
            "Recount a time when you faced a challenge, setback, or failure.",
            "How did it affect you, and what did you learn from the experience?",
        ].join(" "),
    },
    {
        label: "Belief",
        text: "Reflect on a time when you questioned or challenged a belief or idea. What prompted your thinking? What was the outcome?",
    },
    {
        label: "Gratitude",
        text: "Reflect on something that someone has done for you that has made you happy or thankful in a surprising way. How has this gratitude affected or motivated you?",
    },
    {
        label: "Growth",
        text: "Discuss an accomplishment, event, or realization that sparked a period of personal growth and a new understanding of yourself or others.",
    },
    {
        label: "Curiosity",
        text: [
            "Describe a topic, idea, or concept you find so engaging that it makes you lose all track of time.",
            "Why does it captivate you? What or who do you turn to when you want to learn more?",
        ].join(" "),
    },
    {
        label: "Open topic",
        text: [
            "Share an essay on any topic of your choice.",
            "It can be one you've already written, one that responds to a different prompt, or one of your own design.",
        ].join(" "),
    },
] as const;

const CHECKED_DATE = "2026-09-11";
const UC_SOURCE_URL =
    "https://admission.universityofcalifornia.edu/how-to-apply/applying-as-a-first-year/personal-insight-questions.html";
const COMMON_WORKSHEET_URL =
    "https://www.commonapp.org/static/ff69a4ea4ce044fe419826e26803aa65/Resource_FY_Essays_ENG_2025.06.25_0.pdf";
const COMMON_CURRENT_URL =
    "https://www.commonapp.org/blog/announcing-2026-2027-common-app-essay-prompts/";

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
    "Consider experiences and interests that reveal who you are beyond grades. Verify the prompt and limit for your application cycle.";
const COMMON_CURRENT_SUMMARY =
    "The official announcement publishes the complete 2026–2027 prompts bundled in this preset. Verify current length limits in the application.";

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
