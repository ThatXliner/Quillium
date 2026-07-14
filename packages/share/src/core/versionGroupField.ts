import { invertedEffects } from "@codemirror/commands";
/**
 * versionGroupField.ts — Version groups (linking revision versions, #268)
 *
 * A StateField holding the document's VersionGroups: named sets that link one
 * version from each of several DIFFERENT revisions, so activating any member
 * switches every member to its partner (the cascade lives in annotationField's
 * setActiveRevisionVersion). This field owns only the group STRUCTURE.
 *
 * Role in the annotation subsystem:
 *   - Sibling of annotationField. Kept separate so the heavily-tested annotation
 *     reducer stays untouched and groups get their own effect/undo/serialize
 *     surface.
 *   - Enforces two invariants in its reducer:
 *       1. Exclusive membership — adding a member removes it from any prior group.
 *       2. Referential integrity — when a revision is removed or a version is
 *          deleted (observed via annotationField effects in the same
 *          transaction), matching members are pruned; a group that drops below
 *          two members is dissolved (a group of one links nothing).
 *
 * Key dependencies:
 *   - ./models for the VersionGroup types, schema, and helpers.
 *   - ./annotationField for the annotation effects it reacts to (removeAnnotation,
 *     _deleteVersionFromRevision). This is a one-way dependency; the cascade in
 *     annotationField imports group QUERIES from ./models, not this field, to
 *     avoid a cycle.
 */
import {
    type EditorState,
    StateEffect,
    StateField,
    Transaction,
    type TransactionSpec,
} from "@codemirror/state";
import { mapValues } from "lodash-es";
import { _deleteVersionFromRevision, removeAnnotation } from "./annotationField";
import {
    type VersionGroup,
    type VersionGroupMember,
    type VersionGroups,
    VersionGroupsSchema,
    canAddMemberToGroup,
    groupOfMember,
    membersEqual,
    newGroupId,
    versionGroupMembersError,
} from "./models";

// ── Effects ─────────────────────────────────────────────────────
// All carry enough to invert for undo.
export const _createVersionGroup = StateEffect.define<{ group: VersionGroup }>();
export const _deleteVersionGroup = StateEffect.define<{ group: VersionGroup }>();
export const _addMemberToGroup = StateEffect.define<{
    groupId: string;
    member: VersionGroupMember;
    /** Preserve member ordering when undo restores a member removed from the middle. */
    index?: number;
}>();
export const _removeMemberFromGroup = StateEffect.define<{
    groupId: string;
    member: VersionGroupMember;
}>();
export const _renameVersionGroup = StateEffect.define<{ groupId: string; label: string }>();
// Wholesale replacement of the group map. Collaboration projections and
// persisted-state fallbacks intentionally replace the authoritative map. New
// undo entries use granular semantic effects instead, but the history codec
// keeps this effect for backward compatibility with existing documents.
export const _restoreVersionGroups = StateEffect.define<{ groups: VersionGroups }>();

/** Whether an effect mutates the version-group field. */
export function isVersionGroupEffect(effect: StateEffect<unknown>): boolean {
    return (
        effect.is(_createVersionGroup) ||
        effect.is(_deleteVersionGroup) ||
        effect.is(_addMemberToGroup) ||
        effect.is(_removeMemberFromGroup) ||
        effect.is(_renameVersionGroup) ||
        effect.is(_restoreVersionGroups)
    );
}

export type SerializedVersionGroupHistoryEffect = {
    type: string;
    value: unknown;
};

/** Serialize one version-group-owned history effect. Unknown types return undefined. */
export function serializeVersionGroupHistoryEffect(
    effect: StateEffect<unknown>,
): SerializedVersionGroupHistoryEffect | undefined {
    if (effect.is(_restoreVersionGroups)) {
        return { type: "versionGroup.restore", value: effect.value };
    }
    if (effect.is(_createVersionGroup)) {
        return { type: "versionGroup.create", value: effect.value };
    }
    if (effect.is(_deleteVersionGroup)) {
        return { type: "versionGroup.delete", value: effect.value };
    }
    if (effect.is(_addMemberToGroup)) {
        return { type: "versionGroup.addMember", value: effect.value };
    }
    if (effect.is(_removeMemberFromGroup)) {
        return { type: "versionGroup.removeMember", value: effect.value };
    }
    if (effect.is(_renameVersionGroup)) {
        return { type: "versionGroup.rename", value: effect.value };
    }
    return undefined;
}

