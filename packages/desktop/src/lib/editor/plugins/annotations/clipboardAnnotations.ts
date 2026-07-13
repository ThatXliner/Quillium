/**
 * clipboardAnnotations.ts — Preserve annotations across cut/copy → paste
 *
 * This file implements Google-Docs-style annotation preservation: when a user
 * cuts/copies a region that contains annotations, then pastes it elsewhere
 * (same doc, another doc, or after restart), the annotations are recreated on
 * the pasted text at the correct offsets.
 *
 * Role in the annotation subsystem:
 *   - Installs copy/cut/paste DOM handlers (clipboardAnnotationHandlers)
 *     that ride alongside annotationField. Copy/cut smuggle annotation JSON,
 *     paste decodes it and dispatches addAnnotation effects.
 *
 * Design (see issue #241):
 *   We do NOT use a custom clipboard MIME type. Quillium ships in Tauri =
 *   WKWebView (WebKit) on macOS, and WebKit safelists clipboard MIME types to
 *   exactly four (text/plain, text/html, text/uri-list, image/png) — arbitrary
 *   custom types are silently dropped. So instead we smuggle the annotation
 *   JSON (base64) inside a data attribute on the text/html payload, which
 *   WebKit preserves across windows and app restarts. An in-memory side-table
 *   keyed by a hash of the copied text is the fallback for the same-session
 *   path and for HTML-stripping sources (e.g. pasting from a plaintext-only
 *   app that drops text/html).
 *
 * Scope: comments, suggestions, and revisions. All three rebase the same way
 *   (offsets relative to the copy origin, fresh id on paste). Revisions also
 *   carry their full versions[] blobs and activeVersionId; the copied text
 *   is by construction the active version's rendered text, so on paste the
 *   revision range and its active version stay consistent. Version ids are
 *   regenerated on paste so pasted versions can't collide with existing ones.
 *   Only annotations
 *   FULLY contained in the copied range are carried (matches Google Docs).
 *
 * Key dependencies:
 *   - @codemirror/state (EditorSelection, EditorState) for ranges.
 *   - @codemirror/view (EditorView.domEventHandlers) for clipboard events.
 *   - ./annotationField (addAnnotation/removeAnnotation effects, _revisionCleanup)
 *     to recreate annotations on paste and clean up cut revisions.
 *   - ../../hash (hashText) for the side-table bucket key.
 *   - ./models (getNewId, isAnnotationOfType, SerializedAnnotationsSchema) for
 *     ids, type guards, and validating the smuggled payloads. The serialized
 *     clipboard shape is derived from the canonical RawAnnotationSchema there.
 */

import { EditorSelection, type EditorState, StateEffect, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { z } from "zod";
import { hashText } from "../../hash";
import {
    _revisionCleanup,
    addAnnotation,
    annotationField,
    removeAnnotation,
} from "./annotationField";
import {
    type GenericAnnotation,
    type SerializedAnnotation,
    SerializedAnnotationsSchema,
    getNewId,
    isAnnotationOfType,
    newAnnotationHistoryId,
    newVersionId,
    normalizeRevision,
} from "./models";
import { cleanRangesOf } from "./utils";

// The clipboard-serialized annotation shape (SerializedAnnotation) is derived
// from the canonical RawAnnotationSchema in models.ts — see the "Clipboard-
// serialized shape" section there. User-facing per-type fields ride across
// automatically; the private history-lineage ID is intentionally regenerated.

// ── Side-table ──────────────────────────────────────────────────────────────
// Fallback for when text/html is stripped from the clipboard. Keyed by a hash
// of the copied text but storing the FULL source text alongside the annotations
// so lookup can re-verify an exact text match. Re-verification is what keeps a
// stale or colliding entry from attaching the wrong annotations: a later copy of
// identical-looking text with no annotations never overwrites the entry (the
// copy handler returns early), so without the text check a clean paste could
// resurrect old annotations. Bounded so a long session of copies can't grow it
// without limit; the most recent copy is the one almost always pasted.
const sideTable = new Map<string, { text: string; annotations: SerializedAnnotation[] }>();
const SIDE_TABLE_MAX = 32;
// Entry count alone bounds nothing about memory: a revision carries its full
// versions[] blobs (a complete doc per version, possibly with nested revisions),
// so a handful of whole-manuscript copies could pin tens of MB for the session.
// Cap the total retained payload size and evict oldest-first past it.
const SIDE_TABLE_MAX_BYTES = 4 * 1024 * 1024;

// Rough UTF-16 byte estimate (2 bytes/char) of an entry's retained payload.
function entryBytes(entry: { text: string; annotations: SerializedAnnotation[] }): number {
    let bytes = entry.text.length * 2;
    for (const a of entry.annotations) {
        if (a._type === "revision") {
            for (const v of a.versions) bytes += (v.doc.length + (v.label?.length ?? 0)) * 2;
        }
    }
    return bytes;
}

function evictBeyondByteBudget(): void {
    let total = 0;
    for (const entry of sideTable.values()) total += entryBytes(entry);
    // Always keep the most-recent entry (the one almost always pasted) even if it
    // alone exceeds the budget — evicting it would defeat the table's purpose.
    while (total > SIDE_TABLE_MAX_BYTES && sideTable.size > 1) {
        const oldestKey = sideTable.keys().next().value;
        if (oldestKey === undefined) break;
        const oldest = sideTable.get(oldestKey);
        if (oldest) total -= entryBytes(oldest);
        sideTable.delete(oldestKey);
    }
}

// Normalizes line endings to "\n", matching how CodeMirror stores and inserts
// text. The OS clipboard round-trip is not line-ending-preserving — Chromium
// (WebView2 on Windows) rewrites text/plain to CRLF on write — so without this
// a multi-line copy would hash/measure differently on paste than on copy,
// silently losing the annotation binding and (worse) making restoreAnnotations'
// length math disagree with the inserted span. Normalize everywhere text is
// hashed, inserted, or measured so copy and paste always agree.
function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n?/g, "\n");
}

