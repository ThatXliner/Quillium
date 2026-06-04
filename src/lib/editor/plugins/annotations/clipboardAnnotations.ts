/**
 * clipboardAnnotations.ts — Preserve comment annotations across cut/copy → paste
 *
 * This file implements Google-Docs-style comment preservation: when a user
 * cuts/copies a region that contains comment annotations, then pastes it
 * elsewhere (same doc, another doc, or after restart), the comments are
 * recreated on the pasted text at the correct offsets.
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
 * Scope: comments only (per #241). Suggestions/revisions are out of scope;
 *   the offset-rebasing approach generalizes to them later.
 *
 * Key dependencies:
 *   - @codemirror/state (EditorSelection, EditorState) for ranges.
 *   - @codemirror/view (EditorView.domEventHandlers) for clipboard events.
 *   - ./annotationField (addAnnotation effect) to recreate comments.
 *   - ./models (getNewId, isAnnotationOfType, ThreadMessageSchema) for ids,
 *     type guards, and validating the smuggled thread payload.
 */

import { EditorSelection, type EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { z } from "zod";
import { addAnnotation } from "./annotationField";
import { annotationField } from "./annotationField";
import { ThreadMessageSchema, getNewId, isAnnotationOfType } from "./models";

// ── Serialized shape ────────────────────────────────────────────────────────
// A comment rebased into copy-relative coordinates, with its id stripped (the
// id is regenerated on paste). Offsets are relative to the start of the copied
// range. The thread is carried verbatim.
const SerializedCommentSchema = z.object({
    _type: z.literal("comment"),
    relAnchor: z.number(),
    relHead: z.number(),
    thread: z.array(ThreadMessageSchema),
});
const SerializedAnnotationsSchema = z.array(SerializedCommentSchema);
export type SerializedAnnotation = z.infer<typeof SerializedCommentSchema>;

// ── Side-table ──────────────────────────────────────────────────────────────
// Fallback for when text/html is stripped from the clipboard. Keyed by a hash
// of the copied text. Bounded so a long session of copies can't grow it without
// limit; the most recent copy is the one almost always pasted.
const sideTable = new Map<string, SerializedAnnotation[]>();
const SIDE_TABLE_MAX = 32;

// Non-cryptographic string hash (FNV-1a). The side-table only needs a fast,
// stable key; collisions are harmless (worst case: the wrong annotations are
// considered, then rejected because the text differs at paste time — but we
// don't re-verify text, so we keep the key space wide via a 32-bit hash plus
// the text length to make accidental collisions vanishingly unlikely).
function hashText(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    // >>> 0 coerces to unsigned; length disambiguates same-hash different-length.
    return `${(h >>> 0).toString(36)}:${text.length}`;
}

function rememberInSideTable(text: string, annotations: SerializedAnnotation[]): void {
    if (annotations.length === 0) return;
    const key = hashText(text);
    // Refresh recency: delete then re-set so the entry moves to the end.
    sideTable.delete(key);
    sideTable.set(key, annotations);
    // Evict the oldest (first-inserted) entries beyond the cap.
    while (sideTable.size > SIDE_TABLE_MAX) {
        const oldest = sideTable.keys().next().value;
        if (oldest === undefined) break;
        sideTable.delete(oldest);
    }
}

function lookupSideTable(text: string): SerializedAnnotation[] | undefined {
    return sideTable.get(hashText(text));
}

// Exposed for tests only — clears the module-level side-table between cases.
export function _clearClipboardSideTable(): void {
    sideTable.clear();
}

// ── Serialization (copy) ─────────────────────────────────────────────────────

/**
 * Collects the comment annotations fully contained in the doc range [from, to)
 * and rebases their offsets to be relative to `from`. Annotations only partially
 * overlapping the range are excluded (matches Google Docs; clamp-and-carry is a
 * later enhancement). Ids are stripped — paste assigns fresh ones.
 */
export function serializeAnnotationsForCopy(
    state: EditorState,
    from: number,
    to: number,
): SerializedAnnotation[] {
    const result: SerializedAnnotation[] = [];
    for (const annotation of Object.values(state.field(annotationField))) {
        // Comments only for now. Suggestions/revisions are out of scope (#241).
        if (!isAnnotationOfType(annotation, "comment")) continue;
        const { from: aFrom, to: aTo } = annotation.selection.main;
        // Fully contained in the copied range.
        if (aFrom < from || aTo > to) continue;
        // The selection stores anchor/head (direction matters for nothing here,
        // but we preserve it). Rebase both relative to the copy origin.
        const { anchor, head } = annotation.selection.main;
        result.push({
            _type: "comment",
            relAnchor: anchor - from,
            relHead: head - from,
            thread: annotation.thread,
        });
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

/**
 * Builds the text/html payload: the copied text wrapped in a div carrying the
 * base64-encoded annotation JSON in a data-quillium attribute. WebKit preserves
 * text/html across windows and restarts, so the annotations ride along.
 */
export function encodeHtml(text: string, annotations: SerializedAnnotation[]): string {
    const payload = encodeBase64(JSON.stringify(annotations));
    return `<div data-quillium="${payload}">${escapeHtml(text)}</div>`;
}

/**
 * Extracts and validates the annotation JSON smuggled in a text/html payload.
 * Returns null when the payload has no data-quillium attribute or fails to
 * decode/validate.
 */
export function decodeHtml(html: string): SerializedAnnotation[] | null {
    // Pull the attribute value without parsing the whole HTML (paste handlers
    // run on a hot path and the markup is our own, single-attribute shape).
    const match = html.match(/data-quillium="([^"]*)"/);
    if (!match) return null;
    try {
        const json = decodeBase64(match[1]);
        const parsed = SerializedAnnotationsSchema.safeParse(JSON.parse(json));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

// ── Restore (paste) ──────────────────────────────────────────────────────────

/**
 * Inserts `text` at the current selection and recreates the carried comments
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
    const effects = annotations.map((a) => {
        const anchor = Math.max(pasteFrom, Math.min(pasteFrom + a.relAnchor, insertEnd));
        const head = Math.max(pasteFrom, Math.min(pasteFrom + a.relHead, insertEnd));
        const id = nextId++;
        return addAnnotation.of({
            _type: "comment" as const,
            id,
            selection: EditorSelection.single(anchor, head),
            thread: a.thread,
        });
    });

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
    // With no comments in the selection, defer to CodeMirror's default copy
    // rather than reimplementing it — keeps behavior identical for the common
    // no-comment case.
    if (annotations.length === 0) return false;
    event.preventDefault();
    writeClipboard(event, selected.text, annotations);
    return true;
}

export function handleCut(event: ClipboardEvent, view: EditorView): boolean {
    const selected = selectedText(view.state);
    if (!selected) return false;
    const annotations = serializeAnnotationsForCopy(view.state, selected.from, selected.to);
    if (annotations.length === 0) return false;
    event.preventDefault();
    writeClipboard(event, selected.text, annotations);
    // Delete the source. Phase 1 remap collapses the source annotations
    // naturally; paste recreates them.
    view.dispatch(
        view.state.update({
            changes: { from: selected.from, to: selected.to, insert: "" },
            selection: EditorSelection.cursor(selected.from),
            annotations: Transaction.addToHistory.of(true),
            userEvent: "delete.cut",
        }),
    );
    return true;
}

export function handlePaste(event: ClipboardEvent, view: EditorView): boolean {
    const data = event.clipboardData;
    if (!data) return false;
    const text = data.getData("text/plain");
    if (!text) return false; // non-text paste (image, etc.) — let default run

    // 1. Try the smuggled JSON in text/html.
    const html = data.getData("text/html");
    let annotations = html ? decodeHtml(html) : null;
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
