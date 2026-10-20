/** mcpBranch.ts - Resolve explicit version paths and commit through parent authority. */
import {
    _updateRevisionVersionState,
    annotationField,
    revisionInternalEdit,
    revisionProvenance,
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
        activeOffset?: number;
    }> = [];
    for (const segment of path) {
        const revision = state.field(annotationField)[segment.revisionId];
        if (!revision || !isAnnotationOfType(revision, "revision")) return undefined;
        const version = revision.versions.find((candidate) => candidate.id === segment.versionId);
        if (!version) return undefined;
        parents.push({
            state,
            segment,
            version,
            activeOffset:
                revision.activeVersionId === version.id ? revision.selection.main.from : undefined,
        });
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
        commit(
            view: EditorView,
            next: EditorState,
            insertion?: { from: number; insert: string },
        ): void {
            let child = next;
            let change = insertion;
            for (let index = parents.length - 1; index >= 0; index--) {
                const parent = parents[index];
                change =
                    change && parent.activeOffset !== undefined
                        ? { ...change, from: parent.activeOffset + change.from }
                        : undefined;
                const transaction = parent.state.update({
                    changes: change,
                    effects: _updateRevisionVersionState.of({
                        annotationId: parent.segment.revisionId,
                        versionId: parent.segment.versionId,
                        versionState: {
                            ...parent.version,
                            ...child.toJSON({ annotationField }),
                            ...(child.doc.toString() !== versionText(parent.version)
                                ? { provenance: provenanceAfterHumanEdit(parent.version) }
                                : {}),
                        },
                    }),
                    annotations: [
                        revisionInternalEdit.of(true),
                        revisionProvenance.of("human"),
                        isolateHistory.of("full"),
                    ],
                });
                if (index === 0) {
                    view.dispatch(transaction);
                } else {
                    child = transaction.state;
                }
            }
        },
    };
}
