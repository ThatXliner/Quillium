/**
 * annotation-sync.test.ts -- Phase 11 integration tests for annotation sync.
 *
 * Success criteria from ROADMAP.md:
 * 1. Annotations Y.Map entries mirror GenericAnnotation shape
 * 2. createAnnotationSyncPlugin writes via single diff-and-reconcile
 * 3. observeDeep drives single rebuild path
 * 4. Revision version text merges character-by-character
 * 5. activeVersionIndex syncs between peers
 * 6. Add/delete version, thread append round-trip
 * 7. Joiner sees owner's pre-existing annotations on initial sync
 *
 * Wave 0 scaffolds - tests filled in as write path is implemented.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorSelection } from "@codemirror/state";
import {
    makePeerWithAnnotationSync,
    connect,
    teardown,
    type Peer,
} from "./test-helpers/twoPeerHarness";
import { annotationField, addAnnotation } from "$lib/editor/plugins/annotations/annotationField";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";

function createComment(id: number, from: number, to: number): GenericAnnotation {
    return {
        id,
        _type: "comment",
        selection: EditorSelection.single(from, to),
        thread: [],
    };
}

function createRevision(
    id: number,
    from: number,
    to: number,
    doc: string,
): GenericAnnotation {
    return {
        id,
        _type: "revision",
        selection: EditorSelection.single(from, to),
        thread: [],
        versions: [{ doc }],
        activeVersionIndex: 0,
    };
}

describe("annotation sync (Phase 11)", () => {
    let peerA: Peer;
    let peerB: Peer;
    let disconnect: () => void;

    beforeEach(() => {
        peerA = makePeerWithAnnotationSync("peer-a", "hello world");
        peerB = makePeerWithAnnotationSync("peer-b");
        disconnect = connect(peerA, peerB);
    });

    afterEach(() => {
        disconnect();
        teardown(peerA);
        teardown(peerB);
    });

    describe("comment sync", () => {
        it.todo("owner creates comment, joiner sees it");
        it.todo("joiner creates comment, owner sees it");
        it.todo("comment deletion syncs between peers");
    });

    describe("revision sync", () => {
        it.todo("owner creates revision, joiner sees it with version text");
        it.todo("concurrent typing in same version merges character-by-character");
        it.todo("activeVersionIndex switch on owner propagates to joiner");
        it.todo("add version on owner propagates to joiner");
        it.todo("delete version on owner propagates to joiner");
    });

    describe("thread sync", () => {
        it.todo("thread append from owner appears on joiner");
        it.todo("concurrent thread appends from both peers survive");
    });

    describe("initial sync", () => {
        it.todo("joiner sees owner pre-existing annotations on connect");
        it.todo("owner sees joiner pre-existing annotations on connect");
    });
});