// The hash is only the bucket key; text equality is the real match. length
// disambiguates same-hash different-length without walking the string twice.
// Keys are computed over normalized text so a CRLF round-trip still matches.
function sideTableKey(text: string): string {
    const normalized = normalizeLineEndings(text);
    return `${hashText(normalized).toString(36)}:${normalized.length}`;
}

function rememberInSideTable(text: string, annotations: SerializedAnnotation[]): void {
    if (annotations.length === 0) return;
    // Store normalized text so the lookup's exact-match check survives a CRLF
    // clipboard round-trip (the key is normalized too).
    const normalized = normalizeLineEndings(text);
    const key = sideTableKey(normalized);
    // Refresh recency: delete then re-set so the entry moves to the end.
    sideTable.delete(key);
    sideTable.set(key, { text: normalized, annotations });
    // Evict the oldest (first-inserted) entries beyond the cap, bounding both the
    // entry count and (via the byte budget below) the retained text/version size.
    while (sideTable.size > SIDE_TABLE_MAX) {
        const oldest = sideTable.keys().next().value;
        if (oldest === undefined) break;
        sideTable.delete(oldest);
    }
    evictBeyondByteBudget();
}

// Drops any side-table entry for `text`. Called when a copy/cut of this exact
// text carries NO annotations, so a later plaintext paste of it can't resurrect
// annotations from an earlier copy of identical text (the copy handler returns
// early without overwriting the entry, so it must be evicted explicitly).
function forgetInSideTable(text: string): void {
    const normalized = normalizeLineEndings(text);
    const key = sideTableKey(normalized);
    const entry = sideTable.get(key);
    if (entry && entry.text === normalized) sideTable.delete(key);
}

function lookupSideTable(text: string): SerializedAnnotation[] | undefined {
    const normalized = normalizeLineEndings(text);
    const entry = sideTable.get(sideTableKey(normalized));
    // Re-verify the full text, not just the hash — a hash collision must not
    // attach annotations the user did not actually copy.
    return entry && entry.text === normalized ? entry.annotations : undefined;
}

// Exposed for tests only — clears the module-level side-table between cases.
export function _clearClipboardSideTable(): void {
    sideTable.clear();
}

// ── Serialization (copy) ─────────────────────────────────────────────────────

/**
 * Returns the live annotations eligible to ride along with a copy/cut of the doc
 * range [from, to): those fully contained in the range, with a non-empty span,
 * excluding unfinished single-instance state (pending comments). This is the
 * single source of truth for "what gets carried" — serializeAnnotationsForCopy
 * encodes these for the clipboard, and handleCut removes exactly these from the
 * source so a cut never leaves a phantom behind. Annotations only partially
 * overlapping the range are excluded (matches Google Docs).
 */
