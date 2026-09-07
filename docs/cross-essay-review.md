# Cross-essay review

The College panel can group the exact drafts that one school will read together. A group is a
local list of document, tab, and draft IDs plus its school and cycle. It does not copy essay prose.
The same Common App personal statement can therefore belong to several school groups while each
school's supplements remain in their own group.

## Selection and navigation

Related essays are configured inside the existing College panel. Candidate discovery reads local
document, tab, draft, prompt, and setup metadata. It does not read every document's prose, use the
semantic index, or send anything to a provider. Each essay tab contributes at most one explicitly
selected draft because other drafts in that tab are alternate attempts at the same response.

Opening a related essay follows its stable document, tab, and draft IDs through the normal editor
load path. Moving or renaming a tab does not break the link. A trashed source remains listed and
becomes available again after restore. A permanently deleted source stays listed as missing until
the writer edits or removes the group.

Document duplication does not copy or retarget application groups. Existing groups continue to
refer to the original drafts. Removing a group deletes only its membership and saved report; it
does not change any document, College setup, prompt, research, shared note, decision, or prose.

## Request boundary

**Review selection** first captures only the chosen drafts. The confirmation lists every document,
tab, and draft and shows how many characters will be sent or omitted. Each source is capped at
12,000 characters and the full request at 36,000 characters. Truncation removes the suffix and is
reported both before the request and in the result. A source that receives no remaining budget is
identified as omitted; the report must not claim to have reviewed it.

The captured request contains:

- the group name, school, and cycle;
- each selected source's prompt label and text;
- the selected draft's bounded prose prefix.

It does not contain other Library documents, document-owned shared notes or decisions, accepted
school research, annotations, or alternate drafts. A tab setup with a nonempty school must match
the group's school. This prevents one school's supplement context from entering another school's
review. A school-neutral personal statement can be selected in more than one group without
duplicating its prose.

The final **Review these essays** action is one explicit structured model request. It returns a
report with repeated stories, what each essay adds, and contradictory claims phrased as questions
for the writer. It cannot edit, annotate, rewrite, or redistribute essay text, and it must not
predict admissions outcomes.

## Evidence and stale results

Every finding cites an exact source ID, character range, and quote from the captured prefix.
Quillium verifies that the quote equals the captured text at that range. A finding with invalid,
cross-source, or insufficient evidence is removed and disclosed in the report limits.

The provider receives an immutable capture. Before saving or showing its result, Quillium reloads
the saved group and selected drafts and checks their full-content fingerprints. It discards the
result if the group, any source, the active College target, AI availability, or the panel session
changed. Cancellation uses the same global and panel-scoped abort signals as other College work.

Reports keep source identities, fingerprints, labels, character counts, citations, and warnings.
They do not persist the transmitted prose. A citation button selects the exact current passage
only when the draft still matches its captured fingerprint and quote. If the draft changed, the
editor opens it without selecting a possibly unrelated range and explains that the report is
stale.

Groups and navigation work with AI enabled even when no provider credential is configured. Only
the model request requires a connection. Turning AI off hides the College panel and cancels work
without deleting groups or reports.
