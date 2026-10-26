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
import type { RevisionProvenance } from "$lib/editor/plugins/annotations/models";

export function classifyOrigin(args: {
    userEvent: string | undefined;
    hasRevisionInternalEdit: boolean;
    hasNestedEditorEdit: boolean;
    hasAiEdit?: boolean;
    revisionProvenance?: RevisionProvenance;
}): ChangeOrigin {
    const explicitRevisionOrigin =
        args.revisionProvenance === "human"
            ? "human-revision"
            : args.revisionProvenance === "ai"
              ? "ai-revision"
              : args.revisionProvenance === "mixed"
                ? "mixed-revision"
                : undefined;

    // A revision-system marker says how the edit was applied, not who authored
    // its text. Only an explicit, persisted version provenance may assign the
    // human/AI/mixed label; legacy unlabelled revisions remain unknown.
    if (args.hasRevisionInternalEdit) {
        return explicitRevisionOrigin ?? "unknown";
    }
    if (args.hasAiEdit) return "ai-revision";
    if (args.hasNestedEditorEdit) return explicitRevisionOrigin ?? "nested-edit";

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