function copyableAnnotationsIn(state: EditorState, from: number, to: number): GenericAnnotation[] {
    const result: GenericAnnotation[] = [];
    for (const annotation of Object.values(state.field(annotationField))) {
        const { from: aFrom, to: aTo } = annotation.selection.main;
        // Fully contained in the copied range.
        if (aFrom < from || aTo > to) continue;
        // Skip zero-width annotations: a collapsed range carries no copyable span
        // of text, and for revisions Phase 3 leaves versions[active].doc untouched
        // while the range is empty (annotationField pushDocToVersionState), so the
        // copied text would not match the version blob — pasting it produces a
        // revision whose empty range disagrees with its rendered active version.
        if (aFrom === aTo) continue;
        // A pending comment (empty thread) is an unfinished, single-instance
        // state guarded by canCreateNewComment; carrying it would let paste create
        // a second pending highlight that bypasses that guard. Only resolved
        // comments (with at least one message) are copyable.
        if (isAnnotationOfType(annotation, "comment") && annotation.thread.length === 0) continue;
        result.push(annotation);
    }
    return result;
}

/**
 * Encodes the copyable annotations for the clipboard, rebasing their offsets so
 * they are relative to the start of the joined copied text. With a multi-range
 * selection the copied text is the ranges' slices joined by "\n" (mirroring
 * CodeMirror's default copy), so an annotation inside range `i` is rebased by the
 * cumulative length of the earlier ranges plus one separator char per join. Ids
 * are stripped — paste assigns fresh ones. All annotation types are carried;
 * type-specific data rides along verbatim via the generic spread below, so a new
 * type needs no change here — only a member added to SerializedAnnotationSchema
 * in models.ts (see "Adding a new annotation type" in docs/annotations.md).
 */
export function serializeAnnotationsForCopy(
    state: EditorState,
    ranges: { from: number; to: number }[],
): SerializedAnnotation[] {
    // Offset within the joined text where each range's slice begins.
    const rangeStarts: number[] = [];
    let offset = 0;
    for (let i = 0; i < ranges.length; i++) {
        rangeStarts[i] = offset;
        offset += ranges[i].to - ranges[i].from + 1; // +1 for the "\n" separator
    }

    const result: SerializedAnnotation[] = [];
    for (let i = 0; i < ranges.length; i++) {
        const { from, to } = ranges[i];
        const rangeStart = rangeStarts[i];
        for (const annotation of copyableAnnotationsIn(state, from, to)) {
            // The selection stores anchor/head (direction matters for nothing
            // here, but we preserve it). Rebase relative to the joined-text start.
            const { anchor, head } = annotation.selection.main;
            // Carry user content except id/selection verbatim. The private history
            // lineage is also stripped because paste mints a new annotation.
            const { id: _id, selection: _selection, _historyId, ...rest } = annotation;
            result.push({
                ...rest,
                relAnchor: rangeStart + (anchor - from),
                relHead: rangeStart + (head - from),
            } as SerializedAnnotation);
        }
    }
    return result;
}

// ── HTML encode/decode ───────────────────────────────────────────────────────

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// base64 helpers that survive non-ASCII text (btoa only accepts Latin-1).
function encodeBase64(json: string): string {
    // encodeURIComponent → escape to percent-encoding → bytes → btoa.
    return btoa(
        encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, hex) =>
            String.fromCharCode(Number.parseInt(hex, 16)),
        ),
    );
}

