// helpContent.ts — Worked examples for editorial preferences and contextual AI actions.
import type { HelpTab } from "$lib/ui/HelpModal.svelte";
import type { ContextAction } from "./context";

export const EDITORIAL_HELP_TABS: HelpTab[] = [
    {
        id: "stance",
        label: "Stance",
        description:
            "Controls how AI approaches a writing problem: ask about your intent first, offer a concrete alternative, or explore several directions. It does not decide how much of your style may change; that is Voice latitude.",
        scenario:
            'Your opening: "Mara entered the house. She was afraid. She was very afraid."\nYou ask: "Help me make this opening tense. I am open to different approaches."',
        examples: [
            {
                label: "Author-first",
                response:
                    "\"The opening names Mara's fear twice, but we don't yet know what she fears. Is the danger inside the house, or is she afraid of being followed? That would help decide what to show first.\"",
                explanation:
                    "Starts with the problem and a question about your intent before offering a broad rewrite.",
            },
            {
                label: "Collaborative",
                response:
                    '"You could make her fear visible through an action: ‘Mara eased the door shut and listened before taking another step.’ That gives the reader something to worry about with her."',
                explanation:
                    "Offers a usable alternative and explains why it might help, while leaving the choice to you.",
            },
            {
                label: "Exploratory",
                response:
                    '"Two possible openings: start outside with Mara checking whether someone followed her, or start inside with a sound from an upstairs room. The first makes the threat external; the second makes the house itself threatening."',
                explanation:
                    "When you invite exploration, develops different directions before settling on one.",
            },
        ],
        guidance:
            "Choose Author-first when you want help thinking through a problem. Choose Collaborative when you want concrete alternatives to react to. Choose Exploratory when you are still deciding what the piece could become. Your request and the panel you use also shape the response.",
    },
    {
        id: "density",
        label: "Feedback density",
        description:
            "Controls which concerns are worth mentioning. Quiet reserves feedback for problems that obstruct the draft's goal. Focused picks a few useful concerns. Thorough examines a wider range of issues and recurring patterns.",
        scenario:
            'You ask for feedback on this scene:\n"Mara had never visited the house. She found the spare key in its usual hiding place. She felt afraid, terribly afraid. Upstairs, she lit a candle."',
        examples: [
            {
                label: "Quiet",
                response:
                    '"If Mara has never visited, how does she know the key\'s usual hiding place? A brief explanation would make her entry believable."',
                explanation:
                    "Flags the missing logic that could stop a reader. Leaves smaller pacing and phrasing concerns alone.",
            },
            {
                label: "Focused",
                response:
                    '"Clarify how Mara knows where the key is. Also, the jump from outside to upstairs skips her first reaction to the house; a beat at the doorway could build tension."',
                explanation:
                    "Adds a high-impact pacing observation, without commenting on every sentence.",
            },
            {
                label: "Thorough",
                response:
                    '"Clarify the key\'s hiding place and the jump upstairs. ‘Afraid, terribly afraid’ repeats the emotion without developing it. Across the scene, we hear what Mara feels but get little of what she notices; one concrete detail could make the fear more convincing."',
                explanation:
                    "Also considers wording and a pattern across the passage. Repetition can be deliberate, so this remains an editorial judgment.",
            },
        ],
        guidance:
            "Use Quiet to keep interruptions low while drafting, Focused to choose a next editing pass, and Thorough when you have time for a broader review. These are thresholds, not comment counts. Any setting can return no feedback when the writing needs none.",
    },
    {
        id: "voice",
        label: "Voice latitude",
        description:
            "Controls how far proposed wording may move from your style. Preserve stays close to your syntax, diction, and rhythm. Adapt allows moderate changes that serve your request. Transform allows a substantially different treatment in a revision proposal.",
        scenario:
            'Original: "Rain again. The house sat there, stubborn as a bad thought. I went in."\nYou ask: "Smooth this passage while keeping the uneasy mood."',
        examples: [
            {
                label: "Preserve",
                response:
                    '"Rain again. The house sat there, stubborn as a bad thought. I went inside."',
                explanation:
                    "Keeps the fragments, unusual comparison, and blunt rhythm. A response may also recommend leaving the original alone.",
            },
            {
                label: "Adapt",
                response:
                    '"In the rain, the house waited like a thought I couldn\'t shake. I went inside."',
                explanation:
                    "Combines the opening fragments and adjusts the image while retaining the narrator's unease.",
            },
            {
                label: "Transform",
                response:
                    '"The house refused to disappear behind the rain. I crossed its threshold with that same bad thought following me."',
                explanation:
                    "Recasts the image and sentence rhythm into a different voice. This would be a revision proposal with the original still available.",
            },
        ],
        guidance:
            "Use Preserve when the passage already sounds like you, Adapt when you want room for phrasing improvements, and Transform when you want to try a different style. Transform permits a bigger change; it does not require one or let AI replace your draft directly.",
    },
];

