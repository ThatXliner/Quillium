/**
 * classify.ts — Provenance origin classification.
 *
 * Pure function mapping a CodeMirror transaction's signals (its
 * `userEvent` annotation plus the revision/nested-editor markers) to a
 * `ChangeOrigin`. Kept free of any CodeMirror imports so it can be unit
 * tested in isolation.
 *
 * Used by:
 *   - src/lib/editor/listeners.ts (capture) to stamp each doc event.
 *   - src/lib/provenance/report.ts (read) only indirectly, via the
 *     `origin` already stored on the event.
 *
 * The raw `userEvent` is always preserved on the event alongside the
 * derived origin, so the `format` vs `type` heuristic below is
 * reclassifiable after the fact if it ever proves wrong.
 */

import type { ChangeOrigin } from "$lib/db/events";

export function classifyOrigin(args: {
    userEvent: string | undefined;
    hasRevisionInternalEdit: boolean;
    hasNestedEditorEdit: boolean;
}): ChangeOrigin {
    // Revision/nested markers are unambiguous and win over userEvent:
    // accepted version switches and nested-editor-originated changes are
    // dispatched programmatically and carry whatever userEvent the caller
    // happened to set (often none).
    if (args.hasRevisionInternalEdit) return "ai-revision";
    if (args.hasNestedEditorEdit) return "nested-edit";

    const ue = args.userEvent ?? "";
    if (ue === "input.restore") return "restore";
    if (ue === "input.paste") return "paste";
    if (ue === "delete.cut") return "cut";
    if (ue.startsWith("delete")) return "delete";
    // markdownFormatting dispatches with a bare "input" userEvent, whereas
    // ordinary typing is "input.type" / "input.type.compose".
    if (ue === "input") return "format";
    if (ue.startsWith("input")) return "type";
    return "unknown";
}