function decodeBase64(b64: string): string {
    return decodeURIComponent(
        Array.prototype.map
            .call(atob(b64), (c: string) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
            .join(""),
    );
}

// The smuggled envelope binds the annotations to the text they were copied with
// (via the side-table key — a hash plus length). decodeHtml re-checks this key
// against the pasted plain text so a foreign or round-tripped data-quillium
// attribute whose text doesn't match ours can't attach annotations at bogus
// offsets.
const ClipboardEnvelopeSchema = z.object({
    textKey: z.string(),
    annotations: SerializedAnnotationsSchema,
});

/**
 * Builds the text/html payload: the copied text wrapped in a div carrying the
 * base64-encoded annotation envelope in a data-quillium attribute. WebKit
 * preserves text/html across windows and restarts, so the annotations ride
 * along.
 */
export function encodeHtml(text: string, annotations: SerializedAnnotation[]): string {
    // sideTableKey normalizes line endings; decodeHtml compares against the
    // normalized pasted text, so a CRLF clipboard round-trip still matches.
    const envelope = { textKey: sideTableKey(text), annotations };
    const payload = encodeBase64(JSON.stringify(envelope));
    return `<div data-quillium="${payload}">${escapeHtml(text)}</div>`;
}

/**
 * Extracts and validates the annotation envelope smuggled in a text/html payload,
 * verifying it was copied with `pastedText`. Returns null when the payload has no
 * data-quillium attribute, fails to decode/validate, or its bound text key does
 * not match the text actually being pasted.
 */
export function decodeHtml(html: string, pastedText: string): SerializedAnnotation[] | null {
    // Pull the attribute value without parsing the whole HTML (paste handlers
    // run on a hot path and the markup is our own, single-attribute shape).
    const match = html.match(/data-quillium="([^"]*)"/);
    if (!match) return null;
    try {
        const json = decodeBase64(match[1]);
        const parsed = ClipboardEnvelopeSchema.safeParse(JSON.parse(json));
        if (!parsed.success) return null;
        // Reject a payload that wasn't copied with this exact text — guards
        // against foreign clipboards that happen to carry a data-quillium attr.
        if (parsed.data.textKey !== sideTableKey(pastedText)) return null;
        return parsed.data.annotations;
    } catch {
        return null;
    }
}

// ── Restore (paste) ──────────────────────────────────────────────────────────

/**
 * Reconstructs a carried annotation into a live GenericAnnotation at the paste
 * site. Shared base (id, selection, thread) plus the per-type payload. Returns
 * null for an unrecognized variant (defensive — the schema already constrains
 * _type, but keeps this total over GenericAnnotation's union).
 */
function rebuildAnnotation(
    serialized: SerializedAnnotation,
    id: number,
    selection: EditorSelection,
): GenericAnnotation {
    // Inverse of serialization: drop the rebased offsets, restore id/selection,
    // and carry every other field (thread, replacements, versions, …) verbatim.
    const { relAnchor: _relAnchor, relHead: _relHead, ...rest } = serialized;
    const rebuilt = {
        ...rest,
        id,
        selection,
        // A paste is a new annotation lineage even when its numeric ID is reused.
        _historyId: newAnnotationHistoryId(),
    } as GenericAnnotation;
    if (isAnnotationOfType(rebuilt, "revision")) {
        // Heal both legacy (activeVersionIndex / no version ids) and new-shape
        // payloads into a consistent revision, then regenerate fresh version ids
        // so pasted versions can't collide with versions already in this editor.
        // The active version's doc is, by construction, the text we just inserted,
        // so addAnnotation (which skips Phase 3 for revisions) keeps the range and
        // active version consistent.
        const normalized = normalizeRevision(rebuilt as never);
        const idRemap = new Map<string, string>();
        const versions = normalized.versions.map((v) => {
            const fresh = newVersionId();
            idRemap.set(v.id, fresh);
            return { ...v, id: fresh };
        });
        return {
            ...normalized,
            id,
            selection,
            versions,
            activeVersionId: idRemap.get(normalized.activeVersionId) ?? versions[0].id,
        };
    }
    return rebuilt;
}

/**
 * Marks a transaction this plugin builds for a paste, so boundaryInsertNudge can
 * skip ONLY annotation-carrying pastes (which land as a block and already carry
 * their own annotations) while still nudging plain pastes at a revision edge.
 */
export const clipboardPaste = StateEffect.define<boolean>();

/**
 * Inserts `text` at the current selection and recreates the carried annotations
 * on the pasted text in a single transaction. Each annotation gets a fresh id
 * and a selection rebased to the insertion point. Offsets are clamped to the
 * inserted span and passed through cleanRangesOf so a malformed payload can't
 * produce out-of-range, zero-width, or inverted positions.
 */
