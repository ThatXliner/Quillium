/**
 * sharePayload.ts — Desktop adapter for Omni's shared serialization contract.
 *
 * The wire projection lives in @quillium/share so desktop publishing, Web
 * Preview, history, and contract tests cannot acquire separate implementations.
 */
import type { Annotations, VersionGroups } from "$lib/editor/plugins/annotations";
import { serializeAnnotationsFromData } from "@quillium/share/core";
import { buildShareFingerprint } from "@quillium/share/rendering";
import type { SerializedAnnotation } from "@quillium/share";

export { buildShareFingerprint };
export { serializeShareState } from "./shareState";
export type {
    SerializedAnnotation,
    SerializedCommentAnnotation,
    SerializedRevisionAnnotation,
    SerializedSuggestionAnnotation,
    SerializedThreadMessage,
} from "@quillium/share";

export function serializeAnnotations(
    doc: string,
    annotations: Annotations | undefined,
    versionGroups: VersionGroups = {},
): SerializedAnnotation[] {
    if (!annotations) return [];
    return serializeAnnotationsFromData(doc, annotations, versionGroups);
}
