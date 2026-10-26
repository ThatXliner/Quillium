// bundledGuidanceData.ts — Reviewed official guidance shipped with College presets.
// Dates describe source checks, not application deadlines. Advice is optional,
// and older worksheets do not establish current-cycle requirements.

export const BUNDLED_GUIDANCE_VERSION = "2026-09-12.1";

interface BundledGuidanceEntry {
    key: string;
    kind: "uc-piq" | "common-app";
    promptIndex?: number;
    publisher: string;
    url: string;
    checkedDate: string;
    cycle: string;
    classification: "requirement" | "official-advice" | "editorial-guidance";
    summary: string;
}

const CHECKED_DATE = "2026-09-12";
const UC_URL =
    "https://admission.universityofcalifornia.edu/how-to-apply/applying-as-a-first-year/personal-insight-questions.html";
const UC_WORKSHEET_URL =
    "https://admission.universityofcalifornia.edu/counselors/_files/documents/f25-first-year-piq-english.pdf";
const COMMON_CURRENT_URL =
    "https://www.commonapp.org/blog/announcing-2026-2027-common-app-essay-prompts/";
const COMMON_WORKSHEET_URL =
    "https://www.commonapp.org/static/ff69a4ea4ce044fe419826e26803aa65/Resource_FY_Essays_ENG_2025.06.25_0.pdf";

const UC = {
    kind: "uc-piq",
    publisher: "University of California",
    checkedDate: CHECKED_DATE,
    cycle: "",
    classification: "official-advice",
    url: UC_URL,
} as const;

const COMMON = {
    kind: "common-app",
    publisher: "Common App",
    checkedDate: CHECKED_DATE,
    cycle: "2025 worksheet (not cycle-specific)",
    classification: "official-advice",
    url: COMMON_WORKSHEET_URL,
} as const;

export const BUNDLED_GUIDANCE: readonly BundledGuidanceEntry[] = [
    {
        ...UC,
        key: "uc-requirements",
        classification: "requirement",
        summary:
            "First-year applicants answer four of eight PIQs, each capped at 350 words. The source does not specify an application cycle.",
    },
    {
        ...UC,
        key: "uc-general-advice",
        summary:
            "Every question receives equal consideration. Choose experiences that matter to you; give concrete examples and explain your own contribution. Write in your own words. Feedback from others can help you revise.",
    },
    {
        ...UC,
        key: "uc-leadership",
        promptIndex: 0,
        summary:
            "Leadership can happen at home or through mentoring without a title. Explain your responsibilities, contribution, and what you learned about leading.",
    },
    {
        ...UC,
        key: "uc-creativity",
        promptIndex: 1,
        summary:
            "Creativity includes solving problems. Describe an example, the steps you took, and how creative thinking influences your choices.",
    },
    {
        ...UC,
        key: "uc-skill",
        promptIndex: 2,
        summary:
            "Explain why this skill matters and how you developed and used it. Awards or formal recognition are unnecessary.",
    },
    {
        ...UC,
        key: "uc-education",
        promptIndex: 3,
        url: UC_WORKSHEET_URL,
        summary:
            "An opportunity, a barrier, or both can fit. Explain what you gained or how you responded, adding context to your academic history.",
    },
    {
        ...UC,
        key: "uc-challenge",
        promptIndex: 4,
        url: UC_WORKSHEET_URL,
        summary:
            "Connect the challenge to your high school academic achievement. Describe your response and learning; an ongoing challenge can include what you are doing now.",
    },
    {
        ...UC,
        key: "uc-academic-interest",
        promptIndex: 5,
        url: UC_WORKSHEET_URL,
        summary:
            "Explain what sparks your curiosity and how you pursue it. Subjects beyond traditional core academics count; discuss career connections only when relevant.",
    },
    {
        ...UC,
        key: "uc-community",
        promptIndex: 6,
        url: UC_WORKSHEET_URL,
        summary:
            "Describe the problem, your motivation, actions, and learning. For group efforts, identify your responsibilities. Explain the result in the response; readers cannot follow outside links.",
    },
    {
        ...UC,
        key: "uc-additional-perspective",
        promptIndex: 7,
        url: UC_WORKSHEET_URL,
        summary:
            "Use this answer to clarify or expand on something the application and your other PIQs leave unexplained about you as a student.",
    },
    {
        ...COMMON,
        key: "common-app-current-prompts",
        url: COMMON_CURRENT_URL,
        cycle: "2026–2027",
        classification: "official-advice",
        summary:
            "Common App confirms the same seven personal essay prompts for 2026–2027. This announcement does not specify length limits; check those in the application.",
    },
    {
        ...COMMON,
        key: "common-app-general-advice",
        summary:
            "Help readers learn about you beyond academic results. Consider experiences, relationships, and interests that explain what matters to you.",
    },
    {
        ...COMMON,
        key: "common-app-identity",
        promptIndex: 0,
        summary:
            "Consider family, culture, surroundings, or meaningful interests. Explain what context your application would otherwise lack.",
    },
    {
        ...COMMON,
        key: "common-app-obstacle",
        promptIndex: 1,
        summary:
            "Obstacles may be small or unresolved. Reflect on how you coped, who supported you, and how you grew.",
    },
    {
        ...COMMON,
        key: "common-app-belief",
        promptIndex: 2,
        summary:
            "Consider everyday interactions. Explore whether questioning the idea changed your values or relationships, and what surprised you.",
    },
    {
        ...COMMON,
        key: "common-app-gratitude",
        promptIndex: 3,
        summary:
            "Advice, support, or even criticism can prompt gratitude. Explain the surprise, your feelings, and your response.",
    },
    {
        ...COMMON,
        key: "common-app-growth",
        promptIndex: 4,
        summary:
            "Private achievements and everyday moments can matter. Explain your change and how you might keep growing or share your learning.",
    },
    {
        ...COMMON,
        key: "common-app-curiosity",
        promptIndex: 5,
        summary:
            "Look at how you spend free time and what you create or study. Explore your curiosity's beginnings and what it reveals about you.",
    },
    {
        ...COMMON,
        key: "common-app-open-topic",
        promptIndex: 6,
        summary:
            "Choose something you want to share that reveals your priorities. Ask what new understanding this essay adds to your application.",
    },
];