export function restoreAnnotations(
    view: EditorView,
    rawText: string,
    annotations: SerializedAnnotation[],
): void {
    const state = view.state;
    const sel = state.selection.main;
    const pasteFrom = sel.from;
    // CodeMirror collapses \r\n to \n on insert, so the inserted span's length is
    // the NORMALIZED length. Measuring against rawText.length would place the
    // selection/clamp past the document end and throw "selection outside
    // document". Normalize here and insert the normalized text.
    const text = normalizeLineEndings(rawText);
    const insertEnd = pasteFrom + text.length;

    // Revisions fully inside the replaced selection collapse to a zero-width
    // range; in non-atomic mode collapsedRevisionResolver won't clean them, so —
    // like handleCut — capture them and remove the phantoms after the paste.
    const replacedRevisions = copyableAnnotationsIn(state, sel.from, sel.to).filter((a) =>
        isAnnotationOfType(a, "revision"),
    );

    // Assign fresh ids sequentially so they don't collide with each other.
    let nextId = getNewId(state.field(annotationField));
    const effects = annotations
        .map((a) => {
            const anchor = Math.max(pasteFrom, Math.min(pasteFrom + a.relAnchor, insertEnd));
            const head = Math.max(pasteFrom, Math.min(pasteFrom + a.relHead, insertEnd));
            // Reject collapsed/inverted ranges the same way the rest of the
            // annotation subsystem does, instead of trusting clamped payload math.
            const cleaned = cleanRangesOf(
                EditorSelection.single(anchor, head),
                a._type === "revision",
            );
            if (!cleaned) return null;
            const rebuilt = rebuildAnnotation(a, nextId, cleaned);
            nextId++;
            return addAnnotation.of(rebuilt);
        })
        .filter((e): e is ReturnType<typeof addAnnotation.of> => e !== null);

    view.dispatch(
        state.update({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: EditorSelection.cursor(insertEnd),
            effects: [...effects, clipboardPaste.of(true)],
            // Effects on a transaction are NOT remapped through that
            // transaction's own changes, so the selections above already carry
            // post-insert (absolute) positions.
            annotations: Transaction.addToHistory.of(true),
            userEvent: "input.paste",
            scrollIntoView: true,
        }),
    );

    cleanUpPhantomRevisions(view, replacedRevisions);
}

/**
 * Removes any zero-width revisions left behind after a delete/replace. Shared by
 * handleCut and restoreAnnotations: collapsedRevisionResolver is gated on
 * atomicRevisions, so in non-atomic mode a delete that fully contains a revision
 * would otherwise strand an empty revision widget. addToHistory.of(false) +
 * _revisionCleanup keep this out of the undo entry (the originating delete's
 * inverted _restoreAnnotation effects already restore these revisions on undo).
 */
function cleanUpPhantomRevisions(view: EditorView, candidates: GenericAnnotation[]): void {
    if (candidates.length === 0) return;
    const live = view.state.field(annotationField);
    const phantoms = candidates
        .map((a) => live[a.id])
        .filter(
            (a): a is GenericAnnotation =>
                a !== undefined && isAnnotationOfType(a, "revision") && a.selection.main.empty,
        );
    if (phantoms.length === 0) return;
    view.dispatch(
        view.state.update({
            effects: phantoms.map((a) => removeAnnotation.of(a)),
            annotations: [Transaction.addToHistory.of(false), _revisionCleanup.of(true)],
        }),
    );
}

// ── DOM event handlers ───────────────────────────────────────────────────────

// The copied span(s). CodeMirror's default copy/cut joins every non-empty
// selection range with the line separator and acts on all of them, so we mirror
// that: `ranges` are the non-empty ranges in document order, and `text` is their
// slices joined by "\n". Returns null when nothing is selected.
type CopySpan = { text: string; ranges: { from: number; to: number }[] };

function selectedSpan(state: EditorState): CopySpan | null {
    const ranges = state.selection.ranges
        .filter((r) => !r.empty)
        .map((r) => ({ from: r.from, to: r.to }))
        .sort((a, b) => a.from - b.from);
    if (ranges.length === 0) return null;
    const text = ranges.map((r) => state.sliceDoc(r.from, r.to)).join("\n");
    return { text, ranges };
}

// Writes text + smuggled annotations to the clipboard. Returns false when the
// environment gave us no usable clipboardData — the caller MUST then defer to
// CodeMirror's default (which has a hidden-textarea fallback) rather than commit
// a destructive cut with nothing on the clipboard.
function writeClipboard(
    event: ClipboardEvent,
    text: string,
    annotations: SerializedAnnotation[],
): boolean {
    const data = event.clipboardData;
    if (!data) return false;
    // text/plain — clean text for other apps.
    data.setData("text/plain", text);
    // text/html — smuggles the annotation JSON; survives cross-window + restart.
    if (annotations.length > 0) {
        data.setData("text/html", encodeHtml(text, annotations));
    }
    // Side-table — same-session / HTML-stripped fallback.
    rememberInSideTable(text, annotations);
    return true;
}

