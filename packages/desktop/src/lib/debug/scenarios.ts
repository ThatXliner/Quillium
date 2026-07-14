/**
 * scenarios.ts — Debug scenario definitions for the Quillium debug panel.
 *
 * Each scenario sets up the editor in a specific state useful for
 * manual testing without requiring AI API calls. Scenarios are pure
 * functions that receive an EditorView and dispatch the necessary
 * transactions to reach the target state.
 *
 * category: "debug" — raw structural/edge-case tests
 * category: "demo"  — polished, realistic scenarios suitable for demos
 *
 * `group` further buckets scenarios within a category so the debug panel can
 * render them as accordion sections instead of one long flat list — see
 * `ScenarioGroup` below for the fixed set of section names.
 *
 * To add a new scenario: append an entry to the `scenarios` array and pick
 * (or add) a `group` for it.
 */

import { createComment, createRevision, createSuggestion } from "$lib/editor/plugins/annotations";
import {
    addAnnotation,
    annotationField,
    setActiveRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    type VersionGroupMember,
    activeVersion,
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import {
    createNestedEditorState,
    translateAndDispatch,
} from "$lib/editor/plugins/annotations/nestedEditor";
import { createVersionGroup } from "$lib/editor/plugins/annotations/versionGroupField";
import { EditorSelection, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export type ScenarioCategory = "debug" | "demo";

/**
 * Sub-grouping within a category, used to render the debug panel as
 * accordion sections instead of one long flat list. Purely presentational —
 * doesn't affect scenario behavior.
 */
export type ScenarioGroup =
    | "Showcase"
    | "Comments"
    | "Suggestions"
    | "Revisions"
    | "Combinations & edge cases"
    | "Provenance & authorship"
    | "Privacy & safety"
    | "Screenshot & video fixtures"
    | "Editorial sessions"
    | "Linked versions";

export type Scenario = {
    id: string;
    label: string;
    description: string;
    category: ScenarioCategory;
    group: ScenarioGroup;
    /** The document content to set before applying annotations. */
    doc: string;
    setup: (view: EditorView) => void;
};

// ── Sample documents ──────────────────────────────────────────────────────────

const DOC_LIGHTHOUSE_KEEPER = `The old lighthouse keeper had watched storms roll in from the sea for forty years. Each one was different — some crept in slowly, giving him hours to prepare, while others arrived without warning, the sky turning green and angry before the wind even picked up.

He checked the lamp mechanism one last time, running his fingers along the brass gears the way a pianist touches keys before a concert. Everything had to work tonight.

The fog had been thick all week, and three ships were expected in the harbour before dawn.`;

const DOC_NOVEL_OPENING = `The morning Elena arrived in Kraków, the city was doing what it did best: pretending nothing had changed.

Trams rattled past the Cloth Hall on their same iron tracks. The flower sellers arranged their buckets outside the market as though this were any other Tuesday in October. A boy with a school satchel too large for his frame was chasing pigeons near the fountain — getting nowhere, as pigeons tend to ensure.

Elena stood at the edge of the square with two suitcases and the address of a flat she had never seen. The letter from her cousin was folded into quarters in her coat pocket. She had read it so many times the crease lines had gone white.

The flat was on Ulica Grodzka, third floor, second door on the left. Her cousin had underlined this twice, as though Elena might otherwise knock on the wrong door and disappear into someone else's life.

She wasn't sure this would be the worse outcome.

The trams continued. The flower sellers arranged. The boy with the too-large satchel finally gave up on the pigeons and turned instead to the more achievable ambition of kicking a bottle cap into a drain.

Elena picked up her suitcases and walked.`;

const DOC_ESSAY_DRAFT = `On the Question of Forgetting

There is a particular cruelty in the way memory works: it keeps what we would most like to lose and loses what we most want to keep. We remember the shame of small failures with crystalline precision — the wrong word said at the wrong moment, the face of someone we disappointed — while the good things go soft at the edges, blur, and eventually resolve into a feeling rather than a fact.

Neuroscientists would tell you this is adaptive. Negative events are encoded more strongly because they carry survival information. The brain is not sentimental; it is practical. It keeps the ledger of dangers, not the ledger of joys.

But this explanation, while accurate, does not make the thing less cruel. Accuracy and comfort are not the same.

I have been thinking about this because of my grandmother, who is now eighty-three and who has begun, in the last two years, to forget in the ordinary way that old age sometimes brings. She has lost words — not dramatically, not all at once, but in the manner of a slow tide going out. A name will escape her. A date. The word for the thing she is pointing at.

What she has not lost — or not yet — is the texture of experience. She knows how things felt. She remembers that her late husband loved a certain kind of music, though she no longer remembers which kind. She knows they danced, though she cannot say where.

I find myself wondering whether this is the truer form of memory: the residue of feeling, stripped of the brittle scaffolding of fact.`;

const DOC_SHORT_STORY = `Inventory

Marcus kept a list of everything he had ever lost.

It began, as these things often do, as a joke. He was twenty-four and had lost his keys for the third time that week, and his flatmate Dani had said, laughing, that he should write it all down. Keep track. See if there was a pattern.

So he did.

He started with the keys (silver Yale, green rubber tab, found eventually behind the radiator). He added the grey scarf (left on a bench in Finsbury Park, never recovered). He added his grandfather's watch (vanished somewhere between the move from Finchley and the flat in Peckham, despite his certainty that he had packed it carefully, that he had wrapped it himself in a sock and placed it in the box marked FRAGILE DO NOT STACK which everyone, naturally, stacked).

The list grew. He lost sunglasses at a rate that suggested he was being specifically targeted. He lost an umbrella in every city he visited. He lost a phone once in a lake, which felt like an escalation.

He lost touch with people. He listed them too, eventually, when the habit had spread to fill all the available containers in his life. An old schoolfriend. A woman he had dated briefly and liked more than he had admitted at the time. His cousin in Brisbane, with whom he had been close as a child and from whom he now received only the occasional holiday message, impersonal enough to suggest it was sent to a list.

He did not know if listing them helped. He suspected it didn't. But the list had its own logic by then, and stopping it would have felt like a different kind of loss.`;

const DOC_MEMOIR_EXCERPT = `My mother was a woman who did not believe in photographs.

This is not a metaphor. She literally did not own a camera for the twenty-three years I lived with her, and when relatives sent photos at Christmas she would look at them once, briefly, and set them face-down on the counter. If you asked her why, she said: I was there. I don't need to see it again.

I used to think this was a kind of arrogance. Now I think it was the opposite — a form of grief management so efficient it had become a personality. My mother's past was hers alone, interior, unverifiable, and that was exactly how she wanted it.

The consequence is that I have almost no visual record of her. There are three photographs of her before the age of forty: one from her wedding, one from a holiday in Majorca in 1987 where she is squinting into the sun and cannot be identified from the others in the group without someone to point her out, and one taken by my aunt at a birthday party when my mother did not know she was being photographed — the only one where she looks like herself.

I have looked at this last photograph many times since she died. In it she is laughing at something out of frame. Her hands are raised, just slightly, as though she is in the middle of making a point. She is forty-one. I am now forty-two.

I would give quite a lot to know what she was laughing at.`;

const DOC_FICTION_DIALOGUE = `The two of them had been sitting in the car for eleven minutes before either of them spoke. James knew because he had been watching the clock on the dashboard, not because he wanted to know the time, but because looking at the clock was something to do that wasn't looking at her.

"You should have told me," Cara said finally.

"I know."

"Not — " She stopped. Started again. "Not because I would have done anything differently. I don't think I would have. But I should have known."

James didn't say anything. Outside, a man was walking a very small dog with great seriousness, as though the dog were a matter of considerable importance.

"Is that what you actually think?" Cara said. "Or is that what you're saying because you don't know what else to say?"

James considered this carefully, which was perhaps already an answer.

"I don't know," he said.

She nodded, slowly, looking at something through the windscreen. He followed her gaze and found only the street, unchanged.

"Okay," she said at last. "Okay."

He wasn't sure what it meant, but it didn't sound like the end of something. It sounded like the middle.`;

// Public domain — the opening movement of Emerson's "Self-Reliance" (1841),
// used by the feature-showcase scenario. Excerpted verbatim from the Project
// Gutenberg edition (Essays: First Series, ebook #2944) so the "kitchen sink"
// scenario below has ~1,000 words of real prose with enough distinct
// sentences to hang every annotation feature on without any two targets
// colliding.
const DOC_SELF_RELIANCE = `I read the other day some verses written by an eminent painter which were original and not conventional. The soul always hears an admonition in such lines, let the subject be what it may. The sentiment they instill is of more value than any thought they may contain. To believe your own thought, to believe that what is true for you in your private heart is true for all men — that is genius. Speak your latent conviction, and it shall be the universal sense; for the inmost in due time becomes the outmost, and our first thought is rendered back to us by the trumpets of the Last Judgment. Familiar as the voice of the mind is to each, the highest merit we ascribe to Moses, Plato and Milton is that they set at naught books and traditions, and spoke not what men, but what they thought. A man should learn to detect and watch that gleam of light which flashes across his mind from within, more than the lustre of the firmament of bards and sages. Yet he dismisses without notice his thought, because it is his. In every work of genius we recognize our own rejected thoughts; they come back to us with a certain alienated majesty. Great works of art have no more affecting lesson for us than this. They teach us to abide by our spontaneous impression with good-humored inflexibility then most when the whole cry of voices is on the other side. Else to-morrow a stranger will say with masterly good sense precisely what we have thought and felt all the time, and we shall be forced to take with shame our own opinion from another.

There is a time in every man's education when he arrives at the conviction that envy is ignorance; that imitation is suicide; that he must take himself for better for worse as his portion; that though the wide universe is full of good, no kernel of nourishing corn can come to him but through his toil bestowed on that plot of ground which is given to him to till. The power which resides in him is new in nature, and none but he knows what that is which he can do, nor does he know until he has tried. Not for nothing one face, one character, one fact, makes much impression on him, and another none. This sculpture in the memory is not without preestablished harmony. The eye was placed where one ray should fall, that it might testify of that particular ray. We but half express ourselves, and are ashamed of that divine idea which each of us represents. It may be safely trusted as proportionate and of good issues, so it be faithfully imparted, but God will not have his work made manifest by cowards. A man is relieved and gay when he has put his heart into his work and done his best; but what he has said or done otherwise shall give him no peace. It is a deliverance which does not deliver. In the attempt his genius deserts him; no muse befriends; no invention, no hope.

Trust thyself: every heart vibrates to that iron string. Accept the place the divine providence has found for you, the society of your contemporaries, the connection of events. Great men have always done so, and confided themselves childlike to the genius of their age, betraying their perception that the absolutely trustworthy was seated at their heart, working through their hands, predominating in all their being. And we are now men, and must accept in the highest mind the same transcendent destiny; and not minors and invalids in a protected corner, not cowards fleeing before a revolution, but guides, redeemers and benefactors, obeying the Almighty effort and advancing on Chaos and the Dark.

What pretty oracles nature yields us on this text in the face and behavior of children, babes, and even brutes! That divided and rebel mind, that distrust of a sentiment because our arithmetic has computed the strength and means opposed to our purpose, these have not. Their mind being whole, their eye is as yet unconquered, and when we look in their faces we are disconcerted. Infancy conforms to nobody; all conform to it; so that one babe commonly makes four or five out of the adults who prattle and play to it. So God has armed youth and puberty and manhood no less with its own piquancy and charm, and made it enviable and gracious and its claims not to be put by, if it will stand by itself. Do not think the youth has no force, because he cannot speak to you and me. Hark! in the next room his voice is sufficiently clear and emphatic. It seems he knows how to speak to his contemporaries. Bashful or bold then, he will know how to make us seniors very unnecessary.

The nonchalance of boys who are sure of a dinner, and would disdain as much as a lord to do or say aught to conciliate one, is the healthy attitude of human nature. A boy is in the parlor what the pit is in the playhouse; independent, irresponsible, looking out from his corner on such people and facts as pass by, he tries and sentences them on their merits, in the swift, summary way of boys, as good, bad, interesting, silly, eloquent, troublesome. He cumbers himself never about consequences, about interests; he gives an independent, genuine verdict. You must court him; he does not court you. But the man is as it were clapped into jail by his consciousness. As soon as he has once acted or spoken with éclat he is a committed person, watched by the sympathy or the hatred of hundreds, whose affections must now enter into his account. There is no Lethe for this. Ah, that he could pass again into his neutrality! Who can thus avoid all pledges and, having observed, observe again from the same unaffected, unbiased, unbribable, unaffrighted innocence — must always be formidable. He would utter opinions on all passing affairs, which being seen to be not private but necessary, would sink like darts into the ear of men and put them in fear.

These are the voices which we hear in solitude, but they grow faint and inaudible as we enter into the world. Society everywhere is in conspiracy against the manhood of every one of its members. Society is a joint-stock company, in which the members agree, for the better securing of his bread to each shareholder, to surrender the liberty and culture of the eater. The virtue in most request is conformity. Self-reliance is its aversion. It loves not realities and creators, but names and customs.

Whoso would be a man, must be a nonconformist. He who would gather immortal palms must not be hindered by the name of goodness, but must explore if it be goodness. Nothing is at last sacred but the integrity of your own mind.`;

// Public domain — A Tale of Two Cities (Dickens), used by the screenshot script
const DICKENS_DOC = `It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair.

We had everything before us, we had nothing before us, we were all going direct to Heaven, we were all going direct the other way. There were a king with a large jaw and a queen with a plain face, on the throne of England; there were a king with a large jaw and a queen with a fair face, on the throne of France.

It was the year of Our Lord one thousand seven hundred and seventy-five. Spiritual revelations were conceded to England at that favoured period, as at this. Mrs. Southcott had recently attained her five-and-twentieth blessed birthday, of whom a prophetic private in the Life Guards had heralded the sublime appearance by announcing that arrangements were made for the swallowing up of London and Westminster.`;

// Video-only micro-story used by the Quillium product reel capture mode.
// Keeping every screenshot on the same sentence makes the branching metaphor
// legible across cuts instead of pairing demo copy with unrelated fixture text.
const VIDEO_RAIN_DOC = `The rain found her beneath the station clock, coat darkened at the shoulders, one hand closed around a letter she had not opened.

She watched the departures board change twice before she finally looked down at the envelope. The ink had begun to feather at the edges, but the name was still hers.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve a group member `(revisionId, versionId)` for a specific revision's
 * version, picked by label. Used by the linked-versions scenario to resolve the
 * ids createRevision assigned internally so they can be grouped. Returns
 * undefined if the revision or the labelled version isn't found.
 */
function memberByVersionLabel(
    view: EditorView,
    revisionId: number,
    label: string,
): VersionGroupMember | undefined {
    const ann = view.state.field(annotationField)[revisionId];
    if (!ann || !isAnnotationOfType(ann, "revision")) return undefined;
    const v = ann.versions.find((ver) => ver.label === label);
    return v ? { revisionId, versionId: v.id } : undefined;
}

/** The id of the most recently added revision annotation, or undefined. */
function latestRevisionId(view: EditorView): number | undefined {
    const anns = view.state.field(annotationField);
    let best: number | undefined;
    for (const [idStr, ann] of Object.entries(anns)) {
        if (!isAnnotationOfType(ann, "revision")) continue;
        const id = Number(idStr);
        if (best === undefined || id > best) best = id;
    }
    return best;
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

export const scenarios: Scenario[] = [
    // ── SHOWCASE — every annotation feature in one document ────────────────────

    {
        id: "self-reliance-showcase",
        label: "Feature showcase (Self-Reliance)",
        description:
            "Every annotation feature in one pass over Emerson's Self-Reliance: comments (simple, pending, long thread, personas), suggestions (multi- and single-option), revisions (simple, verbose, linked version groups, nested editor), and a contained suggestion+revision pair",
        category: "debug",
        group: "Showcase",
        doc: DOC_SELF_RELIANCE,
        setup(view) {
            // ── Comments ──────────────────────────────────────────────────────
            createComment({
                targetText:
                    "To believe your own thought, to believe that what is true for you in your private heart is true for all men — that is genius.",
                comment:
                    "The whole essay's thesis in one line. Everything after this either illustrates or defends it — worth flagging as the sentence readers will remember.",
                author: "Editor",
                view,
            });

            // Pending comment — empty annotation waiting for user input.
            {
                const state = view.state;
                const target = "envy is ignorance";
                const from = state.doc.toString().indexOf(target);
                if (from !== -1) {
                    const to = from + target.length;
                    view.dispatch(
                        state.update({
                            effects: [
                                addAnnotation.of(
                                    createNewAnnotation(
                                        state.field(annotationField),
                                        EditorSelection.single(from, to),
                                        "comment",
                                    ),
                                ),
                            ],
                        }),
                    );
                }
            }

            // Comment with a long, multi-message thread.
            {
                const state = view.state;
                const target =
                    "Society is a joint-stock company, in which the members agree, for the better securing of his bread to each shareholder, to surrender the liberty and culture of the eater.";
                const from = state.doc.toString().indexOf(target);
                if (from !== -1) {
                    const to = from + target.length;
                    view.dispatch(
                        state.update({
                            effects: [
                                addAnnotation.of({
                                    ...createNewAnnotation(
                                        state.field(annotationField),
                                        EditorSelection.create([EditorSelection.range(from, to)]),
                                        "comment",
                                    ),
                                    thread: [
                                        {
                                            message:
                                                "The corporate metaphor is doing a lot — is 'joint-stock company' too period-specific for a modern reader?",
                                            author: "Skeptical Editor",
                                            time: Date.now() - 3600_000,
                                        },
                                        {
                                            message:
                                                "I think it's the point — Emerson wants the transaction to sound cold and financial. Keep it.",
                                            author: "User",
                                            time: Date.now() - 1800_000,
                                        },
                                        {
                                            message:
                                                "Agreed — protect it. The bluntness is doing the rhetorical work.",
                                            author: "Editor",
                                            time: Date.now() - 900_000,
                                        },
                                    ],
                                }),
                            ],
                        }),
                    );
                }
            }

            // Persona-authored comments — different reader voices, including AI.
            createComment({
                targetText: "The virtue in most request is conformity.",
                comment:
                    "Reads as a throwaway generalization on first pass — does it earn its place, or could the essay show this instead of stating it?",
                author: "Skeptical Editor",
                view,
            });
            createComment({
                targetText: "Self-reliance is its aversion.",
                comment:
                    "Sharp turn of phrase — 'aversion' personifies self-reliance nicely against the corporate metaphor above.",
                author: "AI",
                view,
            });

            // Adjacent annotations sharing an edge.
            createComment({
                targetText: "that he must take himself for better for worse as his portion",
                comment:
                    "Marriage-vow cadence ('for better for worse') — deliberate echo, or accidental?",
                author: "Editor",
                view,
            });
            createComment({
                targetText: "though the wide universe is full of good",
                comment: "Nice pivot from the personal ('his portion') back out to the universal.",
                author: "Editor",
                view,
            });

            // ── Suggestions ───────────────────────────────────────────────────
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText:
                    "Do not think the youth has no force, because he cannot speak to you and me.",
                replacements: [
                    {
                        text: "Don't mistake the youth's silence for a lack of force.",
                        rationale: "Tighter, modernizes 'do not think' without losing the warning",
                    },
                    {
                        text: "The youth's force isn't diminished by his silence with us.",
                        rationale: "Reframes as a positive claim rather than a negation",
                    },
                ],
                comment:
                    "Double negative ('do not think... has no force') slows the reader right before the payoff line.",
                author: "Copy Editor",
            });

            // Suggestion with exactly one replacement — single-option UI state.
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "There is no Lethe for this.",
                replacements: [
                    {
                        text: "There is no forgetting this.",
                        rationale:
                            "'Lethe' may send modern readers to a footnote — plain language keeps the momentum",
                    },
                ],
                comment: "Lovely, but consider your reader.",
                author: "Editor",
            });

            // ── Revisions ─────────────────────────────────────────────────────
            createRevision({
                targetText: "A boy is in the parlor what the pit is in the playhouse;",
                versions: [
                    {
                        label: "Modernize",
                        text: "A boy in the room is what the crowd is at a show;",
                    },
                    {
                        label: "Compress",
                        text: "A boy holds a room the way an audience holds a stage;",
                    },
                ],
                threadMessage:
                    "The theatre simile is vivid but 'parlor' and 'pit' both need historical footnotes for a contemporary reader. Two directions: modernize the nouns, or compress the whole image.",
                author: "Developmental Editor",
                view,
            });

            // Revision with long, verbose alternatives — tests card expansion.
            createRevision({
                targetText:
                    "Trust thyself: every heart vibrates to that iron string. Accept the place the divine providence has found for you, the society of your contemporaries, the connection of events. Great men have always done so, and confided themselves childlike to the genius of their age, betraying their perception that the absolutely trustworthy was seated at their heart, working through their hands, predominating in all their being. And we are now men, and must accept in the highest mind the same transcendent destiny; and not minors and invalids in a protected corner, not cowards fleeing before a revolution, but guides, redeemers and benefactors, obeying the Almighty effort and advancing on Chaos and the Dark.",
                versions: [
                    {
                        label: "Academic",
                        text: "Self-trust, in Emerson's formulation, is not mere confidence but a form of metaphysical alignment: the individual's inmost conviction is continuous with providence itself. Great men, he argues, have always recognized this continuity and acted from it rather than against it; the modern reader is invited to claim the same transcendent mandate, rejecting both the timidity of the invalid and the reactivity of the revolutionary in favor of active, generative participation in the unfolding of events.",
                    },
                    {
                        label: "Essayistic",
                        text: "Trust yourself — that's the whole instruction, repeated in every register Emerson can find. The great men he admires didn't invent this trust; they simply stopped arguing with it. We're asked to do the same: not to cower in a corner, not to burn things down out of frustration, but to build, guide, and give — to advance rather than merely react.",
                    },
                    {
                        label: "Strip back",
                        text: "Trust yourself. The people history remembers did. Be a builder, not a bystander or a wrecker.",
                    },
                ],
                threadMessage:
                    "This paragraph is the essay's engine, but it's also the densest stretch of prose in the excerpt. Three directions: academic (unpacks the argument formally), essayistic (keeps the register but shortens the sentences), or stripped back (trusts the reader to fill in the rest).",
                author: "Editor",
                view,
            });

            // ── Contained annotation: suggestion nested inside a revision ──────
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "must be a nonconformist",
                replacements: [
                    {
                        text: "must refuse the crowd",
                        rationale:
                            "'Nonconformist' has drifted toward a fashion cliché — 'refuse the crowd' keeps the defiance without the buzzword",
                    },
                ],
                comment:
                    "Worth reconsidering this word choice on its own before touching the sentence around it.",
                author: "Copy Editor",
            });
            createRevision({
                targetText: "Whoso would be a man, must be a nonconformist.",
                versions: [
                    {
                        label: "Modernize",
                        text: "To be a man, you must refuse to conform.",
                    },
                    {
                        label: "Keep archaic",
                        text: "Whoso would be a man must be a nonconformist.",
                    },
                ],
                threadMessage:
                    "The most quoted line in the essay, and it contains an annotation of its own (see the suggestion on 'must be a nonconformist') — a good test of contained annotation ranges. 'Whoso' is archaic; decide whether that's a feature or a barrier.",
                author: "Developmental Editor",
                view,
            });

            // ── Linked version groups — two revisions tied by a shared pill ────
            createRevision({
                targetText: "Speak your latent conviction",
                versions: [
                    { label: "Formal", text: "Articulate your innermost conviction" },
                    { label: "Casual", text: "Just say what you actually believe" },
                ],
                threadMessage: "Sets the register for the whole excerpt — formal or plainspoken?",
                author: "Editor",
                view,
            });
            const toneOpeningId = latestRevisionId(view);

            createRevision({
                targetText: "Nothing is at last sacred but the integrity of your own mind.",
                versions: [
                    {
                        label: "Formal",
                        text: "Nothing, finally, is sacred but the integrity of one's own mind.",
                    },
                    {
                        label: "Casual",
                        text: "In the end, nothing's sacred except staying true to your own mind.",
                    },
                ],
                threadMessage:
                    "The closing claim — should match whichever register you picked at the top.",
                author: "Editor",
                view,
            });
            const toneClosingId = latestRevisionId(view);

            if (toneOpeningId !== undefined && toneClosingId !== undefined) {
                const formalMembers = [
                    memberByVersionLabel(view, toneOpeningId, "Formal"),
                    memberByVersionLabel(view, toneClosingId, "Formal"),
                ].filter((m): m is VersionGroupMember => m !== undefined);
                const casualMembers = [
                    memberByVersionLabel(view, toneOpeningId, "Casual"),
                    memberByVersionLabel(view, toneClosingId, "Casual"),
                ].filter((m): m is VersionGroupMember => m !== undefined);

                if (formalMembers.length >= 2) {
                    const [m0, m1, ...rest] = formalMembers;
                    view.dispatch(createVersionGroup("Formal", [m0, m1, ...rest]).spec);
                }
                if (casualMembers.length >= 2) {
                    const [m0, m1, ...rest] = casualMembers;
                    view.dispatch(createVersionGroup("Casual", [m0, m1, ...rest]).spec);
                }
            }

            // ── Nested editor: a revision whose version holds a nested comment ─
            createRevision({
                targetText: "You must court him; he does not court you.",
                versions: [
                    {
                        label: "Extended",
                        text: "You must court him, walk to his side of the room, earn his good opinion; he does not court you, and never will.",
                    },
                ],
                threadMessage:
                    "The asymmetry is the point, but the extension might over-explain it — open the nested editor and see whether the added clause earns its place.",
                author: "Editor",
                view,
            });
            const nestingRevisionId = latestRevisionId(view);
            if (nestingRevisionId !== undefined) {
                let revision = view.state.field(annotationField)[nestingRevisionId];
                if (revision && isAnnotationOfType(revision, "revision")) {
                    const extended = revision.versions.find((v) => v.label === "Extended");
                    if (extended) {
                        view.dispatch(
                            setActiveRevisionVersion(view.state, revision.id, extended.id),
                        );
                    }
                    revision = view.state.field(annotationField)[nestingRevisionId];
                    if (revision && isAnnotationOfType(revision, "revision")) {
                        const nestedHost = document.createElement("div");
                        const nestedState = createNestedEditorState(
                            activeVersion(revision),
                            (update) => translateAndDispatch(update, view, nestingRevisionId),
                            view,
                            nestingRevisionId,
                        );
                        const nestedView = new EditorView({
                            state: nestedState,
                            parent: nestedHost,
                        });
                        createComment({
                            targetText: "and never will",
                            comment:
                                "This closing clause pushes past where the reader needs it to go — consider cutting.",
                            author: "Copy Editor",
                            view: nestedView,
                        });
                        nestedView.destroy();
                    }
                }
            }
        },
    },

    // ── DEBUG — structural and edge-case tests ─────────────────────────────────

    {
        id: "provenance-matrix",
        label: "Provenance matrix",
        description:
            "Replay-safe history containing typed, pasted, human revision, AI revision, and human-edited AI revision events — load it, then open Authorship Playback",
        category: "debug",
        group: "Provenance & authorship",
        // Authorship Playback reconstructs the document from the event stream.
        // Starting empty ensures event one contains the complete seed text.
        doc: "",
        setup(view) {
            const seed = [
                "Human revision target begins plainly.",
                "AI revision target begins plainly.",
                "Mixed revision target begins plainly.",
            ].join("\n\n");
            view.dispatch({
                changes: { from: 0, insert: seed },
                annotations: Transaction.userEvent.of("input.type"),
            });
            view.dispatch({
                changes: { from: view.state.doc.length, insert: "\n\nPasted provenance sample." },
                annotations: Transaction.userEvent.of("input.paste"),
            });

            const humanTarget = "Human revision target begins plainly.";
            const humanFrom = view.state.doc.toString().indexOf(humanTarget);
            const humanVersions = [
                makeVersion({ doc: humanTarget, label: "Original", provenance: "human" }),
                makeVersion({
                    doc: "A human rewrote this revision.",
                    label: "Human rewrite",
                    provenance: "human",
                }),
            ];
            const humanRevision = {
                ...createNewAnnotation(
                    view.state.field(annotationField),
                    EditorSelection.single(humanFrom, humanFrom + humanTarget.length),
                    "revision",
                ),
                activeVersionId: humanVersions[0].id,
                versions: humanVersions,
            };
            view.dispatch({ effects: addAnnotation.of(humanRevision) });
            view.dispatch(
                setActiveRevisionVersion(view.state, humanRevision.id, humanVersions[1].id),
            );

            createRevision({
                targetText: "AI revision target begins plainly.",
                versions: [{ label: "AI rewrite", text: "AI rewrote this revision." }],
                threadMessage: "Generated for the provenance debug matrix.",
                author: "AI",
                view,
            });
            const aiRevisionId = latestRevisionId(view);
            if (aiRevisionId !== undefined) {
                const revision = view.state.field(annotationField)[aiRevisionId];
                if (revision && isAnnotationOfType(revision, "revision")) {
                    const aiVersion = revision.versions.find(
                        (version) => version.label === "AI rewrite",
                    );
                    if (aiVersion) {
                        view.dispatch(
                            setActiveRevisionVersion(view.state, revision.id, aiVersion.id),
                        );
                    }
                }
            }

            createRevision({
                targetText: "Mixed revision target begins plainly.",
                versions: [{ label: "AI draft", text: "AI drafted this mixed revision." }],
                threadMessage: "This AI version will receive a human edit.",
                author: "AI",
                view,
            });
            const mixedRevisionId = latestRevisionId(view);
            if (mixedRevisionId === undefined) return;
            let mixedRevision = view.state.field(annotationField)[mixedRevisionId];
            if (!mixedRevision || !isAnnotationOfType(mixedRevision, "revision")) return;
            const aiDraft = mixedRevision.versions.find((version) => version.label === "AI draft");
            if (!aiDraft) return;
            view.dispatch(setActiveRevisionVersion(view.state, mixedRevision.id, aiDraft.id));

            mixedRevision = view.state.field(annotationField)[mixedRevisionId];
            if (!mixedRevision || !isAnnotationOfType(mixedRevision, "revision")) return;
            const nestedHost = document.createElement("div");
            const nestedState = createNestedEditorState(
                activeVersion(mixedRevision),
                (update) => translateAndDispatch(update, view, mixedRevisionId),
                view,
                mixedRevisionId,
            );
            const nestedView = new EditorView({ state: nestedState, parent: nestedHost });
            const draftText = nestedView.state.doc.toString();
            const drafted = draftText.indexOf("drafted");
            if (drafted !== -1) {
                nestedView.dispatch({
                    changes: {
                        from: drafted,
                        to: drafted + "drafted".length,
                        insert: "drafted, then a human polished,",
                    },
                    annotations: Transaction.userEvent.of("input.type"),
                });
            }
            nestedView.destroy();
        },
    },

    {
        id: "single-comment",
        label: "Single comment",
        description: "One comment on a specific passage",
        category: "debug",
        group: "Comments",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            createComment({
                targetText: "the way a pianist touches keys before a concert",
                comment:
                    "Beautiful simile — consider whether it fits the character's background. Does the keeper have a musical history?",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "pending-comment",
        label: "Pending comment",
        description: "An empty comment annotation waiting for user input",
        category: "debug",
        group: "Comments",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            const state = view.state;
            const target = "Each one was different";
            const from = state.doc.toString().indexOf(target);
            if (from === -1) return;
            const to = from + target.length;
            view.dispatch(
                state.update({
                    effects: [
                        addAnnotation.of(
                            createNewAnnotation(
                                state.field(annotationField),
                                EditorSelection.single(from, to),
                                "comment",
                            ),
                        ),
                    ],
                }),
            );
        },
    },
    {
        id: "single-suggestion",
        label: "Single suggestion",
        description: "One suggestion with two replacement options",
        category: "debug",
        group: "Suggestions",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText:
                    "The old lighthouse keeper had watched storms roll in from the sea for forty years.",
                replacements: [
                    {
                        text: "For forty years, the lighthouse keeper had watched storms roll in from the sea.",
                        rationale: "Leads with time — creates immediacy",
                    },
                    {
                        text: "He had tended this lighthouse for forty years, long enough to know every shade of storm.",
                        rationale: "More intimate, emphasises his expertise",
                    },
                ],
                comment: "Opening sentence restructure options",
                author: "Editor",
            });
        },
    },
    {
        id: "single-revision",
        label: "Single revision",
        description: "One revision with two alternative versions",
        category: "debug",
        group: "Revisions",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            createRevision({
                targetText:
                    "running his fingers along the brass gears the way a pianist touches keys before a concert",
                versions: [
                    {
                        label: "Mechanical",
                        text: "feeling each gear tooth catch and release under his thumb, every part exactly where it should be",
                    },
                    {
                        label: "Sparse",
                        text: "checking each part by feel alone, as he had done a thousand times before",
                    },
                ],
                threadMessage:
                    "The simile is evocative but may feel out of register. Options: lean into mechanical precision, or strip back to something starker.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "mixed-annotations",
        label: "Mixed annotation types",
        description: "Comment, suggestion, and revision together",
        category: "debug",
        group: "Combinations & edge cases",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            createComment({
                targetText: "The fog had been thick all week",
                comment: "Good atmospheric setup for the stakes. Could come earlier in the piece.",
                author: "Editor",
                view,
            });
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "Each one was different",
                replacements: [{ text: "No two were alike", rationale: "More concise" }],
                author: "Editor",
            });
            createRevision({
                targetText: "the sky turning green and angry before the wind even picked up",
                versions: [
                    {
                        label: "Precise",
                        text: "the sky fading to the flat, yellowish-green that meant a fast-moving squall",
                    },
                    {
                        label: "Minimal",
                        text: "the sky changing colour hours before the wind shifted",
                    },
                ],
                threadMessage:
                    "Two directions: meteorologically specific, or pared back to imply the keeper's knowledge.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "linked-version-groups",
        label: "Linked version groups",
        description:
            "Three revisions whose 'Formal' versions are linked into one group and 'Casual' into another — switch any pill and the whole tone-set follows (#268)",
        category: "demo",
        group: "Linked versions",
        doc: DOC_ESSAY_DRAFT,
        setup(view) {
            // Three tonal revisions across the essay. Each gets an "Original"
            // version (prepended by createRevision) plus "Formal" and "Casual".
            // After each, capture the revision id so we can link by (id, label).
            const members: {
                formal: VersionGroupMember[];
                casual: VersionGroupMember[];
            } = { formal: [], casual: [] };

            const tonalRevisions = [
                {
                    targetText: "There is a particular cruelty in the way memory works",
                    formal: "Memory operates with a particular cruelty",
                    casual: "Memory plays a cruel trick on us",
                    note: "Opening claim — set the register for the whole piece.",
                },
                {
                    targetText: "Neuroscientists would tell you this is adaptive.",
                    formal: "The neuroscientific account holds that this asymmetry is adaptive.",
                    casual: "Scientists say there's a good reason for this.",
                    note: "Pivot to the scientific frame.",
                },
                {
                    targetText:
                        "the residue of feeling, stripped of the brittle scaffolding of fact",
                    formal: "the residuum of feeling, divested of the brittle scaffolding of fact",
                    casual: "the feeling that's left once the facts fall away",
                    note: "Closing image — should match the chosen tone.",
                },
            ];

            for (const r of tonalRevisions) {
                createRevision({
                    targetText: r.targetText,
                    versions: [
                        { label: "Formal", text: r.formal },
                        { label: "Casual", text: r.casual },
                    ],
                    threadMessage: r.note,
                    author: "Editor",
                    view,
                });
                const revId = latestRevisionId(view);
                if (revId === undefined) continue;
                const formal = memberByVersionLabel(view, revId, "Formal");
                const casual = memberByVersionLabel(view, revId, "Casual");
                if (formal) members.formal.push(formal);
                if (casual) members.casual.push(casual);
            }

            // Link the three Formals into one group and the three Casuals into
            // another. A group needs ≥2 members; guard in case a revision failed
            // to create (e.g. target text not found).
            if (members.formal.length >= 2) {
                const [m0, m1, ...rest] = members.formal;
                view.dispatch(createVersionGroup("Formal", [m0, m1, ...rest]).spec);
            }
            if (members.casual.length >= 2) {
                const [m0, m1, ...rest] = members.casual;
                view.dispatch(createVersionGroup("Casual", [m0, m1, ...rest]).spec);
            }
        },
    },
    {
        id: "multiple-suggestions",
        label: "Multiple suggestions",
        description: "Several suggestions across a passage — tests suggestion panel layout",
        category: "debug",
        group: "Suggestions",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "Each one was different",
                replacements: [
                    { text: "No two were alike", rationale: "Tighter phrasing" },
                    { text: "Each storm had its own character", rationale: "More evocative" },
                ],
                author: "Editor",
            });
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "the sky turning green and angry",
                replacements: [
                    {
                        text: "the sky bruising to a sickly green",
                        rationale: "More visual, avoids anthropomorphism",
                    },
                    {
                        text: "the horizon going the colour of old copper",
                        rationale: "Unique colour reference",
                    },
                ],
                author: "Editor",
            });
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "three ships were expected in the harbour before dawn",
                replacements: [
                    {
                        text: "three ships were due before first light",
                        rationale: "'First light' is more evocative",
                    },
                ],
                author: "Editor",
            });
        },
    },
    {
        id: "nested-revision",
        label: "Nested revision setup",
        description:
            "A revision whose text can hold nested annotations — open it then use Cmd+Alt+K inside",
        category: "debug",
        group: "Revisions",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            createRevision({
                targetText:
                    "running his fingers along the brass gears the way a pianist touches keys before a concert",
                versions: [
                    {
                        label: "Extended",
                        text: "running his fingers along the brass gears, feeling each tooth engage with the precision of something built to outlast its maker — the way a pianist runs scales before the hall fills",
                    },
                ],
                threadMessage:
                    "The original stops at the simile. This version follows the thought all the way through — the precision of the gears, the maker who built them to last, then the pianist. Worth seeing if the extra weight earns itself.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "adjacent-annotations",
        label: "Adjacent annotations",
        description: "Two annotations sharing an edge — tests highlight range boundaries",
        category: "debug",
        group: "Combinations & edge cases",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            createComment({
                targetText: "some crept in slowly",
                comment: "Pacing metaphor — nice.",
                author: "Editor",
                view,
            });
            createComment({
                targetText: "giving him hours to prepare",
                comment: "What does 'prepare' involve? Worth showing.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "overlapping-suggestion-revision",
        label: "Overlapping suggestion + revision",
        description: "Suggestion and revision whose target text overlaps — tests conflict display",
        category: "debug",
        group: "Combinations & edge cases",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "the way a pianist touches keys before a concert",
                replacements: [
                    {
                        text: "the way a surgeon checks instruments before an operation",
                        rationale: "Shifts register toward precision",
                    },
                ],
                comment: "The pianist simile may be too gentle for this context.",
                author: "Copy Editor",
            });
            createRevision({
                targetText:
                    "running his fingers along the brass gears the way a pianist touches keys before a concert",
                versions: [
                    {
                        label: "All mechanical",
                        text: "running his fingers along the brass gears, counting each tooth by feel",
                    },
                ],
                threadMessage:
                    "The whole clause could go a different direction — drop the simile entirely.",
                author: "Developmental Editor",
                view,
            });
        },
    },
    {
        id: "suggestion-single-option",
        label: "Suggestion — one option only",
        description: "A suggestion with exactly one replacement — tests single-option UI state",
        category: "debug",
        group: "Suggestions",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "three ships were expected in the harbour before dawn",
                replacements: [
                    {
                        text: "three ships were due before dawn",
                        rationale: "Strips 'in the harbour' — the context implies it",
                    },
                ],
                comment: "Tighten.",
                author: "Editor",
            });
        },
    },
    {
        id: "dense-annotations",
        label: "Dense annotations",
        description: "Many annotations — tests layout, panel overflow, and highlight layering",
        category: "debug",
        group: "Combinations & edge cases",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            const passages = [
                { text: "forty years", comment: "Establishes experience without backstory." },
                { text: "some crept in slowly", comment: "Nice contrast. Could expand." },
                {
                    text: "giving him hours to prepare",
                    comment: "What does preparation look like?",
                },
                { text: "the sky turning green", comment: "Meteorologically accurate." },
                {
                    text: "angry before the wind even picked up",
                    comment: "Colour change precedes wind shift — correct.",
                },
                {
                    text: "checked the lamp mechanism",
                    comment: "Action shows routine without stating it.",
                },
            ];
            for (const { text, comment } of passages) {
                try {
                    createComment({ targetText: text, comment, author: "Editor", view });
                } catch {
                    // Skip if text not found after previous annotations shifted ranges
                }
            }
        },
    },
    {
        id: "revision-long-versions",
        label: "Revision — long alternatives",
        description:
            "A revision with verbose alternatives — tests card expansion and text overflow",
        category: "debug",
        group: "Revisions",
        doc: DOC_ESSAY_DRAFT,
        setup(view) {
            createRevision({
                targetText:
                    "Neuroscientists would tell you this is adaptive. Negative events are encoded more strongly because they carry survival information. The brain is not sentimental; it is practical. It keeps the ledger of dangers, not the ledger of joys.",
                versions: [
                    {
                        label: "Academic",
                        text: "The neuroscientific literature refers to this as 'negativity bias': the tendency for negative stimuli to elicit stronger cognitive and emotional responses than equally intense positive stimuli. From an evolutionary perspective, this asymmetry is adaptive — organisms that encoded threats more strongly than rewards were more likely to survive.",
                    },
                    {
                        label: "Essayistic",
                        text: "There is a word for this: negativity bias. It is one of the more useful pieces of psychological terminology to enter general circulation, because it names something we already know. The bad stays. The good fades. Not because we are broken but because we are, in the most literal sense, built for survival rather than happiness.",
                    },
                    {
                        label: "Strip back",
                        text: "There's a name for this: negativity bias. The brain encodes bad things more strongly than good ones. It is practical, not sentimental.",
                    },
                ],
                threadMessage:
                    "Three directions: academic (signals rigor), essayistic (maintains voice), or stripped back (trusts the personal material to carry the argument).",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "comment-long-thread",
        label: "Comment — long annotation text",
        description: "A comment with a very long message — tests card height and text wrapping",
        category: "debug",
        group: "Comments",
        doc: DOC_NOVEL_OPENING,
        setup(view) {
            createComment({
                targetText: "She wasn't sure this would be the worse outcome.",
                comment:
                    "This line is doing the most important work in the opening and I want to flag it carefully. On first read it lands as dark humour — the idea that mistakenly entering someone else's life might be preferable to the life she's actually arriving for. That reading is supported by everything that precedes it: the careful folding of the letter, the over-detailed directions from her cousin, the sense that Elena is following instructions she didn't write.\n\nBut 'worse' is doing a lot of work here. It implies there's a 'bad' outcome already in place — that the life she's moving toward is a loss she's already accepted. That's a significant revelation to make in six words on page one.\n\nTwo questions: (1) Is this intentional? If so, consider whether the rest of the opening earns this weight, or whether it arrives too early. (2) If the darkness is meant to be lightly worn, the word 'worse' might be too precise — a reader will catch it on first pass and it will colour everything that follows.",
                author: "Developmental Editor",
                view,
            });
        },
    },

    // ── DEMO — polished, realistic editorial scenarios ─────────────────────────

    {
        id: "demo-novel-opening",
        label: "Novel opening review",
        description:
            "Full editorial pass on a novel's first page — structural notes, line suggestions, and two competing directions for the key beat",
        category: "demo",
        group: "Editorial sessions",
        doc: DOC_NOVEL_OPENING,
        setup(view) {
            createComment({
                targetText:
                    "The morning Elena arrived in Kraków, the city was doing what it did best: pretending nothing had changed.",
                comment:
                    "This is the right kind of opening line — it makes a claim so specific and slightly strange ('pretending') that the reader has to follow. The colon is load-bearing: it promises that the city's performance is about to be demonstrated, and the next three paragraphs deliver exactly that. The only risk is that the irony is so controlled it might feel distanced. Worth tracking as you develop Elena's interiority.",
                author: "Developmental Editor",
                view,
            });

            createComment({
                targetText:
                    "A boy with a school satchel too large for his frame was chasing pigeons near the fountain — getting nowhere, as pigeons tend to ensure.",
                comment:
                    "Keep this exactly. The parenthetical voice ('as pigeons tend to ensure') does three things at once: establishes the narrator's dry register, signals that this will be a book with some wit, and shows the world going about its business regardless of Elena. It's also the first moment where the city's 'pretending nothing has changed' is illustrated rather than stated.",
                author: "Developmental Editor",
                view,
            });

            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText:
                    "The letter from her cousin was folded into quarters in her coat pocket. She had read it so many times the crease lines had gone white.",
                replacements: [
                    {
                        text: "In her coat pocket: the letter from her cousin, folded into quarters, its crease lines gone white from reading.",
                        rationale:
                            "The colon and fragment form slow the reader — mirrors Elena standing still in the square while the city moves around her",
                    },
                    {
                        text: "The letter from her cousin was in her coat pocket, folded and refolded until the paper had gone soft at the creases.",
                        rationale:
                            "'Refolded' introduces the compulsive repetition that 'read it so many times' already implies — but 'gone soft at the creases' is more physical and more poignant than 'gone white'",
                    },
                ],
                comment:
                    "Two sentences where one would do. The second sentence ('She had read it so many times the crease lines had gone white') is the better of the two — consider whether you need the first at all, or can fold the location into the second.",
                author: "Copy Editor",
            });

            createRevision({
                targetText: "She wasn't sure this would be the worse outcome.",
                versions: [
                    {
                        label: "Drier",
                        text: "She had considered this.",
                    },
                    {
                        label: "Gentler",
                        text: "She had thought about this more than she wanted to admit.",
                    },
                ],
                threadMessage:
                    "This is the most important line in the opening and it's almost right. The problem is 'worse' — it implies there's already a 'bad' outcome established, which asks the reader to do work they haven't been prepared for yet. 'She had considered this' is riskier (it trusts the reader to understand what 'this' is) but it lands without requiring explanation. 'More than she wanted to admit' is warmer but loses the dark comedy. I'd try the dry version for a full draft before deciding.",
                author: "Developmental Editor",
                view,
            });

            createComment({
                targetText:
                    "The trams continued. The flower sellers arranged. The boy with the too-large satchel finally gave up on the pigeons",
                comment:
                    "The anaphora ('The trams continued. The flower sellers arranged.') is working — it echoes the opening paragraph's catalogue of the city's business-as-usual. But 'arranged' needs an object. 'Arranged their buckets' appeared in paragraph two; repeating the full phrase here would create an intentional echo. Without the object, it reads as an error rather than a stylistic choice.",
                author: "Copy Editor",
                view,
            });
        },
    },

    {
        id: "demo-memoir",
        label: "Memoir — voice and intimacy",
        description:
            "Editorial session on a personal essay: voice consistency, structural rhythm, and one key revision decision",
        category: "demo",
        group: "Editorial sessions",
        doc: DOC_MEMOIR_EXCERPT,
        setup(view) {
            createComment({
                targetText: "My mother was a woman who did not believe in photographs.",
                comment:
                    "Exceptional. The strangeness of 'did not believe in' — as though photographs were a religion or a political position — immediately signals that this is a mother worth understanding. The sentence also sets up the essay's argumentative structure: a claim that seems like a character quirk will turn out to be something larger. Don't change a word, but be aware that the rest of the essay has to earn this opener.",
                author: "Editor",
                view,
            });

            createComment({
                targetText:
                    "If you asked her why, she said: I was there. I don't need to see it again.",
                comment:
                    "The mother's voice enters the essay here for the first time, in two short sentences that are basically a complete philosophy. 'I was there' as its own sentence is particularly good — it claims a form of presence that photographs don't offer. The colon is doing the right work: it introduces the quotation without the fuss of quotation marks, which would make it feel more like testimony than memory. I'd keep this exactly as is, including the lack of quote marks.",
                author: "Editor",
                view,
            });

            createRevision({
                targetText:
                    "I used to think this was a kind of arrogance. Now I think it was the opposite — a form of grief management so efficient it had become a personality.",
                versions: [
                    {
                        label: "Compress",
                        text: "I used to think this was arrogance. Now I think it was the opposite: grief management so efficient it had become a personality.",
                    },
                    {
                        label: "Expand",
                        text: "I used to think this was a kind of arrogance — a refusal to be sentimental, or more precisely, a refusal to be caught being sentimental. Now I think it was the opposite. A form of grief management so thorough and so practiced that it had stopped being a strategy and become a self.",
                    },
                ],
                threadMessage:
                    "'A form of grief management so efficient it had become a personality' is the essay's thesis statement, whether you mean it to be or not. It's also the best sentence here. The question is what register surrounds it. Compressing the reversal ('I used to think / Now I think') makes it land faster and drier, which fits the mother's own temperament. Expanding it lets the reader sit with the distinction between 'strategy' and 'self,' which is actually a more interesting claim. I lean toward the expanded version but it depends on how much the essay develops this idea later.",
                author: "Editor",
                view,
            });

            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText:
                    "one from a holiday in Majorca in 1987 where she is squinting into the sun and cannot be identified from the others in the group without someone to point her out",
                replacements: [
                    {
                        text: "one from a holiday in Majorca in 1987 — she is squinting into the sun, indistinguishable from the others without someone to point her out",
                        rationale:
                            "Em-dash separates the fact from the observation; 'indistinguishable' is sharper than 'cannot be identified'",
                    },
                    {
                        text: "one from Majorca, 1987, where she is squinting into the sun and could be anyone",
                        rationale:
                            "'Could be anyone' is more resonant — the point isn't that she needs identifying, it's that the photo fails to capture her specifically",
                    },
                ],
                comment:
                    "The relative clause is too long and buries the observation. The real point is that photographs fail to capture her — they make her anonymous rather than present. The second option makes this the point rather than a description.",
                author: "Editor",
            });

            createComment({
                targetText: "the only one where she looks like herself",
                comment:
                    "This is perfect and you know it. 'Looks like herself' does something that 'looks natural' or 'looks happy' can't — it implies that all the other photographs are a kind of misrepresentation, which retroactively confirms the mother's philosophy. Keep it understated. The reader will feel the weight.",
                author: "Editor",
                view,
            });

            createComment({
                targetText: "I am now forty-two.",
                comment:
                    "The age match lands exactly because you've placed it as an afterthought — the period after 'She is forty-one' does all the work of the pause before the revelation. The reader completes the thought before the sentence does. This is precisely the right way to handle this kind of biographical echo: state it flatly, don't explain it, let it sit.",
                author: "Editor",
                view,
            });
        },
    },

    {
        id: "demo-dialogue",
        label: "Fiction dialogue — subtext",
        description:
            "Line edit on a scene with difficult subtext: rhythm, what's said vs unsaid, and the closing beat",
        category: "demo",
        group: "Editorial sessions",
        doc: DOC_FICTION_DIALOGUE,
        setup(view) {
            createComment({
                targetText:
                    "James knew because he had been watching the clock on the dashboard, not because he wanted to know the time, but because looking at the clock was something to do that wasn't looking at her.",
                comment:
                    "The double 'because' construction earns its length here. What it's really saying is: he needed somewhere to put his eyes, and the clock was available. That's the whole subtext of the scene made physical, in the first paragraph. The sentence is doing a lot and not showing the effort. Good.",
                author: "Editor",
                view,
            });

            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: '"You should have told me," Cara said finally.',
                replacements: [
                    {
                        text: 'Cara spoke first. "You should have told me."',
                        rationale:
                            "'Spoke first' acknowledges the silence without naming its duration; dropping 'finally' trusts the reader to feel the eleven minutes",
                    },
                ],
                comment:
                    "'Said finally' names what you've already shown — eleven minutes of silence, already established. The reader has already felt 'finally'; saying it again deflates it. Cut the adverb and let the silence do the work.",
                author: "Editor",
            });

            createComment({
                targetText:
                    '"Not — " She stopped. Started again. "Not because I would have done anything differently. I don\'t think I would have. But I should have known."',
                comment:
                    "The interrupted speech is right but slightly over-punctuated. The em-dash already signals the stop; 'She stopped' restates it. 'Started again' is the keeper — that's the beat you want. Try: '\"Not —\" She started again. \"Not because I would have done anything differently.\"' The repetition of 'Not' at the start of both fragments is very good — it sounds like someone finding their way into a sentence.",
                author: "Editor",
                view,
            });

            createRevision({
                targetText:
                    "Outside, a man was walking a very small dog with great seriousness, as though the dog were a matter of considerable importance.",
                versions: [
                    {
                        label: "Trust the image",
                        text: "Outside, a man was walking a very small dog with great seriousness.",
                    },
                    {
                        label: "Different angle",
                        text: "Outside, a man was walking a very small dog. He had the focused expression of someone who had somewhere important to be.",
                    },
                ],
                threadMessage:
                    "The external-world beat is necessary here — the scene needs air. But 'as though the dog were a matter of considerable importance' explains the joke, which kills it. 'A very small dog with great seriousness' is already funny; the comparison clause is the author laughing at their own joke. The 'different angle' version shifts from the dog to the man's expression, which is slightly warmer and slightly less smug — might fit better depending on the narrator's overall register.",
                author: "Editor",
                view,
            });

            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "James considered this carefully, which was perhaps already an answer.",
                replacements: [
                    {
                        text: "James considered this. Which was, perhaps, already an answer.",
                        rationale:
                            "The fragment form gives the observation room to land; the commas around 'perhaps' slow the reader down at exactly the right moment",
                    },
                ],
                comment:
                    "Best observation in the scene. 'Which was perhaps already an answer' is the whole scene in a clause — the pause as communication, hesitation as confession. Separate it from 'James considered this' and let it breathe as its own fragment. The reader will stop.",
                author: "Editor",
            });

            createComment({
                targetText: "It sounded like the middle.",
                comment:
                    "This is the right ending and you found it. 'The middle' carries everything the scene withholds: not resolution, not rupture, but the long work of people staying in a room together after something has been said. It also echoes the opening — they were already in the middle of something when the scene began. Don't revise.",
                author: "Editor",
                view,
            });
        },
    },

    {
        id: "demo-short-story",
        label: "Short story — line edit",
        description:
            "A close line edit on a complete short story: rhythm, word-level precision, and voice consistency",
        category: "demo",
        group: "Editorial sessions",
        doc: DOC_SHORT_STORY,
        setup(view) {
            createComment({
                targetText: "Inventory",
                comment:
                    "Title earns its place — 'inventory' carries both the bureaucratic register of the list and the elegiac weight of an accounting. It also does something quiet: it implies that what follows is a document of what's been lost, not a story about someone who makes lists. That's the right implication. No notes.",
                author: "Editor",
                view,
            });

            createComment({
                targetText: "Marcus kept a list of everything he had ever lost.",
                comment:
                    "This is the story in one sentence. It declares the form (a list), the character (someone who converts loss into record-keeping), and the theme (the relationship between losing and accounting for loss). Everything that follows is contained here. The economy is perfect — 'kept' rather than 'made' or 'started' is the right verb, because it implies duration and maintenance rather than a single act. Nothing to change.",
                author: "Editor",
                view,
            });

            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "It began, as these things often do, as a joke.",
                replacements: [
                    {
                        text: "It started as a joke.",
                        rationale:
                            "Strips the narrator's aside entirely — the story demonstrates this without needing to say it",
                    },
                    {
                        text: "It began as a joke, as these things do.",
                        rationale:
                            "Drops 'often' — the aside reads as more knowing and less apologetic without it",
                    },
                ],
                comment:
                    "'As these things often do' is the story gesturing at its own genre before it's earned the right to. The narrator's warmth and self-awareness are real qualities of this prose — but here they arrive before the story has shown us Marcus, which means they read as throat-clearing rather than voice. The first option is the cleaner fix; the second keeps the aside but makes it drier.",
                author: "Editor",
            });

            createComment({
                targetText: "He lost a phone once in a lake, which felt like an escalation.",
                comment:
                    "The best line in the story, and possibly the best sentence you've written. 'Which felt like an escalation' works because it doesn't explain itself — it trusts the reader to understand that losing objects to bodies of water is a categorically different kind of loss than leaving a scarf on a bench. The understatement ('felt like') is exactly right: Marcus registering something without quite confronting it. Don't touch this.",
                author: "Editor",
                view,
            });

            createRevision({
                targetText:
                    "He lost touch with people. He listed them too, eventually, when the habit had spread to fill all the available containers in his life.",
                versions: [
                    {
                        label: "Stripped",
                        text: "He listed people too, eventually.",
                    },
                    {
                        label: "Trim",
                        text: "He lost touch with people. He listed them too, when the habit had spread far enough.",
                    },
                ],
                threadMessage:
                    "This is the story's pivot — the moment the list expands from objects to people — and it's slightly over-written. 'Fill all the available containers in his life' is a good phrase but it comes after sixteen paragraphs of precision, and it sticks out as effortful. The stripped version ('He listed people too, eventually.') earns a full stop and a paragraph break; the abruptness is the point. The trimmed version keeps 'He lost touch with people' as a setup sentence, which may be necessary if you want the reader to understand the order (losing touch first, then listing) rather than assuming it.",
                author: "Editor",
                view,
            });

            createRevision({
                targetText:
                    "But the list had its own logic by then, and stopping it would have felt like a different kind of loss.",
                versions: [
                    {
                        label: "Drop 'but'",
                        text: "The list had its own logic by then. Stopping it would have felt like a different kind of loss.",
                    },
                    {
                        label: "Em-dash",
                        text: "But the list had its own logic by then — stopping it would have felt like a different kind of loss.",
                    },
                ],
                threadMessage:
                    "The story ends on the right note but the punctuation isn't quite there. 'And' is additive — it connects two equal things — but what you want is something more like consequence or inevitability. The em-dash version makes 'stopping it would have felt like a different kind of loss' read as the natural conclusion of the list having its own logic, which is correct. Dropping 'but' entirely makes the ending quieter and removes the slight defensiveness of 'but the list had its own logic' (as if anticipating objections). Both are improvements; the em-dash version is the stronger close.",
                author: "Editor",
                view,
            });
        },
    },

    // ── Screenshot scenarios (Dickens) ────────────────────────────────────────
    // Used by scripts/screenshots.ts via window.__runScenario__. These mirror
    // the debug scenarios above but operate on the Dickens passage so the
    // annotations match the text already loaded into the editor.

    {
        id: "screenshot-comment-thread",
        label: "Screenshot: comment thread (Dickens)",
        description:
            "A comment with a multi-message back-and-forth thread — click the yellow highlight to expand",
        category: "debug",
        group: "Screenshot & video fixtures",
        doc: DICKENS_DOC,
        setup(view) {
            const state = view.state;
            const target = "it was the age of wisdom, it was the age of foolishness";
            const from = state.doc.toString().indexOf(target);
            if (from === -1) return;
            const to = from + target.length;
            const selection = EditorSelection.create([EditorSelection.range(from, to)]);
            view.dispatch(
                state.update({
                    effects: [
                        addAnnotation.of({
                            ...createNewAnnotation(
                                state.field(annotationField),
                                selection,
                                "comment",
                            ),
                            thread: [
                                {
                                    message:
                                        "The parallelism here is doing a lot of heavy lifting. Worth asking: does the accumulation land, or does it tip into self-parody by the end of the sentence?",
                                    author: "Editor",
                                    time: Date.now() - 3600_000,
                                },
                                {
                                    message:
                                        "I think it lands — the rhythm is the point. Dickens is parodying the era, not the writing. The excess is the argument.",
                                    author: "User",
                                    time: Date.now() - 1800_000,
                                },
                                {
                                    message:
                                        "Agreed. In that case, protect it — editors who trim this on instinct are missing the rhetorical intent. Leave a note in the manuscript.",
                                    author: "Editor",
                                    time: Date.now() - 900_000,
                                },
                            ],
                        }),
                    ],
                }),
            );
            // Also add a second comment nearby so the panel feels populated
            createComment({
                targetText: "it was the spring of hope, it was the winter of despair",
                comment:
                    "Seasonal contrast is effective but well-worn. The force here is cumulative — don't pull it forward or it loses context.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "screenshot-revision-active",
        label: "Screenshot: revision active (Dickens)",
        description:
            "A revision annotation ready to be activated — click the purple highlight in the editor",
        category: "debug",
        group: "Screenshot & video fixtures",
        doc: DICKENS_DOC,
        setup(view) {
            createRevision({
                targetText:
                    "Spiritual revelations were conceded to England at that favoured period, as at this.",
                versions: [
                    {
                        label: "Active voice",
                        text: "England received its spiritual revelations at that favoured period, as it does now.",
                    },
                    {
                        label: "Compressed",
                        text: "Spiritual revelations visited England then, as now.",
                    },
                ],
                threadMessage:
                    "The passive voice feels period-appropriate but distances the reader. Two alternatives: activate the grammar, or compress ruthlessly.",
                author: "Editor",
                view,
            });
            // A comment alongside so the panel isn't empty
            createComment({
                targetText: "it was the season of Light, it was the season of Darkness",
                comment:
                    "Capitalisation is deliberate — Light and Darkness as proper nouns lend them allegorical weight. Don't normalise.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "video-rain-revision-active",
        label: "Video: rain revision active",
        description: "Rain micro-story with matching active and compressed alternatives",
        category: "debug",
        group: "Screenshot & video fixtures",
        doc: VIDEO_RAIN_DOC,
        setup(view) {
            createRevision({
                targetText: "The rain found her beneath the station clock",
                versions: [
                    {
                        label: "Active voice",
                        text: "Rain found her beneath the station clock",
                    },
                    {
                        label: "Compressed",
                        text: "Rain found her at the station",
                    },
                ],
                threadMessage:
                    "Keep the discovery, then decide how much atmosphere the sentence should carry.",
                author: "Editor",
                view,
            });
        },
    },
    // ── Screenshot: doubly-nested revision modal ──────────────────────────────
    // Used by scripts/screenshots.ts to show a revision modal open over the main
    // editor, with a second inner revision ready to be expanded into its own modal.
    {
        id: "screenshot-nested-revision",
        label: "Screenshot: nested revision (Lighthouse Keeper)",
        description:
            "Outer revision open in modal with an inner revision ready to expand — used by the screenshot script",
        category: "debug",
        group: "Screenshot & video fixtures",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            createRevision({
                targetText:
                    "running his fingers along the brass gears the way a pianist touches keys before a concert",
                versions: [
                    {
                        label: "Extended",
                        text: "running his fingers along the brass gears, feeling each tooth engage with the precision of something built to outlast its maker — the way a pianist runs scales before the hall fills",
                    },
                    {
                        label: "Spare",
                        text: "running his fingers along the brass gears the way a pianist warms up before the lights come down",
                    },
                ],
                threadMessage:
                    "The original simile is doing real work but it stops too soon. 'Extended' follows it further; 'Spare' trades the pianist for something quieter. Both drop the 'before a concert' ending, which lands a bit neat.",
                author: "Editor",
                view,
            });
        },
    },
    // ── Screenshot: inline nested editor with sub-revision ──────────────────
    // Used by scripts/screenshots.ts to show the inline nested editor open
    // inside a revision card, with a second revision annotation visible inside
    // the nested editor — demonstrating infinite nesting in the inline view.
    {
        id: "screenshot-inline-nested-revision",
        label: "Screenshot: inline nested revision (Lighthouse Keeper)",
        description:
            "Revision with long version text ready for a sub-revision inside the inline nested editor — used by the screenshot script",
        category: "debug",
        group: "Screenshot & video fixtures",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            createRevision({
                targetText:
                    "running his fingers along the brass gears the way a pianist touches keys before a concert. Everything had to work tonight.",
                versions: [
                    {
                        label: "Extended",
                        text: "running his fingers along the brass gears, feeling each tooth engage with the precision of something built to outlast its maker — the way a pianist runs scales before the hall fills. Everything had to work tonight.",
                    },
                    {
                        label: "Spare",
                        text: "running his fingers along the brass gears one final time. Everything had to work tonight.",
                    },
                ],
                threadMessage:
                    "The original simile is evocative but could go further. 'Extended' builds out the tactile detail and earns the pianist comparison; 'Spare' strips back to pure function.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "video-rain-inline-nested-revision",
        label: "Video: rain inline nested revision",
        description: "Rain micro-story with an expanded version ready for a nested revision",
        category: "debug",
        group: "Screenshot & video fixtures",
        doc: VIDEO_RAIN_DOC,
        setup(view) {
            createRevision({
                targetText:
                    "The rain found her beneath the station clock, coat darkened at the shoulders, one hand closed around a letter she had not opened.",
                versions: [
                    {
                        label: "Expanded",
                        text: "The rain found her beneath the station clock, her rain-dark coat shining under the lamps, one hand closed around a letter she had not opened.",
                    },
                    {
                        label: "Spare",
                        text: "Rain found her at the station, holding a sealed letter.",
                    },
                ],
                threadMessage:
                    "The expanded version keeps the weather in the room; the spare version protects the mystery.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "screenshot-annotations-no-ai",
        label: "Screenshot: annotations without AI (Dickens)",
        description: "Comment and revision only — no AI suggestion — used by the screenshot script",
        category: "debug",
        group: "Screenshot & video fixtures",
        doc: DICKENS_DOC,
        setup(view) {
            createComment({
                targetText: "it was the age of wisdom, it was the age of foolishness",
                comment:
                    "The parallelism is relentless here — intentional, but consider whether one more beat pushes it past the tipping point into self-parody.",
                author: "Editor",
                view,
            });
            createRevision({
                targetText:
                    "Spiritual revelations were conceded to England at that favoured period, as at this.",
                versions: [
                    {
                        label: "Active",
                        text: "England received its spiritual revelations at that favoured period, as it does now.",
                    },
                    {
                        label: "Compressed",
                        text: "Spiritual revelations visited England then, as now.",
                    },
                ],
                threadMessage:
                    "The passive voice feels period-appropriate but distances the reader. Two alternatives: activate the grammar, or compress ruthlessly.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "screenshot-annotations",
        label: "Screenshot: annotations (Dickens)",
        description:
            "Mixed annotations on the A Tale of Two Cities passage — used by the screenshot script",
        category: "debug",
        group: "Screenshot & video fixtures",
        doc: DICKENS_DOC,
        setup(view) {
            createComment({
                targetText: "it was the age of wisdom, it was the age of foolishness",
                comment:
                    "The parallelism is relentless here — intentional, but consider whether one more beat pushes it past the tipping point into self-parody.",
                author: "Editor",
                view,
            });
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText:
                    "we were all going direct to Heaven, we were all going direct the other way",
                replacements: [
                    {
                        text: "we were all going directly to Heaven, and all going directly the other way",
                        rationale: "Loosens the inversion slightly for modern readers",
                    },
                    {
                        text: "all going direct to Heaven, all going direct the other way",
                        rationale: "Drop 'we were' for tighter parallelism",
                    },
                ],
                author: "Editor",
            });
            createRevision({
                targetText:
                    "Spiritual revelations were conceded to England at that favoured period, as at this.",
                versions: [
                    {
                        label: "Active",
                        text: "England received its spiritual revelations at that favoured period, as it does now.",
                    },
                    {
                        label: "Compressed",
                        text: "Spiritual revelations visited England then, as now.",
                    },
                ],
                threadMessage:
                    "The passive voice feels period-appropriate but distances the reader. Two alternatives: activate the grammar, or compress ruthlessly.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "screenshot-dense",
        label: "Screenshot: dense annotations (Dickens)",
        description: "Several comments across the Dickens passage for the full-ui screenshot",
        category: "debug",
        group: "Screenshot & video fixtures",
        doc: DICKENS_DOC,
        setup(view) {
            const passages = [
                {
                    text: "it was the worst of times",
                    comment:
                        "The inversion here is the engine of the whole opening — worth protecting.",
                },
                {
                    text: "it was the season of Darkness",
                    comment:
                        "Capitalisation is deliberate and correct for Dickens; don't normalise.",
                },
                {
                    text: "the spring of hope, it was the winter of despair",
                    comment:
                        "Seasonal contrast lands well. Note that hope/spring and despair/winter are well-worn — the force here is accumulation, not novelty.",
                },
                {
                    text: "a king with a large jaw",
                    comment:
                        "The physical detail is satirical caricature — makes both monarchs ridiculous, which is the point.",
                },
                {
                    text: "arrangements were made for the swallowing up of London and Westminster",
                    comment:
                        "Bathetic climax — the grand apocalyptic image undercut by bureaucratic phrasing. Very much intentional.",
                },
            ];
            for (const { text, comment } of passages) {
                try {
                    createComment({ targetText: text, comment, author: "Editor", view });
                } catch {
                    // Skip if text not found after previous annotations shifted ranges
                }
            }
        },
    },

    // ── Screenshot: AutoAI widget ─────────────────────────────────────────────
    // Used by scripts/screenshots.ts to show the AutoAI collaborator bubble
    // with its config popover open and the rainbow active state.
    {
        id: "screenshot-autoai-widget",
        label: "Screenshot: AutoAI widget (Dickens)",
        description:
            "AutoAI collaborator bubble with popover open — shows the feature in its active state",
        category: "debug",
        group: "Screenshot & video fixtures",
        doc: DICKENS_DOC,
        setup(view) {
            // Add a few annotations to show AutoAI already did some work
            createComment({
                targetText: "it was the age of wisdom, it was the age of foolishness",
                comment:
                    "The relentless parallelism is deliberate — the accumulation is the argument. Protect this structure.",
                author: "Auto",
                view,
            });
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText:
                    "we were all going direct to Heaven, we were all going direct the other way",
                replacements: [
                    {
                        text: "all going direct to Heaven, all going direct the other way",
                        rationale:
                            "Dropping 'we were' tightens the parallel and sharpens the irony",
                    },
                ],
                author: "Auto",
            });
        },
    },

    // ── Screenshot: full UI (original prose) ──────────────────────────────────
    // Used by scripts/screenshots.ts for the hero/marketing screenshot.
    // Shows the AI chat sidebar open alongside all three annotation types
    // in a realistic editorial session.
    {
        id: "screenshot-full-ui",
        label: "Screenshot: full UI (original prose)",
        description:
            "Hero screenshot — AI chat sidebar + comment, revision, and comment-with-thread on a short original passage",
        category: "debug",
        group: "Screenshot & video fixtures",
        doc: `The café had emptied out by the time she noticed the letter. It was propped against the salt shaker, her name written in handwriting she didn't recognise — careful, unhurried, like someone who had practised saying something difficult.

She had been walking for hours when the rain began — gently at first, then all at once, the way grief arrives without warning or ceremony. By the time she reached the corner of Elm and Fifth, her coat was soaked through and she had stopped noticing. The city kept moving around her the way it always did, indifferent and bright.

She ordered another coffee she wouldn't finish. The letter stayed where it was.

Outside, a man walked his dog in the rain. The dog did not seem to mind.`,
        setup(view) {
            createComment({
                targetText: "emptied out",
                comment: 'Too casual? "grown quiet" might land better.',
                author: "Elena",
                view,
            });
            createRevision({
                targetText:
                    "the rain began — gently at first, then all at once, the way grief arrives without warning or ceremony",
                versions: [
                    {
                        label: "then all at once...",
                        text: "the rain came — first gently, then all at once, the way grief tends to arrive",
                    },
                ],
                threadMessage:
                    "The second half is the stronger image. Consider cutting 'without warning or ceremony' — the reader already feels it.",
                author: "Elena",
                view,
            });
            createComment({
                targetText: "The letter stayed where it was.",
                comment: "This is the best line in the chapter.",
                author: "Elena",
                view,
            });
        },
    },

    // ── SCREENSHOT — persona-authored annotations ────────────────────────────

    {
        id: "screenshot-persona-annotations",
        label: "Screenshot: persona annotations (Dickens)",
        description:
            "Annotations authored by different reader personas — used by the screenshot script to show emoji-in-colored-circle avatars",
        category: "debug",
        group: "Screenshot & video fixtures",
        doc: DICKENS_DOC,
        setup(view) {
            createComment({
                targetText: "it was the age of wisdom, it was the age of foolishness",
                comment:
                    'The parallelism is effective but you\'re asking the reader to trust that every pair earns its place. Does "foolishness" pull enough weight opposite "wisdom"? It feels like the weaker half.',
                author: "Skeptical Editor",
                view,
            });
            createComment({
                targetText: "the season of Light, it was the season of Darkness",
                comment:
                    "Capitalising Light and Darkness signals allegory, but the rest of the sentence stays concrete. A first-time reader might wonder whether you've shifted registers mid-sentence.",
                author: "First-Time Reader",
                view,
            });
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText:
                    "we were all going direct to Heaven, we were all going direct the other way",
                replacements: [
                    {
                        text: "we were all headed straight for Heaven, and equally straight the other way",
                        rationale:
                            '"Direct" reads as archaic — modernise without losing the symmetry',
                    },
                ],
                author: "Clarity Coach",
            });
            createRevision({
                targetText:
                    "Spiritual revelations were conceded to England at that favoured period, as at this.",
                versions: [
                    {
                        label: "Active voice",
                        text: "England received its spiritual revelations at that favoured period, as it does now.",
                    },
                ],
                threadMessage:
                    "The passive voice distances the reader emotionally. This sentence should land with more weight — it's setting up the satirical payoff.",
                author: "Emotional Reader",
                view,
            });
        },
    },

    // ── DEBUG — privacy nudge for ellipsis stripping ─────────────────────────
    {
        id: "ellipsis-privacy-nudge",
        label: "Ellipsis privacy nudge",
        description:
            "Simulates an AI returning truncated targetText (with trailing ellipsis). " +
            "A privacy-nudge toast should appear with an incident code and an 'Open Settings' button. " +
            "TODO(#191): restore shareDocumentAnalytics branch when document sharing is re-enabled.",
        category: "debug",
        group: "Privacy & safety",
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            // The AI returned "the way a pianist touches keys..." but the real
            // text is "the way a pianist touches keys before a concert" — the
            // ellipsis-stripping fallback will fire.
            createComment({
                targetText: "the way a pianist touches keys...",
                comment:
                    "This simile is vivid — consider whether it draws too much attention away from the urgency of the storm.",
                author: "AI",
                view,
            });
        },
    },
];
