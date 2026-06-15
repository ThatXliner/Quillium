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
import { invertedEffects } from "@codemirror/commands";
import { mapValues } from "lodash-es";
import {
    type VersionGroup,
    type VersionGroupMember,
    type VersionGroups,
    VersionGroupsSchema,
    groupOfMember,
    membersEqual,
    newGroupId,
} from "./models";
import { _deleteVersionFromRevision, removeAnnotation } from "./annotationField";

// ── Effects ─────────────────────────────────────────────────────
// All carry enough to invert for undo.
export const _createVersionGroup = StateEffect.define<{ group: VersionGroup }>();
export const _deleteVersionGroup = StateEffect.define<{ group: VersionGroup }>();
export const _addMemberToGroup = StateEffect.define<{
    groupId: string;
    member: VersionGroupMember;
}>();
export const _removeMemberFromGroup = StateEffect.define<{
    groupId: string;
    member: VersionGroupMember;
}>();
export const _renameVersionGroup = StateEffect.define<{ groupId: string; label: string }>();
// Wholesale replacement of the group map. Used only by undo inversion to restore
// a prior snapshot in one step (covers prunes, dissolves, and exclusive-membership
// detaches uniformly, which member-wise inverses get subtly wrong). Applied last.
export const _restoreVersionGroups = StateEffect.define<{ groups: VersionGroups }>();

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
                // Exclusive membership: detach from any prior group first.
                groups = detachMember(groups, e.value.member);
                const g = groups[e.value.groupId];
                if (g && !g.members.some((m) => membersEqual(m, e.value.member))) {
                    groups = {
                        ...groups,
                        [e.value.groupId]: { ...g, members: [...g.members, e.value.member] },
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
// Snapshot-restore inversion. Any transaction that changed the group map — via an
// explicit group effect OR an annotation effect that pruned members — is inverted
// by a single `_restoreVersionGroups` carrying the pre-transaction map. This is
// uniformly correct for creates, deletes, member moves under exclusive
// membership, dissolves, AND referential-integrity prunes (where the trigger is
// an annotation effect, not a group effect). The reference-equality check means
// transactions that only touched text emit no inverse, so they don't pollute the
// group history.
export const invertedVersionGroupEffects = invertedEffects.of((transaction: Transaction) => {
    if (transaction.annotation(Transaction.addToHistory) === false) return [];
    const before = transaction.startState.field(versionGroupField);
    const after = transaction.state.field(versionGroupField);
    if (before === after) return [];
    return [_restoreVersionGroups.of({ groups: before })];
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
): { spec: TransactionSpec; groupId: string } {
    const groupId = newGroupId();
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