// The handler bodies are exported (not just the domEventHandlers wrapper) so
// they can be unit-tested with a mock ClipboardEvent — jsdom provides neither
// ClipboardEvent nor DataTransfer. Each returns true when it took over the
// event (and called preventDefault), false to defer to CodeMirror's default.

export function handleCopy(event: ClipboardEvent, view: EditorView): boolean {
    const selected = selectedSpan(view.state);
    if (!selected) return false; // nothing selected — let default run
    const annotations = serializeAnnotationsForCopy(view.state, selected.ranges);
    // With no annotations in the selection, defer to CodeMirror's default copy
    // rather than reimplementing it — keeps behavior identical for the common
    // no-annotation case. Evict any stale side-table entry for this exact text
    // first, so a later plaintext paste reflects this clean copy.
    if (annotations.length === 0) {
        forgetInSideTable(selected.text);
        return false;
    }
    // No usable clipboard — defer to CM's default so the copy isn't silently lost.
    if (!writeClipboard(event, selected.text, annotations)) return false;
    event.preventDefault();
    return true;
}

export function handleCut(event: ClipboardEvent, view: EditorView): boolean {
    // A readOnly view (e.g. the Version History snapshot preview) must not be
    // mutated. CM's default cut/paste guard on readOnly; view.dispatch does not.
    if (view.state.readOnly) return false;
    const selected = selectedSpan(view.state);
    if (!selected) return false;
    // Revisions fully inside the cut collapse to a zero-width range rather than
    // being dropped (mapRange keeps collapsed ranges for revisions). Capture them
    // so we can clean up the phantoms the delete leaves behind.
    const cutRevisions = selected.ranges
        .flatMap((r) => copyableAnnotationsIn(view.state, r.from, r.to))
        .filter((a) => isAnnotationOfType(a, "revision"));
    const annotations = serializeAnnotationsForCopy(view.state, selected.ranges);
    if (annotations.length === 0) {
        // Defer to CM's default cut, but evict any stale side-table entry for this
        // exact text so a later plaintext paste reflects this clean cut.
        forgetInSideTable(selected.text);
        return false;
    }
    // No usable clipboard — defer to CM's default rather than delete the source
    // with nothing written to the clipboard (data loss).
    if (!writeClipboard(event, selected.text, annotations)) return false;
    event.preventDefault();
    // Delete every selected range. Phase 1 drops collapsed comments/suggestions
    // naturally, and the delete transaction's inverted effects restore every
    // carried annotation on undo; paste recreates them at the destination.
    view.dispatch(
        view.state.update({
            changes: selected.ranges.map((r) => ({ from: r.from, to: r.to, insert: "" })),
            annotations: Transaction.addToHistory.of(true),
            userEvent: "delete.cut",
        }),
    );
    cleanUpPhantomRevisions(view, cutRevisions);
    return true;
}

export function handlePaste(event: ClipboardEvent, view: EditorView): boolean {
    // A readOnly view must not be mutated (CM's default paste guards on readOnly).
    if (view.state.readOnly) return false;
    const data = event.clipboardData;
    if (!data) return false;
    const text = data.getData("text/plain");
    if (!text) return false; // non-text paste (image, etc.) — let default run

    // 1. Try the smuggled JSON in text/html (bound to the copied text).
    const html = data.getData("text/html");
    let annotations = html ? decodeHtml(html, text) : null;
    // 2. Fall back to the side-table keyed by the copied text — but ONLY when the
    //    clipboard carries no text/html at all. A real Quillium copy with
    //    annotations always writes our data-quillium HTML; if html is present yet
    //    didn't decode, the content came from elsewhere (a foreign app), so we
    //    must not resurrect a stale side-table entry that merely shares its text.
    //    Note: a plain-text-only external copy of text identical to an earlier
    //    annotated Quillium copy is indistinguishable from an HTML-stripped
    //    internal copy and will still match — an accepted limitation of keying by
    //    content (the attached annotations are at least coherent with the text).
    if (!annotations && !html) {
        annotations = lookupSideTable(text) ?? null;
    }
    // 3. No annotations anywhere — let CodeMirror's default paste run so we
    //    don't reimplement plain-text paste behavior (newline handling, etc).
    if (!annotations || annotations.length === 0) return false;

    event.preventDefault();
    restoreAnnotations(view, text, annotations);
    return true;
}

export const clipboardAnnotationHandlers = EditorView.domEventHandlers({
    copy: handleCopy,
    cut: handleCut,
    paste: handlePaste,
});
