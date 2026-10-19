/** mcpBranch.ts - Resolve explicit version paths and commit through parent authority. */
import {
    annotationField,
    revisionInternalEdit,
    revisionProvenance,
    updateRevisionVersionState,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    type VersionState,
    isAnnotationOfType,
    provenanceAfterHumanEdit,
    versionText,
} from "$lib/editor/plugins/annotations/models";
import { isolateHistory } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { EditorialBranchSegment } from "./editorialTarget";

export function resolveMcpBranch(root: EditorState, path: readonly EditorialBranchSegment[]) {
    let state = root;
    const parents: Array<{
        state: EditorState;
        segment: EditorialBranchSegment;
        version: VersionState;
    }> = [];
    for (const segment of path) {
        const revision = state.field(annotationField)[segment.revisionId];
        if (!revision || !isAnnotationOfType(revision, "revision")) return undefined;
        const version = revision.versions.find((candidate) => candidate.id === segment.versionId);
        if (!version) return undefined;
        parents.push({ state, segment, version });
        state = EditorState.fromJSON(
            {
                ...version,
                doc:
                    revision.activeVersionId === version.id
                        ? state.sliceDoc(revision.selection.main.from, revision.selection.main.to)
                        : versionText(version),
                selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
            },
            { extensions: [annotationField] },
            { annotationField },
        );
    }
    return {
        state,
        commit(view: EditorView, next: EditorState): void {
            let child = next;
            for (let index = parents.length - 1; index >= 0; index--) {
                const parent = parents[index];
                const transaction = updateRevisionVersionState(
                    parent.state,
                    parent.segment.revisionId,
                    parent.segment.versionId,
                    {
                        ...parent.version,
                        ...child.toJSON({ annotationField }),
                        ...(child.doc.toString() !== versionText(parent.version)
                            ? { provenance: provenanceAfterHumanEdit(parent.version) }
                            : {}),
                    },
                );
                if (index === 0) {
                    const origin = transaction.annotation(revisionProvenance);
                    view.dispatch({
                        changes: transaction.changes,
                        effects: transaction.effects,
                        annotations: [
                            revisionInternalEdit.of(true),
                            ...(origin ? [revisionProvenance.of(origin)] : []),
                            isolateHistory.of("full"),
                        ],
                    });
                } else {
                    child = transaction.state;
                }
            }
        },
    };
}
