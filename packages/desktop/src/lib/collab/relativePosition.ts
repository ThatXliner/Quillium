/**
 * relativePosition.ts -- RelativePosition utilities for annotation anchoring.
 *
 * Yjs RelativePosition survives concurrent edits by storing a reference to
 * a Y.Text item rather than an absolute index. When text is inserted or deleted
 * around the anchor, the RelativePosition resolves to the correct absolute index.
 *
 * Key dependencies:
 *   - yjs for RelativePosition API
 *   - @codemirror/state for EditorSelection
 */
import * as Y from "yjs";
import { EditorSelection } from "@codemirror/state";

export interface EncodedPosition {
    startPos: Uint8Array;
    endPos: Uint8Array;
}

/**
 * Convert absolute CodeMirror selection to encoded RelativePositions.
 *
 * @param ytext - Y.Text shared type
 * @param selection - CodeMirror EditorSelection
 * @returns Encoded RelativePositions for start and end
 */
export function absoluteToRelative(ytext: Y.Text, selection: EditorSelection): EncodedPosition {
    const startRel = Y.createRelativePositionFromTypeIndex(ytext, selection.main.from);
    const endRel = Y.createRelativePositionFromTypeIndex(ytext, selection.main.to);
    return {
        startPos: Y.encodeRelativePosition(startRel),
        endPos: Y.encodeRelativePosition(endRel),
    };
}

/**
 * Convert encoded RelativePositions back to absolute CodeMirror selection.
 *
 * @param ydoc - Y.Doc containing the Y.Text
 * @param _ytext - Y.Text shared type (unused but kept for API symmetry)
 * @param startPos - Encoded start RelativePosition
 * @param endPos - Encoded end RelativePosition
 * @returns EditorSelection or null if positions resolve to null (anchored text deleted)
 */
export function relativeToAbsolute(
    ydoc: Y.Doc,
    _ytext: Y.Text,
    startPos: Uint8Array,
    endPos: Uint8Array,
): EditorSelection | null {
    const startRel = Y.decodeRelativePosition(startPos);
    const endRel = Y.decodeRelativePosition(endPos);
    const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, ydoc);
    const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, ydoc);

    if (startAbs === null || endAbs === null) {
        return null; // Referenced text was deleted
    }

    return EditorSelection.single(startAbs.index, endAbs.index);
}
