/**
 * version-groups.test.ts -- Two-peer Yjs sync for versionGroupField (#273).
 *
 * Covers live create/rename/delete/member add/remove between peers. Each step
 * uses flushAll(), whose state-vector cap fails loudly on feedback loops.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    connect,
    flushAll,
    makePeerWithVersionGroupSync,
    teardown,
    type Peer,
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

function groups(peer: Peer) {
    return peer.view.state.field(versionGroupField);
}

describe("version group sync", () => {
    let peerA: Peer;
    let peerB: Peer;
    let disconnect: () => void;

    const memberA: VersionGroupMember = { revisionId: 1, versionId: "formal-a" };
    const memberB: VersionGroupMember = { revisionId: 2, versionId: "formal-b" };
    const memberC: VersionGroupMember = { revisionId: 3, versionId: "formal-c" };

    beforeEach(async () => {
        peerA = makePeerWithVersionGroupSync("peer-a", "hello world");
        peerB = makePeerWithVersionGroupSync("peer-b");
        disconnect = connect(peerA, peerB);
        await flushAll(peerA, peerB);
    });

    afterEach(() => {
        disconnect();
        teardown(peerA);
        teardown(peerB);
    });

    it("syncs create, rename, delete, and member add/remove without feedback loops", async () => {
        const created = createVersionGroup("Formal", [memberA, memberB]);

        peerA.view.dispatch(created.spec);
        await flushAll(peerA, peerB);

        expect(groups(peerB)[created.groupId]).toEqual({
            id: created.groupId,
            label: "Formal",
            members: [memberA, memberB],
        });

        peerA.view.dispatch(renameVersionGroup(peerA.view.state, created.groupId, "Polished"));
        await flushAll(peerA, peerB);

        expect(groups(peerB)[created.groupId]?.label).toBe("Polished");

        peerB.view.dispatch(addVersionToGroup(peerB.view.state, created.groupId, memberC));
        await flushAll(peerA, peerB);

        expect(groups(peerA)[created.groupId]?.members).toEqual([memberA, memberB, memberC]);

        peerA.view.dispatch(removeVersionFromGroup(peerA.view.state, memberB));
        await flushAll(peerA, peerB);

        expect(groups(peerB)[created.groupId]?.members).toEqual([memberA, memberC]);

        peerB.view.dispatch(deleteVersionGroup(peerB.view.state, created.groupId));
        await flushAll(peerA, peerB);

        expect(groups(peerA)[created.groupId]).toBeUndefined();
        expect(groups(peerB)[created.groupId]).toBeUndefined();
        expect(peerA.yVersionGroups.size).toBe(0);
        expect(peerB.yVersionGroups.size).toBe(0);
    });
});
