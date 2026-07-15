/**
 * prompts.ts — Built-in, offline writing prompts and random selection helpers.
 *
 * The library intentionally lives in the app bundle: inspiration stays available
 * without an account, network connection, or configured AI provider.
 */

export const PROMPT_CATEGORIES = [
    "Character",
    "Setting",
    "Conflict",
    "Dialogue",
    "Discovery",
] as const;

export type PromptCategory = (typeof PROMPT_CATEGORIES)[number];

export type WritingPrompt = {
    id: string;
    category: PromptCategory;
    text: string;
};

export const WRITING_PROMPTS: readonly WritingPrompt[] = [
    {
        id: "character-ordinary-secret",
        category: "Character",
        text: "Write about someone whose most ordinary habit is hiding an extraordinary secret.",
    },
    {
        id: "character-wrong-reputation",
        category: "Character",
        text: "A person is famous for something they never actually did. Today, the truth arrives.",
    },
    {
        id: "character-future-self",
        category: "Character",
        text: "Your protagonist receives practical advice from their future self—and refuses to follow it.",
    },
    {
        id: "character-kept-object",
        category: "Character",
        text: "Describe a character through the one object they have carried for years but never use.",
    },
    {
        id: "character-unwanted-talent",
        category: "Character",
        text: "Someone discovers they are exceptionally good at the one thing they swore never to do.",
    },
    {
        id: "character-mistaken-kindness",
        category: "Character",
        text: "An act of kindness is mistaken for a threat. Show who your character becomes under suspicion.",
    },
    {
        id: "setting-last-light",
        category: "Setting",
        text: "The last light in an abandoned building switches on every night at exactly 2:13 a.m.",
    },
    {
        id: "setting-changing-street",
        category: "Setting",
        text: "Write about a street that leads somewhere different each time it rains.",
    },
    {
        id: "setting-memory-museum",
        category: "Setting",
        text: "A museum displays memories instead of objects. One exhibit has your protagonist's name on it.",
    },
    {
        id: "setting-empty-celebration",
        category: "Setting",
        text: "Set a joyful celebration in a place that should be completely empty.",
    },
    {
        id: "setting-underground-sunrise",
        category: "Setting",
        text: "In a city built underground, people gather to watch a sunrise no one has ever seen.",
    },
    {
        id: "setting-closing-library",
        category: "Setting",
        text: "On its final day, a small library returns one book that was never checked out.",
    },
    {
        id: "conflict-help-rival",
        category: "Conflict",
        text: "To get what they want most, your protagonist must help their rival succeed first.",
    },
    {
        id: "conflict-promise-cost",
        category: "Conflict",
        text: "A promise made years ago comes due at the worst possible moment.",
    },
    {
        id: "conflict-both-right",
        category: "Conflict",
        text: "Two people want opposite outcomes, and both are completely right.",
    },
    {
        id: "conflict-small-rule",
        category: "Conflict",
        text: "Breaking one harmless-looking rule would solve everything—except for the person who wrote it.",
    },
    {
        id: "conflict-saved-enemy",
        category: "Conflict",
        text: "Your protagonist saves an enemy, then learns why the enemy wanted to be caught.",
    },
    {
        id: "conflict-public-choice",
        category: "Conflict",
        text: "A private moral choice must be made in front of everyone whose opinion matters.",
    },
    {
        id: "dialogue-avoid-name",
        category: "Dialogue",
        text: "Write an argument in which neither person is willing to say the name at the center of it.",
    },
    {
        id: "dialogue-wrong-number",
        category: "Dialogue",
        text: "“You have the wrong number.” “No, I finally have the right one.” Continue the conversation.",
    },
    {
        id: "dialogue-three-words",
        category: "Dialogue",
        text: "One person can only answer in three-word sentences; the other desperately needs an explanation.",
    },
    {
        id: "dialogue-polite-goodbye",
        category: "Dialogue",
        text: "Write a perfectly polite goodbye between two people who know they will meet again as enemies.",
    },
    {
        id: "dialogue-old-joke",
        category: "Dialogue",
        text: "A familiar joke suddenly stops being funny. Reveal what changed through dialogue alone.",
    },
    {
        id: "dialogue-translation",
        category: "Dialogue",
        text: "A translator deliberately changes one crucial sentence. Someone in the room understands why.",
    },
    {
        id: "discovery-hidden-room",
        category: "Discovery",
        text: "A hidden room contains nothing except a window looking into yesterday.",
    },
    {
        id: "discovery-note-handwriting",
        category: "Discovery",
        text: "Your protagonist finds a warning written in their own handwriting, but they have never seen it before.",
    },
    {
        id: "discovery-map-home",
        category: "Discovery",
        text: "An old map marks a treasure in the exact place your protagonist calls home.",
    },
    {
        id: "discovery-missing-day",
        category: "Discovery",
        text: "Everyone remembers the same day except your protagonist—and all the evidence says they were there.",
    },
    {
        id: "discovery-unopened-letter",
        category: "Discovery",
        text: "An unopened letter has been passed through four generations. Today, someone breaks the seal.",
    },
    {
        id: "discovery-impossible-photo",
        category: "Discovery",
        text: "A photograph reveals one impossible detail that everyone else insists is ordinary.",
    },
];

export function promptsInCategory(category: PromptCategory | null): readonly WritingPrompt[] {
    if (!category) return WRITING_PROMPTS;
    return WRITING_PROMPTS.filter((prompt) => prompt.category === category);
}

export function chooseWritingPrompt(
    category: PromptCategory | null,
    previousId?: string,
    random: () => number = Math.random,
): WritingPrompt {
    const candidates = promptsInCategory(category);
    const freshCandidates =
        candidates.length > 1
            ? candidates.filter((prompt) => prompt.id !== previousId)
            : candidates;
    const index = Math.min(
        Math.floor(random() * freshCandidates.length),
        freshCandidates.length - 1,
    );
    return freshCandidates[Math.max(0, index)];
}

export type PromptInsertion = {
    text: string;
    cursorOffset: number;
};

/** Keep an inserted prompt visually separate from prose on either side. */
export function formatPromptInsertion(
    documentText: string,
    from: number,
    to: number,
    promptText: string,
): PromptInsertion {
    const before = documentText.slice(0, from);
    const after = documentText.slice(to);
    const prefix =
        before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const suffix =
        after.length === 0 || after.startsWith("\n\n")
            ? ""
            : after.startsWith("\n")
              ? "\n"
              : "\n\n";

    return {
        text: `${prefix}${promptText}${suffix}`,
        cursorOffset: prefix.length + promptText.length,
    };
}
