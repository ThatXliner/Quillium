/**
 * resolveRevisionState.ts — Resolve a serialized nested revision version from a live root state.
 *
 * Serialized annotation ids encode the traversal path as `id.v<version-index>.id`.
 * This keeps raw editor-state blobs out of the flat presentation projection while
 * still allowing state-backed share modals to mount the real nested CodeMirror state.
 */
import type { EditorState } from "@codemirror/state";
import type { AnnotationId, RevisionVersionSelections } from "../rendering";
import { annotationField } from "./annotationField";
import {
    type Annotation,
    type RawAnnotation,
    RawAnnotationsSchema,
    isAnnotationOfType,
    isRawAnnotationOfType,
} from "./models";

type RevisionLike = Annotation<"revision"> | (RawAnnotation & { _type: "revision" });

type AnnotationPathStep = {
    annotationId: number;
    parentVersionIndex: number | null;
};

function parsePath(id: AnnotationId): AnnotationPathStep[] | null {
    const parts = id.split(".");
    const rootId = Number(parts[0]);
    if (!Number.isInteger(rootId)) return null;

    const steps: AnnotationPathStep[] = [{ annotationId: rootId, parentVersionIndex: null }];
    for (let index = 1; index < parts.length; index += 2) {
        const versionToken = parts[index];
        const annotationToken = parts[index + 1];
        if (!versionToken?.startsWith("v") || annotationToken === undefined) return null;
        const parentVersionIndex = Number(versionToken.slice(1));
        const annotationId = Number(annotationToken);
        if (!Number.isInteger(parentVersionIndex) || !Number.isInteger(annotationId)) return null;
        steps.push({ annotationId, parentVersionIndex });
    }
    return steps;
}

function asRevision(annotation: unknown): RevisionLike | null {
    if (
        annotation &&
        typeof annotation === "object" &&
        isAnnotationOfType(annotation as Annotation<"revision">, "revision")
    ) {
        return annotation as Annotation<"revision">;
    }
    if (isRawAnnotationOfType(annotation, "revision")) return annotation;
    return null;
}

function activeIndex(revision: RevisionLike): number {
    if (typeof revision.activeVersionId === "string") {
        const index = revision.versions.findIndex(
            (version) => version.id === revision.activeVersionId,
        );
        if (index >= 0) return index;
    }
    const legacyIndex = (revision as { activeVersionIndex?: unknown }).activeVersionIndex;
    return typeof legacyIndex === "number" ? legacyIndex : 0;
}

function nestedAnnotations(version: object): Record<string, RawAnnotation> | null {
    const candidate = (version as { annotationField?: unknown }).annotationField;
    const parsed = RawAnnotationsSchema.safeParse(candidate ?? {});
    return parsed.success ? parsed.data : null;
}

export function resolveRevisionVersionState(
    state: EditorState,
    annotationId: AnnotationId,
    selections: RevisionVersionSelections = {},
): Record<string, unknown> | null {
    const steps = parsePath(annotationId);
    if (!steps) return null;

    let annotation: unknown = state.field(annotationField, false)?.[steps[0].annotationId];
    for (let index = 1; index < steps.length; index += 1) {
        const parentRevision = asRevision(annotation);
        const step = steps[index];
        if (!parentRevision || step.parentVersionIndex === null) return null;
        const parentVersion = parentRevision.versions[step.parentVersionIndex];
        if (!parentVersion) return null;
        annotation = nestedAnnotations(parentVersion as object)?.[String(step.annotationId)];
    }

    const revision = asRevision(annotation);
    if (!revision) return null;
    const requestedIndex = selections[annotationId] ?? activeIndex(revision);
    const selectedIndex = Math.min(Math.max(requestedIndex, 0), revision.versions.length - 1);
    return (revision.versions[selectedIndex] as Record<string, unknown> | undefined) ?? null;
}
