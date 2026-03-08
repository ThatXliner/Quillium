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
 * To add a new scenario: append an entry to the `scenarios` array.
 */

import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { createComment, createSuggestion, createRevision } from "$lib/editor/plugins/annotations";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation } from "$lib/editor/plugins/annotations/models";

export type ScenarioCategory = "debug" | "demo";

export type Scenario = {
    id: string;
    label: string;
    description: string;
    category: ScenarioCategory;
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

// Public domain — A Tale of Two Cities (Dickens), used by the screenshot script
const DICKENS_DOC = `It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair.

We had everything before us, we had nothing before us, we were all going direct to Heaven, we were all going direct the other way. There were a king with a large jaw and a queen with a plain face, on the throne of England; there were a king with a large jaw and a queen with a fair face, on the throne of France.

It was the year of Our Lord one thousand seven hundred and seventy-five. Spiritual revelations were conceded to England at that favoured period, as at this. Mrs. Southcott had recently attained her five-and-twentieth blessed birthday, of whom a prophetic private in the Life Guards had heralded the sublime appearance by announcing that arrangements were made for the swallowing up of London and Westminster.\`;

// ── Scenarios ─────────────────────────────────────────────────────────────────

export const scenarios: Scenario[] = [
    // ── DEBUG — structural and edge-case tests ─────────────────────────────────

    {
        id: "single-comment",
        label: "Single comment",
        description: "One comment on a specific passage",
        category: "debug",
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
        id: "multiple-suggestions",
        label: "Multiple suggestions",
        description: "Several suggestions across a passage — tests suggestion panel layout",
        category: "debug",
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
                    "Extended version with more detail. Open this revision and use Cmd+Alt+K to create a nested revision inside it.",
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
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "three ships were expected in the harbour before dawn",
                replacements: [
                    {
                        text: "three ships were due before dawn",
                        rationale:
                            "Strips 'in the harbour' — the context implies it",
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
        doc: DOC_LIGHTHOUSE_KEEPER,
        setup(view) {
            const passages = [
                { text: "forty years", comment: "Establishes experience without backstory." },
                { text: "some crept in slowly", comment: "Nice contrast. Could expand." },
                { text: "giving him hours to prepare", comment: "What does preparation look like?" },
                { text: "the sky turning green", comment: "Meteorologically accurate." },
                { text: "angry before the wind even picked up", comment: "Colour change precedes wind shift — correct." },
                { text: "checked the lamp mechanism", comment: "Action shows routine without stating it." },
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
        description: "A revision with verbose alternatives — tests card expansion and text overflow",
        category: "debug",
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
                    "Not — " She stopped. Started again. "Not because I would have done anything differently.",
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
                targetText:
                    "James considered this carefully, which was perhaps already an answer.",
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
        id: "demo-essay",
        label: "Essay — argument structure",
        description:
            "Developmental edit on a personal essay: argument flow, abstract/concrete balance, and the closing claim",
        category: "demo",
        doc: DOC_ESSAY_DRAFT,
        setup(view) {
            createComment({
                targetText: "On the Question of Forgetting",
                comment:
                    "Title is too broad for what the essay actually does. 'On the Question of Forgetting' signals a philosophical treatise; the essay is really a personal investigation prompted by a specific person. Something like 'What My Grandmother Kept' or 'The Residue' or even just 'Forgetting' would be closer. The title is the first thing that tells the reader what kind of essay this is — right now it's misleading.",
                author: "Editor",
                view,
            });

            createComment({
                targetText:
                    "There is a particular cruelty in the way memory works: it keeps what we would most like to lose and loses what we most want to keep.",
                comment:
                    "This is the right kind of opener — a claim bold enough to make the reader either agree immediately or want to argue. 'Particular cruelty' is good: it insists on precision ('not just cruelty, but a particular one') without yet specifying what that particularity is. The inversion ('keeps what we'd lose / loses what we'd keep') is controlled without being cute. The risk is that it sets an aphoristic register the rest of the essay doesn't always maintain. Watch for that.",
                author: "Editor",
                view,
            });

            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText:
                    "Neuroscientists would tell you this is adaptive. Negative events are encoded more strongly because they carry survival information.",
                replacements: [
                    {
                        text: "Neuroscientists would say this is adaptive: negative events are encoded more strongly because they carry survival information.",
                        rationale:
                            "'Would say' is cleaner than 'would tell you' — loses the slightly adversarial 'you', which the essay doesn't need",
                    },
                    {
                        text: "There's a name for this: negativity bias. Negative events are encoded more strongly than positive ones because, evolutionarily speaking, they carry more useful information.",
                        rationale:
                            "Naming the mechanism ('negativity bias') is useful if you want to use the term later or want to show you've done the reading without belaboring it",
                    },
                ],
                comment:
                    "'Would tell you' is doing something slightly uncomfortable — positioning the essayist as separate from the scientists, which is a fine stance but feels accidental here rather than deliberate. Is the distance from the scientific account part of the essay's argument? If so, lean into it. If not, lose the distancing hedge.",
                author: "Editor",
            });

            createRevision({
                targetText:
                    "I have been thinking about this because of my grandmother, who is now eighty-three and who has begun, in the last two years, to forget in the ordinary way that old age sometimes brings.",
                versions: [
                    {
                        label: "Direct",
                        text: "My grandmother is eighty-three. In the last two years, she has begun to forget.",
                    },
                    {
                        label: "Trim only",
                        text: "I have been thinking about this because of my grandmother, who is eighty-three and has begun, in the last two years, to forget.",
                    },
                ],
                threadMessage:
                    "This sentence has two problems. First, 'in the ordinary way that old age sometimes brings' — this is redundant. She's eighty-three; the reader understands the forgetting is age-related. The qualifier also softens something that shouldn't be soft. Second, the sentence is doing a lot of structural work (transitioning from abstract to personal, introducing the grandmother, establishing the timeline) and it's creaking under the weight. The direct version breaks it into two sentences and loses nothing. The trimmed version keeps your voice but removes the redundancy. I'd try the direct version: it earns the intimacy of the rest of the grandmother material.",
                author: "Editor",
                view,
            });

            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText:
                    "I find myself wondering whether this is the truer form of memory: the residue of feeling, stripped of the brittle scaffolding of fact.",
                replacements: [
                    {
                        text: "Perhaps this is the truer form of memory: feeling without scaffolding, residue without record.",
                        rationale:
                            "Parallel structure ('without scaffolding / without record') reinforces the stripping-away; 'brittle' is slightly overdone",
                    },
                    {
                        text: "Maybe feeling is the truer memory — the residue left when the facts have gone.",
                        rationale:
                            "Plainer, warmer, and 'the residue left when the facts have gone' commits to the claim without hedging",
                    },
                ],
                comment:
                    "'Brittle scaffolding of fact' is the essay's best image. The problem is the container: 'I find myself wondering whether' is the most non-committal framing possible. You've spent the whole essay building to this claim — commit to it. The essay works better as an argument than as a meditation, and this sentence is where the distinction matters most.",
                author: "Editor",
            });
        },
    },

    {
        id: "demo-short-story",
        label: "Short story — line edit",
        description:
            "A close line edit on a complete short story: rhythm, word-level precision, and voice consistency",
        category: "demo",
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
                            ...createNewAnnotation(state.field(annotationField), selection, "comment"),
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
        id: "screenshot-annotations",
        label: "Screenshot: annotations (Dickens)",
        description:
            "Mixed annotations on the A Tale of Two Cities passage — used by the screenshot script",
        category: "debug",
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
                targetText: "we were all going direct to Heaven, we were all going direct the other way",
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
        description:
            "Several comments across the Dickens passage for the full-ui screenshot",
        category: "debug",
        doc: DICKENS_DOC,
        setup(view) {
            const passages = [
                {
                    text: "it was the worst of times",
                    comment: "The inversion here is the engine of the whole opening — worth protecting.",
                },
                {
                    text: "it was the season of Darkness",
                    comment: "Capitalisation is deliberate and correct for Dickens; don't normalise.",
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
];