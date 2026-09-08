# College applications

The bundled College applications feature is opt-in for each document. In AI
Settings, the invitation beneath Voice latitude offers UC PIQ, Personal statement,
and Supplemental. Choosing one saves the document opt-in and opens its prompt
picker. The College icon stays hidden until then. Documents with existing College
setups retain access when upgrading; new documents start without it.

The panel uses the existing [sidebar host](ai-sidebar.md#built-in-panel-host).
With AI enabled and the document opted in, it works without a model connection. Opening its panel, editing setup, and applying a preset make no model
requests. Chat planning and Feedback reviews require an explicit action.

Turning AI off hides Chat, Feedback, Revise, Document Context, Readers, AI
Settings, and College without deleting saved College setup. With AI enabled but
no model credentials, College, Context, Readers, and Settings remain available
for local configuration. Only model requests require a connection.

## Document and tab ownership

The plugin works across a document. Selecting prompts creates one named essay
tab per prompt, including its root draft, initial H1, and setup in one atomic
operation. Each tab can then contain multiple answers separated by top-level
Markdown H1 headings. All drafts and runs in a tab remain alternative attempts
at those writing tasks.

Shared writer notes and confirmed decisions stay in the existing document-owned
Context state. The plugin never replaces them with prompt text. Setup answers
(intent and feedback focus), prompts, constraints, and sourced guidance remain
separate from those notes. Prose and annotations continue through CodeMirror.

The panel names its current document, tab, and draft. Select a different document
tab to change its target. Setup creates new essay tabs; there is no existing-tab
picker. In a configured tab, **Add another prompt** appends an H1 and an empty
answer through one ordinary CodeMirror transaction. Existing prose and
annotations remain intact. For a legacy single-prompt tab without headings,
adding another prompt also places the original prompt above its existing answer.
Normal editor undo reverses the text change; there is no special undo control.

Changing targets or hiding the panel abandons unsaved form edits. Setup is saved
before inserting a heading, so failed setup writes leave prose untouched. A
changed editor or target during that write prevents the late insertion.

## Setup and guidance

The prompt picker offers UC PIQ, personal statement, and supplemental prompts.
Selecting several creates separate tabs; **Add another prompt** selects just one
for the current tab. Length constraints preserve words versus characters; blank
bounds mean unknown, not zero. Writers can enter exact supplemental wording.

New tabs start with `# Prompt text (69 words)` and room for an answer. Edit or
paste ordinary H1 headings to change prompts. Each answer runs from its heading
to the next top-level H1. H2 headings remain inside the answer; fenced code,
block quotes, and list-contained headings do not start College sections. The
panel counts each answer independently, excluding its H1, and recognizes up to
12 prompts. Markdown heading edits and insertions use normal editor history.

Prompt metadata stays in the tab setup, outside the prose. Detection matches
normalized prompt wording against saved prompts and archived metadata, so moving
or restoring a matching heading reconnects its context. New or changed wording
is detected as a new prompt; old research is retained but excluded until its
original prompt returns or new research is accepted. Duplicate headings receive
distinct identities and do not borrow research from each other. Avoid duplicate
prompt wording when separate research identities matter.

If all headings disappear in a section-based tab, no prompt context is applied.
Legacy setups without section mode still support their original whole-tab brief.
Prompt metadata is retained for recovery (up to 100 archived prompts); this is
not a separate undo history. Accepted research remains saved until explicitly
removed, even while its prompt is absent.

The initial sources were checked on September 7, 2026:

- [UC first-year PIQ guidance](https://admission.universityofcalifornia.edu/how-to-apply/applying-as-a-first-year/personal-insight-questions.html):
  its response limit is included; the source does not name an application cycle.
- [Common App's current prompt page](https://www.commonapp.org/apply/essay-prompts/):
  the official page data contains all seven prompts for 2026–2027. The preset
  uses concise summaries with that cycle and links to the original wording.
  The page does not state a length limit; the preset leaves it unknown.
- [Common App's 2025 writing worksheet](https://www.commonapp.org/static/ff69a4ea4ce044fe419826e26803aa65/Resource_FY_Essays_ENG_2025.06.25_0.pdf):
  a source of general advice, shown with its original date rather than treated
  as current-cycle requirements.

Supplemental setup supplies no invented school requirements. For each new tab, the
writer enters the school, prompt, and optional word or character limit. A URL entered by the writer is not independently verified
by the plugin. Optional school research runs only after the writer confirms a
source and starts it; provider-returned findings still require explicit review
before they enter essay context. Research references carry their selected prompt IDs
and per-prompt scope keys. Adding another prompt does not invalidate unrelated
research. Missing or changed prompts exclude their research from AI requests;
restoring the matching heading reconnects it. The College panel shows accepted
research beneath its prompt and retained, detached sources under Sources and settings.

Accepted references include publisher, URL, check date, cycle or unknown, and a
classification: official requirement, official advice, or editorial
guidance. Applying saves these snapshots. Opening a saved setup never silently
substitutes a new bundle. A future guidance update must offer a preview before
replacing accepted references.

## Effective preferences and requests

Without an active tab setup, device editorial preferences and reader choices
apply. An active tab setup replaces those defaults with its accepted preferences,
reader list, and explicit per-mode reader opt-ins. Editing those choices through
general Settings or Readers saves to the tab. Removing or pausing setup exposes
the device defaults again. It never overwrites them.

Defaults are Author-first / Focused / Preserve. Prompt fit starts selected, while
reader fan-out is off. Specificity and reflection and Voice are available as
additional readers. Enabling readers for Feedback is explicit and shows the
number of requests. Revise reader activation remains a separate explicit choice.
Setup never activates AutoAI. An already-enabled AutoAI uses the same effective
brief and editorial preferences without gaining new actions or reader fan-out.

Check prompt fit and Find claims that need examples use the existing Feedback
pipeline, which can create comments. Help me plan an answer uses Chat. Empty
drafts support planning, but not draft-review actions. Requests preserve the
existing document/tab/draft and nested editor target checks, cancellation,
permissions, annotation range mapping, and undo behavior. Setup changes invalidate
in-flight editorial work. Context and preferences are copied at request start.

General Context shows shared notes separately from the tab brief and accepted
sources. Context Lens uses the same packet builder as requests. Tab brief context
has an 8,000-character budget; accepted reference context has a 6,000-character
budget with visible omissions. Both are reference material, never extra tool or
model permissions. There is no separate context-confirmation screen. Prompts do
not grant broader editing authority.

Hiding the panel leaves an active setup in requests, visibly available in general
Context and Readers while AI features are enabled. Pause setup excludes its owned
context and preferences but keeps the data. Disabling/removing the host
contribution also excludes it. Removing setup deletes its owned prompt,
references, readers, and overrides, preserving shared notes, confirmed decisions,
prose, and annotations. Load errors and unsupported saved versions block
editorial requests rather than guessing context.

## Persistence and extension boundary

`college_tab_setups` stores one versioned JSON snapshot per stable tab ID. The
native API validates document/tab ownership. Selecting multiple prompts for new
tabs validates every one-prompt setup and initial heading before creating any
tab, root draft, snapshot, or setup row; the entire batch commits at once. Duplication copies rows under the new tab IDs in the same
document-duplication transaction; copied JSON contains no source target IDs. Soft
deletion and restoration retain setup. Permanent deletion cascades through tab
ownership. No plugin metadata is added to Web Preview or Live Room payloads.
Legacy saved setups remain readable without automatic migration or deletion.

The panel receives a narrow host adapter for reading its snapshot, adding a prompt, saving setup,
retrying loads, opening general panels, and requesting three fixed actions. It
receives no editor handle, credentials, native command API, or arbitrary network
capability. The built-in interface is not a sandbox for externally installed code.

## Overlap feedback

College contributes **Check overlap with other essays** to the existing Feedback
actions when the current tab has an active College setup. The compact picker
suggests other College tabs in the current document and lets the writer change
the selected drafts and application school before requesting feedback. Opening
the picker makes no model request. The College panel itself is unchanged.

The current draft receives ordinary comments about concrete repeated anecdotes
or substantially overlapping points. Thematic continuity and intentional reuse
across schools are not inherently problems. Each comment includes a supporting
passage button. Exact captured quotes and source identities are validated before
comments are created, and navigation checks the source fingerprint before
selecting a passage. Changed or missing sources never select an unrelated range.
Read-only previews show the source quote without exposing encoded link data; jumping
to another draft is a desktop action.

The target and up to three selected source drafts are captured with a maximum
of 12,000 characters each. The picker discloses omitted characters. The request
uses the configured model, global and session cancellation, Feedback's comment
permission, provenance, and the existing annotation gateway and undo commands.
Sources, setups, and the current target are rechecked before applying results.
Notes, research, and other Library documents are not included in this comparison.

Selections are transient. No application groups or new database tables are
created. Multi-document discovery, persistent groups, external plugins,
marketplace distribution, and paper/debate workflows remain deferred. This
consumer does not complete all of #84.

## Optional school research

[School research](school-research.md) starts from an official page confirmed by
the writer, checks a bounded set of related pages, and presents evidence for
explicit selection. Accepted snapshots use the existing reference budget and
persistence. Research never automatically edits the brief or essay.
