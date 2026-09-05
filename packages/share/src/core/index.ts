/**
 * core/index.ts — Public API for the read-only editor core.
 *
 * Everything a host needs to mount an annotated document read-only:
 *   - getReadonlyExtensions() / readonlySavedFields — build the EditorState.
 *   - the two state fields + facets for advanced hosts.
 *   - setActiveRevisionVersion — switch a revision's active version (cascades
 *     through linked version groups automatically).
 *   - models/utils helpers for reading annotations and revision versions.
 */
export {
    type PersonaColor,
    type ReadonlyExtensionConfig,
    atomicRevisionsFacet,
    getReadonlyExtensions,
    personaColorsFacet,
    readonlySavedFields,
} from "./readonlyExtensions";
export { ReadonlyEditorController } from "./readonlyEditorController";
export type { ReadonlySelectionOptions } from "./readonlyEditorController";

export { annotationField, setActiveRevisionVersion } from "./annotationField";
export {
    type SerializedState,
    serializeAnnotationsFromData,
    serializeFromState,
} from "./serialize";
export { resolveRevisionVersionState } from "./resolveRevisionState";
export { versionGroupField } from "./versionGroupField";
export { getActiveAnnotation } from "./utils";
export {
    AiGenerationProvenanceSchema,
    type AiGenerationProvenance,
    type Annotation,
    type Annotations,
    type AnnotationType,
    type GenericAnnotation,
    type VersionState,
    type VersionGroup,
    type VersionGroupMember,
    type VersionGroups,
    VersionGroupsSchema,
    activeVersion,
    activeVersionIndex,
    groupOfMember,
    groupPartnersOf,
    isAnnotationOfType,
    versionById,
    versionIndexById,
    versionText,
} from "./models";

export { buildRevisionAtomicRanges, getPersonaDots } from "./annotationDecorations";
