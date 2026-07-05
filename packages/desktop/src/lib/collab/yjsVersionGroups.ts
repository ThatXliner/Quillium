import {
    type VersionGroup,
    type VersionGroupMember,
    VersionGroupSchema,
    type VersionGroups,
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
/**
 * yjsVersionGroups.ts -- Yjs <-> CodeMirror version-group sync plugin.
 *
 * Version groups are document-level metadata, sibling to annotations. The Yjs
 * representation is a top-level Y.Map keyed by group id whose values are plain
 * VersionGroup JSON objects. Updating a group replaces the whole map entry,
 * which gives the intended Yjs last-writer-wins conflict behavior per group.
 *
 * Origin discipline mirrors yjsAnnotations.ts:
 *   - ydoc.transact(..., "local") marks writes this plugin originated.
 *   - yjsVersionGroupSync marks CM transactions this plugin dispatched from Yjs.
 */
import { Annotation, Transaction } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type * as Y from "yjs";

export const yjsVersionGroupSync = Annotation.define<boolean>();

export function createVersionGroupSyncPlugin(versionGroupsMap: Y.Map<VersionGroup>) {
    return ViewPlugin.fromClass(
        class {
            private deepObserver: (
                events: Y.YEvent<Y.AbstractType<unknown>>[],
                tr: Y.Transaction,
            ) => void;
            private destroyed = false;
            private initialSyncDone = false;
            private deepObserverAttached = false;

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
                    this._syncInitialFromYjs();
                });
            }

            private _syncInitialToYjs(): void {
                if (this.initialSyncDone) return;
                this.initialSyncDone = true;

                const groups = this.view.state.field(versionGroupField, false) ?? {};
                if (Object.keys(groups).length === 0) return;

                const ydoc = versionGroupsMap.doc;
                if (!ydoc) return;

                queueMicrotask(() => {
                    if (this.destroyed) return;

                    ydoc.transact(() => {
                        for (const [groupId, group] of Object.entries(groups)) {
                            if (versionGroupsMap.has(groupId)) continue;
                            versionGroupsMap.set(groupId, cloneVersionGroup(group));
                        }
                    }, "local");
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
            }

            private _dispatchYjsProjection(): void {
                const groups = yjsToVersionGroups(versionGroupsMap);
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
                        const existing = yjsVersionGroup(versionGroupsMap.get(groupId), groupId);
                        if (!existing || !versionGroupEqual(existing, group)) {
                            versionGroupsMap.set(groupId, cloneVersionGroup(group));
                        }
                    }
                }, "local");
            }
        },
    );
}

function yjsToVersionGroups(versionGroupsMap: Y.Map<VersionGroup>): VersionGroups {
    const groups: VersionGroups = {};
    versionGroupsMap.forEach((value, groupId) => {
        const group = yjsVersionGroup(value, groupId);
        if (group) groups[groupId] = group;
    });
    return groups;
}

function yjsVersionGroup(value: unknown, groupId: string): VersionGroup | undefined {
    const parsed = VersionGroupSchema.safeParse(value);
    if (!parsed.success) {
        console.warn("[yjsVersionGroups] Ignoring malformed version group", groupId);
        return undefined;
    }
    return cloneVersionGroup({ ...parsed.data, id: groupId });
}

function cloneVersionGroup(group: VersionGroup): VersionGroup {
    return {
        id: group.id,
        label: group.label,
        members: group.members.map((member) => cloneMember(member)),
    };
}

function cloneMember(member: VersionGroupMember): VersionGroupMember {
    return {
        revisionId: member.revisionId,
        versionId: member.versionId,
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
