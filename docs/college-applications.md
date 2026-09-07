# College applications

The bundled College applications plugin adds a local panel to the existing
[sidebar host](ai-sidebar.md#built-in-panel-host). It works without an AI
connection. Opening its panel, editing setup, and applying a preset make no model
requests. Chat planning and Feedback reviews require an explicit action.

Turning AI off hides Chat, Feedback, Revise, Document Context, Readers, and AI
Settings. College stays available for local prompts, constraints, and guidance,
with its AI actions and links to AI panels hidden. With AI enabled but no model
credentials, Context and Readers remain available for local configuration.

## Document and tab ownership

The plugin works across a document. Each configured workspace tab owns one
College prompt and its constraints. A document can hold multiple College tabs:
selecting several prompts creates one named tab per prompt, including its root
draft and setup, in one atomic operation. A UC document might have a separate
tab for each PIQ. A Common App document might have a personal statement tab and
separate Duke and Stanford supplement tabs. All drafts and runs in a tab remain
alternative attempts at that tab's writing task.

Shared writer notes and confirmed decisions stay in the existing document-owned
Context state. The plugin never replaces them with prompt text. Setup answers
(intent and feedback focus), the prompt, constraints, and sourced guidance remain
separate from those notes. Prose and annotations continue through CodeMirror.

The panel names its current document, tab, and draft. Select a different document
tab to change its target. Applying one prompt to an existing tab uses the actual
workspace tab selection and changes only that tab's College setup; the tab label,
existing prose, and document-owned notes and decisions stay intact. Selecting
several prompts creates the named tabs and their setups together, with no partial
batch. Changing targets or hiding the panel abandons unsaved setup edits. An
already-started write may finish for that original tab after navigation; its
completion must not update the new tab's UI. Failed writes retain the accepted
setup and expose an error.

## Setup and guidance

The main setup asks for one prompt, its length limit, and an optional idea to
convey. Prompt metadata, readers, and editorial preferences sit behind disclosure
controls. The saved panel shows one primary action: planning for an empty draft,
or checking prompt fit once there is prose. Sources and setup management stay
available under More options. Preview is informational and requires no
acknowledgment checkbox or separate context-confirmation screen; applying the
prompt saves the reviewed setup.

UC PIQ, personal statement, and supplemental presets support edit, preview,
cancel, apply, pause/resume, and removal preview. Each selected prompt becomes a
named tab when configuring new tabs; the complete selection commits atomically.
Length constraints preserve words versus characters; blank bounds mean unknown,
not zero. The preset picker uses short labeled prompt summaries. Writers can
replace a summary with exact application wording and enter source URLs.

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

Supplemental setup supplies no invented school requirements. For each tab, the
writer enters the school, optional program, one exact prompt, source links, cycle,
and known constraints. A URL entered by the writer is not independently verified
by the plugin. There is no background school research.

Accepted references include publisher, URL, check date, cycle or unknown, and a
classification: official requirement, official advice, or Quillium editorial
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
tabs validates every one-prompt setup before creating any tab, root draft, or
setup row; the tab, draft, and setup batch commits all at once or not at all.
Applying one prompt to an existing workspace tab updates only its College setup,
preserving that tab's label and prose plus the document's shared notes and
decisions. Duplication copies rows under the new tab IDs in the same
document-duplication transaction; copied JSON contains no source target IDs. Soft
deletion and restoration retain setup. Permanent deletion cascades through tab
ownership. No plugin metadata is added to Web Preview or Live Room payloads.
Legacy saved setups containing multiple prompts remain readable until the writer
explicitly replaces them; there is no automatic migration or deletion.

The panel receives a narrow host adapter for reading its snapshot, saving setup,
retrying loads, opening general panels, and requesting three fixed actions. It
receives no editor handle, credentials, native command API, or arbitrary network
capability. The built-in interface is not a sandbox for externally installed code.

[Issue #424](https://github.com/ThatXliner/Quillium/issues/424) can later select one
draft per tab and compare the responses a school reads together. Reuse across
different schools is not inherently redundant. Application grouping, cross-essay
review, school-research agents (#423), external plugins, marketplace distribution,
and paper/debate workflows are deferred. This consumer does not complete all of #84.
