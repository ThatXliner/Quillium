/**
 * yjsVersionGroups.ts -- Yjs <-> CodeMirror version-group sync plugin.
 *
 * Version groups are document-level metadata, sibling to annotations. The Yjs
 * representation is a top-level Y.Map keyed by group id whose values reference
 * revisions by stable Yjs annotation key. Each peer translates those keys to
 * its own numeric CodeMirror ids. Updating a group replaces the whole map entry,
 * giving the intended Yjs last-writer-wins conflict behavior per group.
 *
 * Origin discipline mirrors yjsAnnotations.ts:
 *   - ydoc.transact(..., "local") marks writes this plugin originated.
 *   - yjsVersionGroupSync marks CM transactions this plugin dispatched from Yjs.
 */
import type {
    VersionGroup,
    VersionGroupMember,
    VersionGroups,
} from "$lib/editor/plugins/annotations/models";
import {
    _addMemberToGroup,
    _createVersionGroup,
    _deleteVersionGroup,
    _removeMemberFromGroup,
    _renameVersionGroup,
    _restoreVersionGroups,
    versionGroupField,
} from "$lib/editor/plugins/annotations/versionGroupField";
import { Annotation, Transaction } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type * as Y from "yjs";
import { z } from "zod";
import type { AnnotationIdMap } from "./annotationSchema";
import type { YjsAnnotationNode, YjsVersionGroup } from "./types";

export const yjsVersionGroupSync = Annotation.define<boolean>();

type VersionGroupSyncOptions = {
    idMap: AnnotationIdMap;
    annotationsMap?: Y.Map<YjsAnnotationNode>;
    seedFromLocal?: boolean;
};

export function createVersionGroupSyncPlugin(
    versionGroupsMap: Y.Map<YjsVersionGroup>,
    { idMap, annotationsMap, seedFromLocal = false }: VersionGroupSyncOptions,
) {
    return ViewPlugin.fromClass(
        class {
            private deepObserver: (
                events: Y.YEvent<Y.AbstractType<unknown>>[],
                tr: Y.Transaction,
            ) => void;
            private destroyed = false;
            private initialSyncDone = false;
            private deepObserverAttached = false;
            private annotationObserverAttached = false;

            constructor(private view: EditorView) {
                this._syncInitialToYjs();
                this._syncInitialFromYjs();

                this.deepObserver = (_events, tr) => {
                    if (this.destroyed || tr.origin === "local") return;
                    this._dispatchYjsProjection();
                };

                this._attachDeepObserverAfterInitialPull();
            }

            private _attachDeepObserverAfterInitialPull(): void {
                queueMicrotask(() => {
                    if (this.destroyed) return;
                    versionGroupsMap.observeDeep(this.deepObserver);
                    this.deepObserverAttached = true;
                    annotationsMap?.observeDeep(this.deepObserver);
                    this.annotationObserverAttached = annotationsMap !== undefined;
                    this._syncInitialFromYjs();
                });
            }

            private _syncInitialToYjs(): void {
                if (this.initialSyncDone) return;
                this.initialSyncDone = true;

                if (!seedFromLocal) return;
                const groups = this.view.state.field(versionGroupField, false) ?? {};

                const ydoc = versionGroupsMap.doc;
                if (!ydoc) return;

                queueMicrotask(() => {
                    if (this.destroyed) return;

                    this._diffAndReconcile(groups);
                });
            }

            private _syncInitialFromYjs(): void {
                if (versionGroupsMap.size === 0) return;

                queueMicrotask(() => {
                    if (this.destroyed) return;
                    this._dispatchYjsProjection();
                });
            }

            update(update: ViewUpdate): void {
                if (update.transactions.some((tr) => tr.annotation(yjsVersionGroupSync))) return;

                const before = update.startState.field(versionGroupField, false) ?? {};
                const after = update.state.field(versionGroupField, false) ?? {};
                const hasVersionGroupEffect = update.transactions.some((tr) =>
                    tr.effects.some(
                        (effect) =>
                            effect.is(_createVersionGroup) ||
                            effect.is(_deleteVersionGroup) ||
                            effect.is(_addMemberToGroup) ||
                            effect.is(_removeMemberFromGroup) ||
                            effect.is(_renameVersionGroup) ||
                            effect.is(_restoreVersionGroups),
                    ),
                );

                if (!hasVersionGroupEffect && before === after) return;
                this._diffAndReconcile(after);
            }

            destroy(): void {
                this.destroyed = true;
                if (this.deepObserverAttached) {
                    versionGroupsMap.unobserveDeep(this.deepObserver);
                    this.deepObserverAttached = false;
                }
                if (this.annotationObserverAttached) {
                    annotationsMap?.unobserveDeep(this.deepObserver);
                    this.annotationObserverAttached = false;
                }
            }

            private _dispatchYjsProjection(): void {
                const groups = yjsToVersionGroups(versionGroupsMap, idMap);
                const current = this.view.state.field(versionGroupField, false) ?? {};
                if (versionGroupsEqual(current, groups)) return;

                this.view.dispatch({
                    effects: [_restoreVersionGroups.of({ groups })],
                    annotations: [yjsVersionGroupSync.of(true), Transaction.addToHistory.of(false)],
                });
            }

            private _diffAndReconcile(groups: VersionGroups): void {
                const ydoc = versionGroupsMap.doc;
                if (!ydoc) return;

                ydoc.transact(() => {
                    const cmIds = new Set(Object.keys(groups));
                    const yjsIds = new Set(versionGroupsMap.keys());

                    for (const yjsId of yjsIds) {
                        if (!cmIds.has(yjsId)) {
                            versionGroupsMap.delete(yjsId);
                        }
                    }

                    for (const [groupId, group] of Object.entries(groups)) {
                        const desired = codeMirrorToYjsVersionGroup(group, idMap);
                        if (!desired) continue;
                        const existing = parseYjsVersionGroup(
                            versionGroupsMap.get(groupId),
                            groupId,
                        );
                        if (!existing || !yjsVersionGroupEqual(existing, desired)) {
                            versionGroupsMap.set(groupId, desired);
                        }
                    }
                }, "local");
            }
        },
    );
}