function groupHistoryRecord(value: unknown, type: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid ${type} effect in persisted history`);
    }
    return value as Record<string, unknown>;
}

function groupHistoryString(value: unknown, type: string): string {
    if (typeof value !== "string") throw new Error(`Invalid ${type} effect in persisted history`);
    return value;
}

function groupHistoryMember(value: unknown, type: string): VersionGroupMember {
    const record = groupHistoryRecord(value, type);
    if (typeof record.revisionId !== "number" || !Number.isSafeInteger(record.revisionId)) {
        throw new Error(`Invalid ${type} effect in persisted history`);
    }
    return {
        revisionId: record.revisionId,
        versionId: groupHistoryString(record.versionId, type),
    };
}

function groupHistoryIndex(value: unknown, type: string): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Invalid ${type} effect in persisted history`);
    }
    return value;
}

function groupHistoryGroup(value: unknown, type: string): VersionGroup {
    const record = groupHistoryRecord(value, type);
    const id = groupHistoryString(record.id, type);
    const parsed = VersionGroupsSchema.safeParse({ [id]: record });
    if (!parsed.success) throw new Error(`Invalid ${type} effect in persisted history`);
    return parsed.data[id];
}

/** Rebuild one version-group-owned history effect. Unknown tags return undefined. */
export function deserializeVersionGroupHistoryEffect(
    serialized: SerializedVersionGroupHistoryEffect,
): StateEffect<unknown> | undefined {
    const { type, value } = serialized;
    if (type === "versionGroup.restore") {
        const record = groupHistoryRecord(value, type);
        const parsed = VersionGroupsSchema.safeParse(record.groups);
        if (!parsed.success) throw new Error(`Invalid ${type} effect in persisted history`);
        return _restoreVersionGroups.of({ groups: parsed.data });
    }
    if (type === "versionGroup.create" || type === "versionGroup.delete") {
        const record = groupHistoryRecord(value, type);
        const group = groupHistoryGroup(record.group, type);
        return type === "versionGroup.create"
            ? _createVersionGroup.of({ group })
            : _deleteVersionGroup.of({ group });
    }
    if (type === "versionGroup.addMember" || type === "versionGroup.removeMember") {
        const record = groupHistoryRecord(value, type);
        const payload = {
            groupId: groupHistoryString(record.groupId, type),
            member: groupHistoryMember(record.member, type),
            index: groupHistoryIndex(record.index, type),
        };
        return type === "versionGroup.addMember"
            ? _addMemberToGroup.of(payload)
            : _removeMemberFromGroup.of(payload);
    }
    if (type === "versionGroup.rename") {
        const record = groupHistoryRecord(value, type);
        return _renameVersionGroup.of({
            groupId: groupHistoryString(record.groupId, type),
            label: groupHistoryString(record.label, type),
        });
    }
    return undefined;
}

// ── Reducer helpers ─────────────────────────────────────────────

/** Remove a member from whatever group currently holds it (returns a new map). */
function detachMember(groups: VersionGroups, member: VersionGroupMember): VersionGroups {
    let changed = false;
    const next = mapValues(groups, (g) => {
        if (!g.members.some((m) => membersEqual(m, member))) return g;
        changed = true;
        return { ...g, members: g.members.filter((m) => !membersEqual(m, member)) };
    });
    return changed ? next : groups;
}

/**
 * Drop groups with fewer than two members — a singleton group links nothing.
 * Applied after any membership removal so integrity is self-maintaining.
 */
function dissolveDegenerate(groups: VersionGroups): VersionGroups {
    let changed = false;
    const next: VersionGroups = {};
    for (const [id, g] of Object.entries(groups)) {
        if (g.members.length >= 2) {
            next[id] = g;
        } else {
            changed = true;
        }
    }
    return changed ? next : groups;
}

/**
 * Referential integrity: prune members whose revision was removed or whose
 * specific version was deleted, reading the annotation effects on this same
 * transaction. Returns a possibly-new map.
 */
function pruneForAnnotationEffects(groups: VersionGroups, tr: Transaction): VersionGroups {
    // Collect predicates for members that no longer exist.
    const removedRevisionIds = new Set<number>();
    const deletedVersions: VersionGroupMember[] = [];
    for (const e of tr.effects) {
        if (e.is(removeAnnotation)) {
            removedRevisionIds.add(e.value.id);
        } else if (e.is(_deleteVersionFromRevision)) {
            deletedVersions.push({
                revisionId: e.value.annotationId,
                versionId: e.value.versionId,
            });
        }
    }
    if (removedRevisionIds.size === 0 && deletedVersions.length === 0) return groups;

    let changed = false;
    const pruned = mapValues(groups, (g) => {
        const members = g.members.filter(
            (m) =>
                !removedRevisionIds.has(m.revisionId) &&
                !deletedVersions.some((d) => membersEqual(d, m)),
        );
        if (members.length === g.members.length) return g;
        changed = true;
        return { ...g, members };
    });
    // Degenerate groups are collapsed by the single dissolveDegenerate() at the
    // end of update(); here we only prune.
    return changed ? pruned : groups;
}

