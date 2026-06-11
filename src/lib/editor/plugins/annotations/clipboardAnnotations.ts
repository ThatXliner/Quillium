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
 *   carry their full versions[] blobs and activeVersionIndex; the copied text
 *   is by construction the active version's rendered text, so on paste the
 *   revision range and its active version stay consistent. Only annotations
 *   FULLY contained in the copied range are carried (matches Google Docs).
 *
 * Key dependencies:
 *   - @codemirror/state (EditorSelection, EditorState) for ranges.
 *   - @codemirror/view (EditorView.domEventHandlers) for clipboard events.
 *   - ./annotationField (addAnnotation/removeAnnotation effects, _revisionCleanup)
 *     to recreate annotations on paste and clean up cut revisions.
 *   - ../../harper/harperLinter (hashText) for the side-table bucket key.
 *   - ./models (getNewId, isAnnotationOfType, ThreadMessageSchema,
 *     SuggestionReplacementSchema, VersionStateSchema) for ids, type guards,
 *     and validating the smuggled payloads.
 */

import { EditorSelection, type EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { z } from "zod";
import { hashText } from "../../harper/harperLinter";
import {
    _revisionCleanup,
    addAnnotation,
    annotationField,
    removeAnnotation,
} from "./annotationField";
import {
    type GenericAnnotation,
    SuggestionReplacementSchema,
    ThreadMessageSchema,
    VersionStateSchema,
    getNewId,
    isAnnotationOfType,
} from "./models";

// ── Serialized shape ────────────────────────────────────────────────────────
// An annotation rebased into copy-relative coordinates, with its id stripped
// (the id is regenerated on paste). Offsets are relative to the start of the
// copied range. Type-specific payloads (thread / replacements / versions) ride
// along verbatim. The relAnchor/relHead and thread fields are shared by every
// variant; the discriminated union adds the per-type extras.
const SerializedBaseSchema = z.object({
    relAnchor: z.number(),
    relHead: z.number(),
    thread: z.array(ThreadMessageSchema),
});
const SerializedCommentSchema = SerializedBaseSchema.extend({
    _type: z.literal("comment"),
});
const SerializedSuggestionSchema = SerializedBaseSchema.extend({
    _type: z.literal("suggestion"),
    replacements: z.array(SuggestionReplacementSchema),
    author: z.string().optional(),
});
const SerializedRevisionSchema = SerializedBaseSchema.extend({
    _type: z.literal("revision"),
    // Carried verbatim — each version is an opaque EditorState.toJSON blob
    // (doc + label + nested annotation state). The nested state lives in its
    // own id space, so it never collides with the parent's annotation ids.
    activeVersionIndex: z.number(),
    versions: z.array(VersionStateSchema).min(1),
});
const SerializedAnnotationSchema = z.discriminatedUnion("_type", [
    SerializedCommentSchema,
    SerializedSuggestionSchema,
    SerializedRevisionSchema,
]);
const SerializedAnnotationsSchema = z.array(SerializedAnnotationSchema);
export type SerializedAnnotation = z.infer<typeof SerializedAnnotationSchema>;

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

// The hash is only the bucket key; text equality is the real match. length
// disambiguates same-hash different-length without walking the string twice.
function sideTableKey(text: string): string {
    return `${hashText(text).toString(36)}:${text.length}`;
}

function rememberInSideTable(text: string, annotations: SerializedAnnotation[]): void {
    if (annotations.length === 0) return;
    const key = sideTableKey(text);
    // Refresh recency: delete then re-set so the entry moves to the end.
    sideTable.delete(key);
    sideTable.set(key, { text, annotations });
    // Evict the oldest (first-inserted) entries beyond the cap.
    while (sideTable.size > SIDE_TABLE_MAX) {
        const oldest = sideTable.keys().next().value;
        if (oldest === undefined) break;
        sideTable.delete(oldest);
    }
}

// Drops any side-table entry for `text`. Called when a copy/cut of this exact
// text carries NO annotations, so a later plaintext paste of it can't resurrect
// annotations from an earlier copy of identical text (the copy handler returns
// early without overwriting the entry, so it must be evicted explicitly).
function forgetInSideTable(text: string): void {
    const key = sideTableKey(text);
    const entry = sideTable.get(key);
    if (entry && entry.text === text) sideTable.delete(key);
}

function lookupSideTable(text: string): SerializedAnnotation[] | undefined {
    const entry = sideTable.get(sideTableKey(text));
    // Re-verify the full text, not just the hash — a hash collision must not
    // attach annotations the user did not actually copy.
    return entry && entry.text === text ? entry.annotations : undefined;
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
 * Encodes the copyable annotations for the clipboard, rebasing their offsets to
 * be relative to `from`. Ids are stripped — paste assigns fresh ones. Comments,
 * suggestions, and revisions are all carried; type-specific data (replacements,
 * versions/activeVersionIndex) rides along verbatim.
 */
export function serializeAnnotationsForCopy(
    state: EditorState,
    from: number,
    to: number,
): SerializedAnnotation[] {
    const result: SerializedAnnotation[] = [];
    for (const annotation of copyableAnnotationsIn(state, from, to)) {
        // The selection stores anchor/head (direction matters for nothing here,
        // but we preserve it). Rebase both relative to the copy origin.
        const { anchor, head } = annotation.selection.main;
        const base = {
            relAnchor: anchor - from,
            relHead: head - from,
            thread: annotation.thread,
        };
        if (isAnnotationOfType(annotation, "comment")) {
            result.push({ ...base, _type: "comment" });
        } else if (isAnnotationOfType(annotation, "suggestion")) {
            result.push({
                ...base,
                _type: "suggestion",
                replacements: annotation.replacements,
                author: annotation.author,
            });
        } else if (isAnnotationOfType(annotation, "revision")) {
            result.push({
                ...base,
                _type: "revision",
                activeVersionIndex: annotation.activeVersionIndex,
                versions: annotation.versions,
            });
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
): GenericAnnotation | null {
    const base = { id, selection, thread: serialized.thread };
    switch (serialized._type) {
        case "comment":
            return { ...base, _type: "comment" };
        case "suggestion":
            return {
                ...base,
                _type: "suggestion",
                replacements: serialized.replacements,
                author: serialized.author,
            };
        case "revision":
            // The active version's doc is, by construction, the text we just
            // inserted — so addAnnotation (which skips Phase 3 for revisions)
            // keeps the range and active version consistent. Clamp the active
            // index defensively in case a malformed payload points past the
            // versions array.
            return {
                ...base,
                _type: "revision",
                activeVersionIndex: Math.max(
                    0,
                    Math.min(serialized.activeVersionIndex, serialized.versions.length - 1),
                ),
                versions: serialized.versions,
            };
        default:
            return null;
    }
}

/**
 * Inserts `text` at the current selection and recreates the carried annotations
 * on the pasted text in a single transaction. Each annotation gets a fresh id
 * and a selection rebased to the insertion point. Offsets are clamped to the
 * inserted span so a malformed payload can't produce out-of-range positions.
 */
export function restoreAnnotations(
    view: EditorView,
    text: string,
    annotations: SerializedAnnotation[],
): void {
    const state = view.state;
    const sel = state.selection.main;
    const pasteFrom = sel.from;
    const insertEnd = pasteFrom + text.length;

    // Assign fresh ids sequentially so they don't collide with each other.
    let nextId = getNewId(state.field(annotationField));
    const effects = annotations
        .map((a) => {
            const anchor = Math.max(pasteFrom, Math.min(pasteFrom + a.relAnchor, insertEnd));
            const head = Math.max(pasteFrom, Math.min(pasteFrom + a.relHead, insertEnd));
            const rebuilt = rebuildAnnotation(a, nextId, EditorSelection.single(anchor, head));
            if (!rebuilt) return null;
            nextId++;
            return addAnnotation.of(rebuilt);
        })
        .filter((e): e is ReturnType<typeof addAnnotation.of> => e !== null);

    view.dispatch(
        state.update({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: EditorSelection.cursor(insertEnd),
            effects,
            // Effects on a transaction are NOT remapped through that
            // transaction's own changes, so the selections above already carry
            // post-insert (absolute) positions.
            annotations: Transaction.addToHistory.of(true),
            userEvent: "input.paste",
            scrollIntoView: true,
        }),
    );
}

// ── DOM event handlers ───────────────────────────────────────────────────────

function selectedText(state: EditorState): { text: string; from: number; to: number } | null {
    const sel = state.selection.main;
    if (sel.empty) return null;
    const { from, to } = sel;
    return { text: state.sliceDoc(from, to), from, to };
}

function writeClipboard(event: ClipboardEvent, text: string, annotations: SerializedAnnotation[]) {
    const data = event.clipboardData;
    if (!data) return;
    // text/plain — clean text for other apps.
    data.setData("text/plain", text);
    // text/html — smuggles the annotation JSON; survives cross-window + restart.
    if (annotations.length > 0) {
        data.setData("text/html", encodeHtml(text, annotations));
    }
    // Side-table — same-session / HTML-stripped fallback.
    rememberInSideTable(text, annotations);
}

// The handler bodies are exported (not just the domEventHandlers wrapper) so
// they can be unit-tested with a mock ClipboardEvent — jsdom provides neither
// ClipboardEvent nor DataTransfer. Each returns true when it took over the
// event (and called preventDefault), false to defer to CodeMirror's default.

export function handleCopy(event: ClipboardEvent, view: EditorView): boolean {
    const selected = selectedText(view.state);
    if (!selected) return false; // nothing selected — let default run
    const annotations = serializeAnnotationsForCopy(view.state, selected.from, selected.to);
    // With no annotations in the selection, defer to CodeMirror's default copy
    // rather than reimplementing it — keeps behavior identical for the common
    // no-annotation case. Evict any stale side-table entry for this exact text
    // first, so a later plaintext paste reflects this clean copy.
    if (annotations.length === 0) {
        forgetInSideTable(selected.text);
        return false;
    }
    event.preventDefault();
    writeClipboard(event, selected.text, annotations);
    return true;
}

export function handleCut(event: ClipboardEvent, view: EditorView): boolean {
    const selected = selectedText(view.state);
    if (!selected) return false;
    // Revisions fully inside the cut collapse to a zero-width range rather than
    // being dropped (mapRange keeps collapsed ranges for revisions). Capture them
    // so we can clean up the phantoms the delete leaves behind.
    const cutRevisions = copyableAnnotationsIn(view.state, selected.from, selected.to).filter((a) =>
        isAnnotationOfType(a, "revision"),
    );
    const annotations = serializeAnnotationsForCopy(view.state, selected.from, selected.to);
    if (annotations.length === 0) {
        // Defer to CM's default cut, but evict any stale side-table entry for this
        // exact text so a later plaintext paste reflects this clean cut.
        forgetInSideTable(selected.text);
        return false;
    }
    event.preventDefault();
    writeClipboard(event, selected.text, annotations);
    // Delete the source. Phase 1 drops collapsed comments/suggestions naturally,
    // and the delete transaction's inverted effects restore every carried
    // annotation on undo; paste recreates them at the destination.
    view.dispatch(
        view.state.update({
            changes: { from: selected.from, to: selected.to, insert: "" },
            selection: EditorSelection.cursor(selected.from),
            annotations: Transaction.addToHistory.of(true),
            userEvent: "delete.cut",
        }),
    );
    // Remove the phantom zero-width revisions the delete left behind. This
    // mirrors collapsedRevisionResolver but runs unconditionally — that resolver
    // is gated on atomicRevisions, so without this a cut in non-atomic mode would
    // strand an empty revision at the cut site. addToHistory.of(false) +
    // _revisionCleanup keep this out of the undo entry (the delete's inverted
    // _restoreAnnotation effects already restore these revisions on undo).
    if (cutRevisions.length > 0) {
        const live = view.state.field(annotationField);
        const phantoms = cutRevisions
            .map((a) => live[a.id])
            .filter(
                (a): a is GenericAnnotation =>
                    a !== undefined && isAnnotationOfType(a, "revision") && a.selection.main.empty,
            );
        if (phantoms.length > 0) {
            view.dispatch(
                view.state.update({
                    effects: phantoms.map((a) => removeAnnotation.of(a)),
                    annotations: [Transaction.addToHistory.of(false), _revisionCleanup.of(true)],
                }),
            );
        }
    }
    return true;
}

export function handlePaste(event: ClipboardEvent, view: EditorView): boolean {
    const data = event.clipboardData;
    if (!data) return false;
    const text = data.getData("text/plain");
    if (!text) return false; // non-text paste (image, etc.) — let default run

    // 1. Try the smuggled JSON in text/html (bound to the copied text).
    const html = data.getData("text/html");
    let annotations = html ? decodeHtml(html, text) : null;
    // 2. Fall back to the side-table keyed by the copied text.
    if (!annotations) {
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
