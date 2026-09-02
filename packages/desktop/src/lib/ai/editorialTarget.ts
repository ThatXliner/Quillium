/**
 * editorialTarget.ts - Request-scoped target validation for AI-created annotations.
 */

import type { AiTextRange } from "./context";
import type { EditorialAction } from "./editorialPolicy";

export type EditorialTargetSnapshot = {
    documentId: string | null;
    draftId: string | null;
    selectedText: string;
    selectedTextRange?: AiTextRange;
};

export type EditorialTargetState = {
    documentId: string | null;
    draftId: string | null;
    documentText?: string;
};

export type EditorialTargetValidation =
    | { ok: true }
    | {
          ok: false;
          reason:
              | "document-changed"
              | "draft-changed"
              | "selection-changed"
              | "outside-selection"
              | "action-forbidden";
      };

export function validateEditorialActionTarget({
    snapshot,
    current,
    targetText,
    action,
    allowedActions,
}: {
    snapshot: EditorialTargetSnapshot;
    current: EditorialTargetState;
    targetText: string;
    action: EditorialAction;
    allowedActions: readonly EditorialAction[];
}): EditorialTargetValidation {
    if (!allowedActions.includes(action)) return { ok: false, reason: "action-forbidden" };
    if (snapshot.documentId !== current.documentId)
        return { ok: false, reason: "document-changed" };
    if (snapshot.draftId !== current.draftId) return { ok: false, reason: "draft-changed" };
    if (snapshot.selectedTextRange && current.documentText !== undefined) {
        const { from, to } = snapshot.selectedTextRange;
        if (current.documentText.slice(from, to) !== snapshot.selectedText) {
            return { ok: false, reason: "selection-changed" };
        }
    }
    if (snapshot.selectedText && !snapshot.selectedText.includes(targetText)) {
        return { ok: false, reason: "outside-selection" };
    }
    return { ok: true };
}