function yjsToVersionGroups(
    versionGroupsMap: Y.Map<YjsVersionGroup>,
    idMap: AnnotationIdMap,
): VersionGroups {
    const groups: VersionGroups = {};
    versionGroupsMap.forEach((value, groupId) => {
        const group = yjsToCodeMirrorVersionGroup(value, groupId, idMap);
        if (group) groups[groupId] = group;
    });
    return groups;
}

const YjsVersionGroupSchema = z.object({
    id: z.string(),
    label: z.string(),
    members: z.array(z.object({ revisionId: z.string(), versionId: z.string() })),
});

function parseYjsVersionGroup(value: unknown, groupId: string): YjsVersionGroup | undefined {
    const parsed = YjsVersionGroupSchema.safeParse(value);
    if (!parsed.success) {
        console.warn("[yjsVersionGroups] Ignoring malformed version group", groupId);
        return undefined;
    }
    return cloneYjsVersionGroup({ ...parsed.data, id: groupId });
}

function yjsToCodeMirrorVersionGroup(
    value: unknown,
    groupId: string,
    idMap: AnnotationIdMap,
): VersionGroup | undefined {
    const group = parseYjsVersionGroup(value, groupId);
    if (!group) return undefined;

    const members: VersionGroupMember[] = [];
    for (const member of group.members) {
        const revisionId = idMap.getCmId(member.revisionId);
        if (revisionId === undefined) return undefined;
        members.push({ revisionId, versionId: member.versionId });
    }
    return { id: group.id, label: group.label, members };
}

function codeMirrorToYjsVersionGroup(
    group: VersionGroup,
    idMap: AnnotationIdMap,
): YjsVersionGroup | undefined {
    const members: YjsVersionGroup["members"] = [];
    for (const member of group.members) {
        const revisionId = idMap.getYjsId(member.revisionId);
        if (!revisionId) return undefined;
        members.push({ revisionId, versionId: member.versionId });
    }
    return { id: group.id, label: group.label, members };
}

function cloneYjsVersionGroup(group: YjsVersionGroup): YjsVersionGroup {
    return {
        id: group.id,
        label: group.label,
        members: group.members.map((member) => ({ ...member })),
    };
}

function versionGroupsEqual(a: VersionGroups, b: VersionGroups): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => {
        const aGroup = a[key];
        const bGroup = b[key];
        return !!aGroup && !!bGroup && versionGroupEqual(aGroup, bGroup);
    });
}

function yjsVersionGroupEqual(a: YjsVersionGroup, b: YjsVersionGroup): boolean {
    if (a.id !== b.id || a.label !== b.label || a.members.length !== b.members.length) {
        return false;
    }
    return a.members.every(
        (member, index) =>
            member.revisionId === b.members[index]?.revisionId &&
            member.versionId === b.members[index]?.versionId,
    );
}

function versionGroupEqual(a: VersionGroup, b: VersionGroup): boolean {
    if (a.id !== b.id || a.label !== b.label || a.members.length !== b.members.length) {
        return false;
    }
    return a.members.every(
        (member, index) =>
            member.revisionId === b.members[index]?.revisionId &&
            member.versionId === b.members[index]?.versionId,
    );
}
