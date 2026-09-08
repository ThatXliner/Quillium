# School research

The College panel's **Research this school's prompt** action checks public pages
for the selected tab's prompts. It is optional and requires AI features, a
configured model, and the native desktop app. Saved setup and accepted sources
remain local when AI is disabled.

## Review before and after research

The writer reviews the institution and campus, cycle (or unknown), program,
selected prompts, and an official admissions page. The writer confirms that the
page belongs to the intended institution. School and cycle corrections in this
form affect the research target; they do not edit the writing brief. To change a
prompt, edit setup first.

Retrieval follows the selected provider's verified capability. Supported
OpenAI API models use OpenAI hosted web search restricted to the confirmed
hostname. Anthropic API models use one Anthropic hosted search with the same
domain restriction. Google models use Google Search together with URL Context
for the exact confirmed URL; because Google's tool has no allowed-domain option,
Quillium instructs it to stay on that hostname and discards every off-host
source it returns. DeepSeek, OpenAI-compatible endpoints, ChatGPT OAuth, and
unsupported hosted-tool models fetch only the confirmed URL through Quillium's
native network command. No path discovers or ranks links in the browser.

The model extracts candidate findings from the retrieved text. The review groups
published requirements, official guidance, and editorial interpretations. Each
finding includes a source passage, URL, publisher hostname, checked date, cycle
or explicit unknown, and selected prompt identities. Findings are constrained to
one atomic summary copied as a concise direct quotation or exact contiguous
excerpt from that one evidence passage, not a paraphrase, and remain reviewable
before acceptance. The publisher hostname is assigned by the host, not invented
by the model. On the native fallback, Quillium separately checks that the
evidence exactly matches the fetched text and that the normalized summary is a
literal extractive substring of the normalized evidence. The first check is
provenance and the second is literal containment; neither is a general semantic
entailment check. Hosted tools return source URLs and quoted evidence, but
Quillium cannot independently match that quote to provider-held page text. The
writer should compare the evidence before accepting it.

Institution identity is assessed separately from cycle, program, and prompt fit.
A campus match is required only when the target explicitly names a campus. A
clearly official parent or system-wide page can match a broad target such as
“University of California”. Missing, different, or stale cycles do not make an
otherwise matching institution fail; an actually different school or genuinely
unclear identity does.

An applicant obligation, prohibited action, numeric constraint, or deadline is a
requirement only when the source explicitly states it with language such as
“must”, “required”, “limited”, or “due”. Published descriptions of review
treatment, including equal consideration, are official advice rather than
requirements. Source-authored recommendations, explanations, and how-to advice
are also official advice, including directly published advice phrased informally.
Only model-derived inferences are editorial guidance, which is labeled as
interpretation rather than a claimed school preference or prediction. Equivalent
year-pair labels such as 2026-27,
2026-2027, 2026–27, and 2026–2027 compare equal while the original source label
is retained. Stale or genuinely different cycles still produce warnings.

Requirement existence is separate from cycle certainty. With an unknown target
cycle, an undated supported requirement is retained without a no-requirement
warning. With a specified target, an undated or different-cycle finding gets a
precise no-verified-cycle warning, while the requirement finding remains visible.
The existing no-requirement warning is reserved for results with no requirement
findings.

Findings start unchecked. **Add to essay context** saves only selected findings.
Completion, cancellation, failure, and retry do not save context. Review choices
can also be saved without adding findings. Refresh compares candidate findings
with saved ones and retains unchecked choices. Changed findings show their
previous text. A missing finding is not treated as a retraction: a bounded
provider call or failed page may explain its absence. Removing an older finding is an
explicit checkbox action; refresh never replaces accepted text automatically.

## Boundaries and failure behavior

The research host receives only the public target and provider-returned sources.
The confirmed-URL fallback also sends the fetched public page text. It does not
read essay prose, writer intent, shared notes, decisions, annotation text, or
local files. Hosted-provider searches send the school, cycle, program, selected
prompt text, and confirmed URL to that provider. Pages never grant editing or
local-file permissions. Fallback HTML is parsed in an inert template and never
rendered.

The form requires a valid HTTPS URL without embedded credentials. For fallback
retrieval, the native fetcher is authoritative: it accepts public DNS hosts,
resolves and rejects private addresses, pins the resolved addresses, and
disables redirects and proxies.
It sends no cookies or authentication. A public page that redirects must be
opened by the writer and its final URL entered explicitly. Login portals, PDFs,
JavaScript-only pages, and arbitrary cross-site browsing are unsupported.

Each action makes one structured AI SDK request. OpenAI gets one hosted search
step, Anthropic allows one hosted search, and Google enables Search plus URL
Context. The fallback downloads one page, capped at 512 KiB, and supplies at most
12,000 extracted characters. All paths allow at most eight candidate findings,
4,000 model output tokens, and 90 seconds after at most 10 seconds loading the
model connection. Native fetches have a 15-second deadline and at most two
simultaneous requests across the app. No automatic retries occur. Cancellation
interrupts requests and discards late results. Unknown, outdated, conflicting,
or institution-mismatched evidence remains visible for review.

## Provider support

OpenAI API, Anthropic, and Google use their installed AI SDK provider tools when
the configured model supports them. OpenAI and Anthropic apply provider-side
hostname restrictions. Google combines Search with URL Context, then Quillium
keeps only confirmed-host sources. ChatGPT OAuth stays on the fallback until
hosted-tool passthrough is verified. DeepSeek, OpenAI-compatible endpoints, and
unsupported hosted-tool models also use the single-page fallback. Every provider
returns the same Zod-validated evidence shape through `Output.object()`, followed
by the same review and acceptance flow. Provider wiring does not prove every
provider/model combination has passed live factual evaluation; see the PR's
verification record.

## Scope and persistence

The capability captures document, tab, draft, and the full accepted setup when
research starts. It retains one result internally, returning a separate copy to
the UI. Acceptance takes result and finding IDs, not caller-supplied content.
Switching target, disabling AI, hiding the panel, or changing setup invalidates
that operation. Research cannot apply results to the newly selected tab.

Accepted references reuse the version-1 `college_tab_setups` JSON row, with
optional research provenance and review fields. No migration is needed. The
existing atomic save, duplicate-tab remapping, trash/restore, and deletion
behavior applies. Research contains no document or tab IDs inside copied JSON.
Snapshots include evidence and remain usable offline after restart.

New research stores a scope key for each prompt named by the finding, covering
school, program, cycle, prompt wording, and constraints. Adding or removing an
unrelated prompt leaves the finding usable. Removing a referenced H1 or changing
its wording or constraints excludes that finding from requests. Restoring the
matching heading reconnects it. Older references retain their full-setup scope
key until converted while adding a prompt or replaced by a new accepted review.
Detached prompt metadata is retained in the tab setup for recovery. Accepting
research for an automatically detected H1 saves that prompt's metadata too. Shared notes and editorial
preferences do not change this key. General Context shows retained stale
snapshots explicitly. Requests and Context Lens share the existing 6,000-character
reference budget and omission count; adding sources cannot expand permissions.

See [College applications](college-applications.md) for setup ownership and
[the AI pipeline](ai-sidebar.md) for global cancellation and provider settings.