type ActionExample = Pick<HelpTab, "scenario" | "examples" | "guidance">;

const SCENE =
    'Paragraph 1: "Mara reached the abandoned house at dusk."\nParagraph 2: "She took a key from her pocket and unlocked the door."\nParagraph 3: "A voice upstairs said her name."';

const ACTION_EXAMPLES: Record<string, ActionExample> = {
    "Prioritize notes": {
        scenario: `${SCENE}\n\nOpen notes: "Why does she come here?", "Explain her reason for entering", and "Try another word for dusk".`,
        examples: [
            {
                label: "A possible editing plan",
                response:
                    "1. Explain why Mara needs to enter the house. This gives the scene a purpose.\n2. Treat the first two notes as one concern about motivation.\n3. Leave ‘dusk’ for a later wording pass.\nNext pass: add a reason to enter, then check whether it makes the upstairs voice more threatening.",
                explanation:
                    "Orders the work and identifies overlapping advice. It does not resolve or delete the notes for you.",
            },
        ],
        guidance:
            "Use this when you have several open notes and need to decide what to tackle first. Reverse outline is more useful when you want to examine the draft's structure itself.",
    },
    "Reverse outline": {
        scenario: SCENE,
        examples: [
            {
                label: "A possible outline of the existing draft",
                response:
                    "1. Arrival: establishes the abandoned house and time of day.\n2. Entry: moves Mara inside and implies she has a prior connection to the house.\n3. Turn: reveals that someone knows she is there.\nGap: we don't yet know why she came. Establishing her goal before the voice speaks could give that interruption more weight.",
                explanation:
                    "Maps the paragraphs you already wrote, then comments on their order and purpose. It does not generate a plan for an unwritten draft.",
            },
        ],
        guidance:
            "Use this when a draft feels repetitive, disorganized, or slow and you want to see what each part contributes. For a single unexplained detail, try Find missing context.",
    },
    "Find missing context": {
        scenario: SCENE,
        examples: [
            {
                label: "A possible reader gap",
                response:
                    "Mara has a key to an abandoned house, but we don't know how she got it. Did she inherit the house, borrow the key, or take it? One clue before she opens the door would help readers understand her connection to the place.",
                explanation:
                    "Identifies what a reader may need to understand the scene. You decide whether the missing information is a useful mystery or an accidental omission.",
            },
        ],
        guidance:
            "Use this when you know the story or argument so well that you may have left something unstated. It looks for missing setup; it does not invent that background for you.",
    },
    "Explain its job": {
        scenario: `${SCENE}\n\nYou select the final paragraph.`,
        examples: [
            {
                label: "A possible response",
                response:
                    "This line turns an empty-house scene into an encounter. It also tells us that whoever is upstairs knows Mara. If the next paragraph explains everything immediately, you may lose the uncertainty this line creates.",
            },
        ],
        guidance:
            "Use this when deciding whether to keep, move, expand, or cut a passage. It explains what the passage contributes before you change it.",
    },
    "Reader question": {
        scenario: 'You select: "A voice upstairs said her name."',
        examples: [
            {
                label: "A possible response",
                response:
                    "Does Mara recognize the voice? A startled pause would keep that question open; a familiar reply would tell us the encounter was expected.",
                explanation:
                    "Names a reader's likely question. A question can signal productive curiosity, not necessarily a flaw.",
            },
        ],
        guidance:
            "Use this to check what a reader is likely to wonder at a particular moment. Find missing context looks more broadly for information the draft may need.",
    },
    "Try another angle": {
        scenario: "You select Mara entering the house and ask for another approach.",
        examples: [
            {
                label: "Two possible directions",
                response:
                    "1. Make her hesitate outside, so the scene centers on her decision to enter.\n2. Start with the voice saying her name, then reveal that she has just stepped inside. This makes the encounter immediate.",
                explanation:
                    "Offers approaches to consider without drafting replacement prose yet.",
            },
        ],
        guidance:
            "Use this when the passage feels stuck and you want a choice of directions before asking for a rewrite.",
    },
    "Use open notes": {
        scenario:
            'You select Mara unlocking the door. Existing notes ask "Where did the key come from?" and "How did she get in?"',
        examples: [
            {
                label: "A possible response",
                response:
                    "Both notes concern access to the house. The key already explains how she gets in; the unanswered question is how she got it. Add a clue about its source rather than explaining the unlocking again.",
            },
        ],
        guidance:
            "Use this when you are editing a specific passage with notes already attached. Prioritize notes makes a plan for the broader draft.",
    },
    "Check the brief": {
        scenario:
            'Your document context says "A reassuring guide for first-time renters". The draft opens with legal jargon and a list of worst-case disputes.',
        examples: [
            {
                label: "A possible response",
                response:
                    "The topic fits the brief, but the opening assumes legal knowledge and leads with risk. A plain-language first step would better serve a first-time renter; the dispute details could come later.",
            },
        ],
        guidance:
            "Use this after drafting to check whether the piece still serves the goal, audience, and tone you recorded in Document context.",
    },
    "Shape a brief": {
        scenario:
            "You have a draft explaining how to inspect a rental apartment, but no Document context yet.",
        examples: [
            {
                label: "A possible brief",
                response:
                    "Goal: help readers spot problems before signing a lease.\nAudience: first-time renters.\nTone: calm and practical.\nEmphasize: questions to ask during a viewing.\nAvoid: unexplained legal terms and scare stories.",
                explanation:
                    "Suggests a brief in chat for you to review and use. It does not save these guesses into Document context automatically.",
            },
        ],
        guidance:
            "Use this when you want to make the draft's intended purpose explicit before doing more editing.",
    },
    "Compare versions": {
        scenario:
            'A revision has two versions:\nA: "Mara knocked and waited."\nB: "Mara let herself in."',
        examples: [
            {
                label: "A possible comparison",
                response:
                    "A makes Mara cautious and gives someone inside control of the encounter. B makes her more decisive and suggests she feels entitled to enter. Choose based on what you want readers to infer about her relationship to the house.",
                explanation:
                    "Explains tradeoffs between the available versions without choosing, combining, or activating one.",
            },
        ],
        guidance:
            "Use this when you have revision alternatives and want help understanding how they change the reader's impression.",
    },
    "Reader reaction": {
        scenario:
            'You select: "Mara laughed when she heard the voice. She had never been more frightened."',
        examples: [
            {
                label: "A possible anchored comment",
                response:
                    "The laugh first reads as relief, so the next sentence surprised me. Is she laughing from nerves? A physical cue could make the contradiction feel intentional.",
            },
        ],
        guidance:
            "Use this to learn how a passage may land emotionally or intellectually for a reader, before deciding whether to revise it.",
    },
    "Passage function": {
        scenario:
            "A paragraph describing the house's ownership history sits between the upstairs voice calling Mara and her reply.",
        examples: [
            {
                label: "A possible anchored comment",
                response:
                    "This paragraph explains why Mara knows the house, but it pauses the encounter just as tension rises. Could it come before she enters, or after she answers the voice?",
            },
        ],
        guidance:
            "Use this when a passage contains useful material but you are unsure whether it belongs at this point in the piece.",
    },
    "Hard question": {
        scenario:
            "The draft says Mara promised never to return, then shows her entering with no hesitation.",
        examples: [
            {
                label: "A possible anchored comment",
                response:
                    "What matters enough to Mara that she would break this promise? Without a cost or a reason, the return doesn't yet feel like the major decision the promise sets up.",
            },
        ],
        guidance:
            "Use this when you want to challenge a central assumption, motivation, or claim instead of polishing the wording around it.",
    },
    "Audit notes": {
        scenario:
            "Two existing comments flag an abrupt jump upstairs. A later paragraph also reveals a contradiction in the timeline that nobody has noted.",
        examples: [
            {
                label: "A possible review",
                response:
                    "The two transition notes cover the same issue; no third note is needed there. The timeline needs a separate look: Mara arrives at dusk, but the next paragraph says the sun is overhead.",
                explanation:
                    "Uses existing annotations to avoid duplicate feedback and identify concerns they have missed.",
            },
        ],
        guidance:
            "Use this when a passage or draft has already been reviewed and you want feedback that builds on the notes you have.",
    },
    "Structure scan": {
        scenario:
            "An essay gives three examples, introduces its main claim near the end, then returns to background information.",
        examples: [
            {
                label: "A possible anchored comment",
                response:
                    "Readers reach the examples before they know what the examples support. Consider moving this main claim before the first example, then checking whether the late background belongs in the opening.",
            },
        ],
        guidance:
            "Use this when the order or emphasis feels wrong. Reverse outline first maps the structure in chat; Structure scan gives feedback on passages where it may need work.",
    },
    "Against the brief": {
        scenario:
            "Document context calls for a calm guide for first-time renters. A paragraph assumes readers already know how a security deposit works.",
        examples: [
            {
                label: "A possible anchored comment",
                response:
                    "The brief names first-time renters, but this paragraph assumes they know what the deposit covers. A one-sentence definition would help this audience follow the advice.",
            },
        ],
        guidance:
            "Use this to get passage-level feedback tied to your recorded goal, audience, and tone. Check the brief offers that comparison in chat.",
    },
    "Audience fit": {
        scenario:
            'A guide titled "Your first apartment" opens with "Evaluate indemnification provisions before execution."',
        examples: [
            {
                label: "A possible reader concern",
                response:
                    "A first-time renter may not know either legal term here. Explain which promise in the lease they should check and what could happen if they overlook it.",
            },
        ],
        guidance:
            "Use this when you want to know who the writing seems to serve and where that reader may struggle, especially before you have written a brief.",
    },
    "Recurring patterns": {
        scenario:
            "Several scenes end by explicitly naming an emotion, even after an action has already shown it.",
        examples: [
            {
                label: "A possible pattern with an example",
                response:
                    "You often explain the emotion immediately after showing it. Here, ‘Her hands shook as she folded the letter’ already conveys distress before ‘She was upset.’ Try checking scene endings for the same repetition.",
                explanation:
                    "Points to representative instances so you can recognize the pattern, rather than marking every occurrence.",
            },
        ],
        guidance:
            "Use this for an editing pass focused on habits across the draft, such as repeated exposition, weak transitions, or over-explained emotions.",
    },
    Tighten: {
        scenario: 'You select: "She began to slowly make her way toward the front door."',
        examples: [
            {
                label: "A possible suggestion",
                response: "She moved slowly toward the front door.",
                explanation: "Removes the wordy setup while keeping the action and pace.",
            },
        ],
        guidance:
            "Use this when a passage says what you mean but takes too long to say it. It aims for concision without a fixed word count.",
    },
    "Improve rhythm": {
        scenario:
            'You select: "She opened the door. She stepped inside. She heard a noise. She stopped."',
        examples: [
            {
                label: "A possible suggestion",
                response: "She opened the door and stepped inside. A noise. She stopped.",
                explanation: "Varies sentence lengths so the final stop interrupts the movement.",
            },
        ],
        guidance:
            "Use this when sentences feel monotonous or awkward aloud. Shorter is not always better; the aim is a rhythm that serves the scene.",
    },
    "Two directions": {
        scenario:
            'You select: "Mara opened the letter and read the news." The letter reveals that her brother is alive.',
        examples: [
            {
                label: "Direct",
                response: "Mara tore open the letter. Her brother was alive.",
                explanation: "Reveals the news immediately and moves the scene forward.",
            },
            {
                label: "Suspenseful",
                response:
                    "Mara unfolded the letter. She read the first line twice before she could go on.",
                explanation: "Delays the news to keep attention on her reaction.",
            },
        ],
        guidance:
            "Use this when you want contrasting revision proposals to compare. Try another angle discusses possible approaches in chat before rewriting.",
    },
    "Revise to notes": {
        scenario:
            'You select: "Mara grabbed the key." An attached comment says the action feels too abrupt for a cautious character.',
        examples: [
            {
                label: "A possible suggestion",
                response: "Mara reached for the key, then paused with her hand above it.",
                explanation:
                    "Addresses the note by making hesitation visible in the selected passage.",
            },
        ],
        guidance:
            "Use this when you agree with an existing note and want help turning it into a specific change.",
    },
    "Line-edit hotspots": {
        scenario:
            'Most of a paragraph reads cleanly, but one sentence says "She returned back to the door again."',
        examples: [
            {
                label: "A possible suggestion",
                response: "She returned to the door.",
                explanation:
                    "Targets an obvious redundancy while leaving sentences that already work alone.",
            },
        ],
        guidance:
            "Use this for a selective wording pass across a draft when you want a few worthwhile edits instead of a rewrite of every line.",
    },
    Transitions: {
        scenario:
            'A paragraph ends "The lock would not turn." The next begins "Upstairs, Mara opened a window."',
        examples: [
            {
                label: "A possible response",
                response:
                    "How did Mara get inside after the lock failed? Add that action before moving upstairs.",
                explanation:
                    "When the gap is a missing event, a question may be more useful than an invented bridge.",
            },
        ],
        guidance:
            "Use this when readers may lose track of how one idea, place, or action leads to the next. A transition may need missing information as well as different wording.",
    },
    "Protect the voice": {
        scenario:
            'A blunt narrator says: "Rain. Of course. I was completely soaked through to the skin."',
        examples: [
            {
                label: "A possible suggestion",
                response: "Rain. Of course. I was soaked to the skin.",
                explanation:
                    "Cuts redundancy but keeps the fragments and dry tone instead of smoothing everything into a formal sentence.",
            },
        ],
        guidance:
            "Use this when you want a cleaner draft that still sounds like its narrator. Voice latitude also guides how far proposed phrasing may move.",
    },
    "Resolve notes": {
        scenario:
            'A draft has a comment on "She watched her leave" asking which of two women is leaving.',
        examples: [
            {
                label: "A possible suggestion",
                response: "Mara watched Ellen leave.",
                explanation:
                    "Addresses the ambiguity in the wording. Reviewing the proposal and resolving the original note remain your choices.",
            },
        ],
        guidance:
            "Use this for a draft-wide pass that turns open notes into proposed line edits. Prioritize notes helps decide which notes to address before requesting changes.",
    },
};

const COMPRESSION_EXAMPLE: ActionExample = {
    scenario:
        'For an eight-word selection, the action targets six words:\n"Rain was falling very heavily on the roof."',
    examples: [
        { label: "Alternative 1, six words", response: "Heavy rain beat against the roof." },
        { label: "Alternative 2, six words", response: "Rain hammered hard on the roof." },
    ],
    guidance:
        "Use this when you need a specific length. The button calculates a target of roughly three quarters of your selection and requests two alternatives at that word count. Tighten aims for concision without an exact target.",
};

export function getActionHelpTab(action: ContextAction): HelpTab {
    const example =
        action.id === "revise-exact-compression"
            ? COMPRESSION_EXAMPLE
            : ACTION_EXAMPLES[action.label];
    return {
        id: action.id,
        label: action.label,
        description: action.description,
        ...example,
    };
}