// ── The field ───────────────────────────────────────────────────
export const versionGroupField = StateField.define<VersionGroups>({
    create(): VersionGroups {
        return {};
    },
    update(value: VersionGroups, tr: Transaction): VersionGroups {
        let groups = value;

        // Undo restore short-circuits everything: set the snapshot verbatim.
        const restore = tr.effects.find((e) => e.is(_restoreVersionGroups));
        if (restore?.is(_restoreVersionGroups)) {
            return restore.value.groups;
        }

        for (const e of tr.effects) {
            if (e.is(_createVersionGroup)) {
                groups = { ...groups, [e.value.group.id]: e.value.group };
            } else if (e.is(_deleteVersionGroup)) {
                if (groups[e.value.group.id]) {
                    const { [e.value.group.id]: _drop, ...rest } = groups;
                    void _drop;
                    groups = rest;
                }
            } else if (e.is(_addMemberToGroup)) {
                const g0 = groups[e.value.groupId];
                // A group holds at most one version per revision; reject a second.
                if (g0 && !canAddMemberToGroup(g0, e.value.member)) {
                    continue;
                }
                // Exclusive membership: detach from any prior group first.
                groups = detachMember(groups, e.value.member);
                const g = groups[e.value.groupId];
                if (g && !g.members.some((m) => membersEqual(m, e.value.member))) {
                    const index = Math.min(e.value.index ?? g.members.length, g.members.length);
                    groups = {
                        ...groups,
                        [e.value.groupId]: {
                            ...g,
                            members: [
                                ...g.members.slice(0, index),
                                e.value.member,
                                ...g.members.slice(index),
                            ],
                        },
                    };
                }
            } else if (e.is(_removeMemberFromGroup)) {
                const g = groups[e.value.groupId];
                if (g) {
                    groups = {
                        ...groups,
                        [e.value.groupId]: {
                            ...g,
                            members: g.members.filter((m) => !membersEqual(m, e.value.member)),
                        },
                    };
                }
            } else if (e.is(_renameVersionGroup)) {
                const g = groups[e.value.groupId];
                if (g) {
                    groups = { ...groups, [e.value.groupId]: { ...g, label: e.value.label } };
                }
            }
        }

        // Referential integrity: prune members whose revision/version was removed
        // in this same transaction (so undo of the removal restores them too).
        groups = pruneForAnnotationEffects(groups, tr);

        // Dissolve degenerate groups ONCE, after all effects have applied — a
        // group built up from empty (create + per-member adds in one transaction)
        // must not be dissolved mid-construction, and a detach/remove/prune that
        // emptied a group below two members is collapsed here.
        groups = dissolveDegenerate(groups);

        return groups;
    },
    toJSON(value: VersionGroups) {
        return value;
    },
    fromJSON(value: unknown): VersionGroups {
        if (value == null) return {};
        const result = VersionGroupsSchema.safeParse(value);
        if (!result.success) {
            console.warn(
                "[versionGroupField] fromJSON: persisted version-group data failed validation,",
                "starting with an empty group map.",
                result.error.flatten(),
            );
            return {};
        }
        return result.data;
    },
});

// ── Undo inversion ──────────────────────────────────────────────

function memberArraysEqual(a: VersionGroupMember[], b: VersionGroupMember[]): boolean {
    return a.length === b.length && a.every((member, index) => membersEqual(member, b[index]));
}

function hasMember(group: VersionGroup, member: VersionGroupMember): boolean {
    return group.members.some((candidate) => membersEqual(candidate, member));
}

/**
 * Build a semantic inverse without replacing the whole document-level group map.
 *
 * `addToHistory: false` collaboration projections deliberately do not rewrite
 * existing history entries. Thus an inverse captured before a remote projection
 * must only touch groups/members changed by its own transaction. In particular,
 * undoing a rename must not delete an unrelated group that appeared later.
 *
 * Effects are emitted in phases: first discard memberships/groups introduced by
 * the transaction, then recreate dissolved groups and restore removed members.
 * This ordering preserves exclusive membership when a member moved between two
 * groups. Original member indices make the round trip structurally lossless.
 */
