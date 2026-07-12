/**
 * version-groups.test.ts -- Two-peer Yjs sync for versionGroupField (#273).
 *
 * Covers live create/rename/delete/member add/remove between peers. Each step
 * uses flushAll(), whose state-vector cap fails loudly on feedback loops.
 */
import {
    type Peer,
    connect,
    flushAll,
    makePeerWithVersionGroupSync,
    teardown,
} from "$lib/collab/test-helpers/twoPeerHarness";
import type { VersionGroupMember } from "$lib/editor/plugins/annotations/models";
import {
    addVersionToGroup,
    createVersionGroup,
    deleteVersionGroup,
    removeVersionFromGroup,
    renameVersionGroup,
    versionGroupField,
} from "$lib/editor/plugins/annotations/versionGroupField";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function groups(peer: Peer) {
    return peer.view.state.field(versionGroupField);
}

describe("version group sync", () => {
    let peerA: Peer;
    let peerB: Peer;
    let disconnect: () => void;

    const ownerMemberA: VersionGroupMember = { revisionId: 1, versionId: "formal-a" };
    const ownerMemberB: VersionGroupMember = { revisionId: 2, versionId: "formal-b" };
    const ownerMemberC: VersionGroupMember = { revisionId: 3, versionId: "formal-c" };
    const joinerMemberA: VersionGroupMember = { revisionId: 101, versionId: "formal-a" };
    const joinerMemberB: VersionGroupMember = { revisionId: 102, versionId: "formal-b" };
    const joinerMemberC: VersionGroupMember = { revisionId: 103, versionId: "formal-c" };

    beforeEach(async () => {
        peerA = makePeerWithVersionGroupSync("peer-a", "hello world");
        peerB = makePeerWithVersionGroupSync("peer-b");
        peerA.idMap?.register("revision-a", ownerMemberA.revisionId);
        peerA.idMap?.register("revision-b", ownerMemberB.revisionId);
        peerA.idMap?.register("revision-c", ownerMemberC.revisionId);
        peerB.idMap?.register("revision-a", joinerMemberA.revisionId);
        peerB.idMap?.register("revision-b", joinerMemberB.revisionId);
        peerB.idMap?.register("revision-c", joinerMemberC.revisionId);
        disconnect = connect(peerA, peerB);
        await flushAll(peerA, peerB);
    });

    afterEach(() => {
        disconnect();
        teardown(peerA);
        teardown(peerB);
    });

    it("syncs create, rename, delete, and member add/remove without feedback loops", async () => {
        const created = createVersionGroup("Formal", [ownerMemberA, ownerMemberB]);

        peerA.view.dispatch(created.spec);
        await flushAll(peerA, peerB);

        expect(groups(peerB)[created.groupId]).toEqual({
            id: created.groupId,
            label: "Formal",
            members: [joinerMemberA, joinerMemberB],
        });
        expect(peerA.yVersionGroups.get(created.groupId)?.members).toEqual([
            { revisionId: "revision-a", versionId: "formal-a" },
            { revisionId: "revision-b", versionId: "formal-b" },
        ]);

        peerA.view.dispatch(renameVersionGroup(peerA.view.state, created.groupId, "Polished"));
        await flushAll(peerA, peerB);

        expect(groups(peerB)[created.groupId]?.label).toBe("Polished");

        peerB.view.dispatch(addVersionToGroup(peerB.view.state, created.groupId, joinerMemberC));
        await flushAll(peerA, peerB);

        expect(groups(peerA)[created.groupId]?.members).toEqual([
            ownerMemberA,
            ownerMemberB,
            ownerMemberC,
        ]);

        peerA.view.dispatch(removeVersionFromGroup(peerA.view.state, ownerMemberB));
        await flushAll(peerA, peerB);

        expect(groups(peerB)[created.groupId]?.members).toEqual([joinerMemberA, joinerMemberC]);

        peerB.view.dispatch(deleteVersionGroup(peerB.view.state, created.groupId));
        await flushAll(peerA, peerB);

        expect(groups(peerA)[created.groupId]).toBeUndefined();
        expect(groups(peerB)[created.groupId]).toBeUndefined();
        expect(peerA.yVersionGroups.size).toBe(0);
        expect(peerB.yVersionGroups.size).toBe(0);
    });
});
