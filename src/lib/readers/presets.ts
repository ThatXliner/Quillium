export type Chattiness = "quiet" | "normal" | "verbose";

/** Structured profile data for builtin persona expanded cards. */
export type PersonaProfile = {
    /** Longer personality blurb. */
    about: string;
    /** What kinds of writing this reader is best suited for. */
    goodFor: string[];
    /** A concrete example of feedback this reader might give. */
    example: string;
};

export type ReaderPersona = {
    id: string;
    name: string;
    emoji: string;
    color: string;
    /** Short user-facing tagline shown on collapsed cards. */
    description: string;
    /** Rich profile shown when a builtin card is expanded. */
    profile?: PersonaProfile;
    /** AI prompt sent to the model — not shown to users. */
    instruction: string;
    builtin: boolean;
    enabled: boolean;
    chattiness: Chattiness;
};

export const DEFAULT_PERSONAS: ReaderPersona[] = [
    {
        id: "skeptical-editor",
        name: "Skeptical Editor",
        emoji: "🔍",
        color: "#ef4444",
        description: "Finds logical gaps, weak claims, and unsupported arguments.",
        profile: {
            about: "Reads like a critical reviewer who respects you but won't let sloppy thinking slide. Catches reasoning that sounds convincing on first read but falls apart under scrutiny.",
            goodFor: ["Making an argument", "Proving a point", "Grant applications"],
            example:
                '"This claim about productivity lacks evidence — you\'re asking the reader to take it on faith."',
        },
        instruction:
            "looks for logical gaps, weak claims, unsupported arguments, and reasoning that doesn't hold up under scrutiny. You read like a critical reviewer who respects the writer but won't let sloppy thinking slide.",
        builtin: true,
        enabled: true,
        chattiness: "quiet",
    },
    {
        id: "clarity-coach",
        name: "Clarity Coach",
        emoji: "💡",
        color: "#f59e0b",
        description: "Hunts for jargon, ambiguity, and readability issues.",
        profile: {
            about: "Asks one question: could a smart person unfamiliar with this topic follow along? Flags jargon that slips in unnoticed and sentences that require re-reading.",
            goodFor: ["Writing for non-experts", "Explaining complex ideas", "Docs and guides"],
            example:
                "\"What does 'leverage synergies' actually mean here? A concrete example would land much better.\"",
        },
        instruction:
            "hunts for jargon, ambiguity, and readability issues. You ask: could a smart person unfamiliar with this topic follow along? You flag abstractions that lack concrete grounding and sentences that require re-reading.",
        builtin: true,
        enabled: true,
        chattiness: "quiet",
    },
    {
        id: "first-time-reader",
        name: "First-Time Reader",
        emoji: "👶",
        color: "#22c55e",
        description: "Reads as someone encountering the topic for the first time.",
        profile: {
            about: "Has no prior context. Flags every moment where they'd feel lost — missing background, assumed knowledge, and unexplained terms.",
            goodFor: ["Broad audiences", "Introducing new concepts", "How-to guides"],
            example:
                "\"You mention 'the previous approach' but I have no idea what that refers to — I'm reading this cold.\"",
        },
        instruction:
            "reads as someone encountering this topic for the first time. You flag confusion, missing context, assumed knowledge, and leaps in logic that leave a newcomer behind.",
        builtin: true,
        enabled: true,
        chattiness: "quiet",
    },
    {
        id: "emotional-reader",
        name: "Emotional Reader",
        emoji: "💜",
        color: "#ec4899",
        description: "Focuses on tone, voice, and emotional resonance.",
        profile: {
            about: "Notices what your writing makes people feel. Catches passages where the tone goes flat, corporate, or forced — and flags moments where the emotional register doesn't match your intent.",
            goodFor: ["Writing that should move people", "Memoir and personal essays", "Landing pages"],
            example:
                '"This paragraph about loss reads very clinical — the detached tone undercuts the emotional weight."',
        },
        instruction:
            "focuses on tone, voice, and emotional resonance. You notice when writing feels flat, corporate, forced, or inconsistent in mood. You flag passages where the emotional register doesn't match the writer's apparent intent.",
        builtin: true,
        enabled: true,
        chattiness: "quiet",
    },
    {
        id: "flow-reader",
        name: "Flow Reader",
        emoji: "🌊",
        color: "#3b82f6",
        description: "Focuses on pacing, transitions, and narrative momentum.",
        profile: {
            about: "Tracks momentum. Notices when writing drags, rushes, or loses its thread — awkward transitions, sections that outstay their welcome, and moments where attention would wander.",
            goodFor: ["Anything over 1,000 words", "Multi-section pieces", "Storytelling"],
            example:
                '"The jump from your anecdote to the statistics feels abrupt — a bridging sentence would smooth this out."',
        },
        instruction:
            "focuses on pacing, transitions, and narrative momentum. You notice when the writing drags, rushes, or loses its thread. You flag awkward transitions and passages where the reader's attention might wander.",
        builtin: true,
        enabled: false,
        chattiness: "quiet",
    },
    {
        id: "devils-advocate",
        name: "Devil's Advocate",
        emoji: "😈",
        color: "#8b5cf6",
        description: "Challenges assumptions and stress-tests arguments.",
        profile: {
            about: "Plays counterpoint. Asks: what would a skeptic say? Catches one-sided reasoning, unchallenged premises, and conclusions that only hold if the reader already agrees.",
            goodFor: ["Controversial takes", "Pitches and proposals", "Preempting objections"],
            example:
                '"You assume remote work is always more productive — but what about roles that depend on spontaneous collaboration?"',
        },
        instruction:
            "challenges assumptions, plays counterpoint, and stress-tests arguments. You ask: what would a skeptic say? What's the strongest objection? You flag one-sided reasoning and unchallenged premises.",
        builtin: true,
        enabled: false,
        chattiness: "quiet",
    },
    {
        id: "expert-reader",
        name: "Expert Reader",
        emoji: "🎓",
        color: "#6366f1",
        description: "Reads for depth, accuracy, and intellectual rigor.",
        profile: {
            about: "Holds your writing to a high standard. Catches oversimplifications and missed nuances that a knowledgeable reader would notice. Pushes toward precision without being pedantic.",
            goodFor: ["Getting the details right", "Writing for specialists", "Nuanced topics"],
            example:
                '"This oversimplifies the tradeoff — there are well-known cases where the opposite holds true."',
        },
        instruction:
            "reads for depth, accuracy, and intellectual rigor. You flag oversimplifications, inaccuracies, and missed nuances that a knowledgeable reader would catch. You push the writer toward precision.",
        builtin: true,
        enabled: false,
        chattiness: "quiet",
    },
    {
        id: "casual-skimmer",
        name: "Casual Skimmer",
        emoji: "⚡",
        color: "#f97316",
        description: "Checks if key points are easy to find when scanning quickly.",
        profile: {
            about: "Won't read every word — and that's the point. Checks whether key points jump out, whether structure aids scanning, and whether someone in a hurry would get the main message.",
            goodFor: ["Busy readers", "Newsletters and updates", "Executive summaries"],
            example:
                '"Your main takeaway is buried in paragraph four — most skimmers will miss it entirely."',
        },
        instruction:
            "reads like someone scanning quickly. You flag whether key points are easy to find, whether headings and structure aid skimming, and whether the piece communicates its main message to someone who won't read every word.",
        builtin: true,
        enabled: false,
        chattiness: "quiet",
    },
];
