import {
    type UndoPeer,
    connect,
    flushAll,
    makeJoinerPeer,
    makeOwnerPeer,
    teardown,
} from "$lib/collab/test-helpers/twoPeerHarness";
import { isolateHistory } from "@codemirror/commands";
import { afterEach, expect, it } from "vitest";

const peers: UndoPeer[] = [];
let disconnect: (() => void) | undefined;
afterEach(() => {
    disconnect?.();
    for (const peer of peers) teardown(peer);
    peers.length = 0;
});

it.each([
    { boundary: "before", undos: ["a", ""] },
    { boundary: "after", undos: ["ab", ""] },
    { boundary: "full", undos: ["ab", "a", ""] },
] as const)(
    "honors $boundary history isolation in personal collaborative undo",
    async ({ boundary, undos }) => {
        const owner = makeOwnerPeer("owner");
        const joiner = makeJoinerPeer("joiner");
        peers.push(owner, joiner);
        disconnect = connect(owner, joiner);
        owner.view.dispatch({ changes: { from: 0, insert: "a" } });
        owner.view.dispatch({
            changes: { from: 1, insert: "b" },
            annotations: isolateHistory.of(boundary),
        });
        owner.view.dispatch({ changes: { from: 2, insert: "c" } });
        await flushAll(owner, joiner);
        expect(joiner.undoManager.canUndo()).toBe(false);
        for (const expected of undos) {
            owner.undoManager.undo();
            await flushAll(owner, joiner);
            for (const peer of peers) {
                expect(peer.ytext.toString()).toBe(expected);
                expect(peer.view.state.doc.toString()).toBe(expected);
            }
        }
        expect(owner.undoManager.canUndo()).toBe(false);
        owner.undoManager.redo();
        await flushAll(owner, joiner);
        const firstRedo = boundary === "after" ? "ab" : "a";
        for (const peer of peers) expect(peer.view.state.doc.toString()).toBe(firstRedo);
    },
);