function invertVersionGroupChanges(
    before: VersionGroups,
    after: VersionGroups,
): StateEffect<unknown>[] {
    const effects: StateEffect<unknown>[] = [];
    const sharedGroupIds = Object.keys(before).filter((groupId) => after[groupId]);

    // Remove groups and memberships introduced by the transaction.
    for (const [groupId, group] of Object.entries(after)) {
        const previous = before[groupId];
        if (!previous) {
            effects.push(_deleteVersionGroup.of({ group }));
            continue;
        }
        for (const member of group.members) {
            if (!hasMember(previous, member)) {
                effects.push(_removeMemberFromGroup.of({ groupId, member }));
            }
        }
    }

    // Recreate groups that were deleted or dissolved. Building them through the
    // member effect preserves exclusive membership against the current state.
    for (const [groupId, group] of Object.entries(before)) {
        if (after[groupId]) continue;
        effects.push(_createVersionGroup.of({ group: { ...group, members: [] } }));
        group.members.forEach((member, index) => {
            effects.push(_addMemberToGroup.of({ groupId, member, index }));
        });
    }

    for (const groupId of sharedGroupIds) {
        const previous = before[groupId];
        const current = after[groupId];
        const previousMembersStillOrdered = previous.members.filter((member) =>
            hasMember(current, member),
        );
        const currentMembersFromPrevious = current.members.filter((member) =>
            hasMember(previous, member),
        );

        // Public operations don't reorder retained members. A wholesale restore
        // can, though, so fall back to rebuilding just this group when needed.
        if (!memberArraysEqual(previousMembersStillOrdered, currentMembersFromPrevious)) {
            effects.push(_deleteVersionGroup.of({ group: current }));
            effects.push(_createVersionGroup.of({ group: { ...previous, members: [] } }));
            previous.members.forEach((member, index) => {
                effects.push(_addMemberToGroup.of({ groupId, member, index }));
            });
            continue;
        }

        previous.members.forEach((member, index) => {
            if (!hasMember(current, member)) {
                effects.push(_addMemberToGroup.of({ groupId, member, index }));
            }
        });
        if (previous.label !== current.label) {
            effects.push(_renameVersionGroup.of({ groupId, label: previous.label }));
        }
    }

    return effects;
}

export const invertedVersionGroupEffects = invertedEffects.of((transaction: Transaction) => {
    if (transaction.annotation(Transaction.addToHistory) === false) return [];
    const before = transaction.startState.field(versionGroupField);
    const after = transaction.state.field(versionGroupField);
    if (before === after) return [];
    return invertVersionGroupChanges(before, after);
});

// ── Public API (transaction builders) ───────────────────────────
// Each returns a TransactionSpec the caller dispatches. Mirrors the annotation
// builders. Effects are `_`-internal; external code uses these.

/**
 * Create a new group seeded with two members (a group of one links nothing).
 * The two members are detached from any prior group via exclusive membership.
 * Returns the new group id alongside the spec so callers can reference it.
 */
export function createVersionGroup(
    label: string,
    members: [VersionGroupMember, VersionGroupMember, ...VersionGroupMember[]],
): { spec: TransactionSpec; groupId: string; error?: string } {
    const groupId = newGroupId();
    const error = versionGroupMembersError(members);
    if (error) return { spec: {}, groupId, error };
    const group: VersionGroup = { id: groupId, label, members: [] };
    // Create empty, then add members so exclusive-membership detach runs per add.
    const effects: StateEffect<unknown>[] = [_createVersionGroup.of({ group })];
    for (const member of members) {
        effects.push(_addMemberToGroup.of({ groupId, member }));
    }
    return { spec: { effects }, groupId };
}

/** Add (or move) a member into an existing group. No-op spec if the group is gone. */
export function addVersionToGroup(
    state: EditorState,
    groupId: string,
    member: VersionGroupMember,
): TransactionSpec {
    if (!state.field(versionGroupField)[groupId]) return {};
    return { effects: [_addMemberToGroup.of({ groupId, member })] };
}

/** Remove a member from its group (dissolves the group if it drops below two). */
export function removeVersionFromGroup(
    state: EditorState,
    member: VersionGroupMember,
): TransactionSpec {
    const group = groupOfMember(state.field(versionGroupField), member);
    if (!group) return {};
    return { effects: [_removeMemberFromGroup.of({ groupId: group.id, member })] };
}

/** Delete a whole group. */
export function deleteVersionGroup(state: EditorState, groupId: string): TransactionSpec {
    const group = state.field(versionGroupField)[groupId];
    if (!group) return {};
    return { effects: [_deleteVersionGroup.of({ group })] };
}

/** Rename a group. */
export function renameVersionGroup(
    state: EditorState,
    groupId: string,
    label: string,
): TransactionSpec {
    if (!state.field(versionGroupField)[groupId]) return {};
    return { effects: [_renameVersionGroup.of({ groupId, label })] };
}
