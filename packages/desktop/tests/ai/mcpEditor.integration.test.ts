import { unregisterEditorialView } from "$lib/ai/editorialTarget";
import { resolveMcpBranch } from "$lib/ai/mcpBranch";
import { createMcpEditorSession } from "$lib/ai/mcpEditor";
import {
    type Peer,
    connect,
    flushAll,
    makeJoinerPeer,
    makeOwnerPeer,
    teardown,
} from "$lib/collab/test-helpers/twoPeerHarness";
import { NestedEditorController } from "$lib/editor/plugins/annotations/NestedEditorController";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { isAnnotationOfType } from "$lib/editor/plugins/annotations/models";
import type { EditorState } from "@codemirror/state";
import { afterEach, expect, it } from "vitest";
import * as Y from "yjs";

type RevisionPath = Parameters<typeof resolveMcpBranch>[1];
const peers: Peer[] = [];
const sessions: ReturnType<typeof createMcpEditorSession>[] = [];
const controllers: NestedEditorController[] = [];
const disconnects: Array<() => void> = [];

afterEach(() => {
    for (const controller of controllers) controller.destroy({ skipFlush: true });
    for (const session of sessions) session.dispose();
    for (const disconnect of disconnects) disconnect();
    for (const peer of peers) {
        unregisterEditorialView(peer.view);
        teardown(peer);
    }
    controllers.length = sessions.length = disconnects.length = peers.length = 0;
    document.body.replaceChildren();
});

function setup(text = "Original.") {
    const owner = makeOwnerPeer("owner", text);
    const joiner = makeJoinerPeer("joiner");
    peers.push(owner, joiner);
    disconnects.push(connect(owner, joiner));
    const session = createMcpEditorSession(() => ({
        rootView: owner.view,
        identity: { documentId: "doc", tabId: "tab", draftId: "draft" },
        metadata: {},
    }));
    sessions.push(session);
    function context(path: RevisionPath = []) {
        return session.handle("get_editor_context", {
            target: { documentId: "doc", tabId: "tab", draftId: "draft", revisionPath: path },
        });
    }
    function write(payload: Record<string, unknown>, path: RevisionPath = []) {
        const contextId = context(path).contextId;
        expect(typeof contextId).toBe("string");
        const result = session.handle("apply_editorial_action", { contextId, ...payload });
        expect(result).toMatchObject({ ok: true });
        return result;
    }
    return { owner, joiner, context, write };
}

function revision(state: EditorState, id?: number) {
    const annotations = state.field(annotationField);
    const annotation =
        id === undefined
            ? Object.values(annotations).find((candidate) =>
                  isAnnotationOfType(candidate, "revision"),
              )
            : annotations[id];
    if (!annotation || !isAnnotationOfType(annotation, "revision")) {
        throw new Error(`Missing revision ${id}`);
    }
    return annotation;
}

function branch(state: EditorState, path: RevisionPath): EditorState {
    const resolved = resolveMcpBranch(state, path);
    if (!resolved) throw new Error("Missing revision branch");
    return resolved.state;
}

function map(value: unknown): Y.Map<unknown> {
    if (!(value instanceof Y.Map)) throw new Error("Missing collaborative annotation map");
    return value;
}

function onlyMap(parent: Y.Map<unknown>): Y.Map<unknown> {
    expect(parent.size).toBe(1);
    return map(Array.from(parent.values())[0]);
}

function sharedVersion(peer: Peer, versionId: string): Y.Map<unknown> {
    return map(map(onlyMap(peer.ymap).get("versions")).get(versionId));
}

it("persists verbatim dictation in both peers and undoes only the writer's insertion", async () => {
    const { owner, joiner, write } = setup("Before. After.");
    const raw = " Um, I was really very excited. ";
    owner.undoManager.clear();
    write({
        requestId: "raw-root",
        action: "insert_dictation",
        position: 7,
        text: raw,
        label: "Dictation",
        threadMessage: "Raw words",
    });
    await flushAll(owner, joiner);
    const versionId = revision(owner.view.state).activeVersionId;
    for (const peer of [owner, joiner]) {
        expect(peer.ytext.toString()).toBe(`Before.${raw} After.`);
        expect(peer.view.state.doc.toString()).toBe(`Before.${raw} After.`);
        expect(sharedVersion(peer, versionId).get("text")?.toString()).toBe(raw);
        expect(revision(peer.view.state).versions[0].provenance).toBe("human");
        expect(revision(peer.view.state).aiProvenance?.requestId).toBe("raw-root");
    }
    expect(joiner.undoManager.canUndo()).toBe(false);
    owner.undoManager.stopCapturing();
    joiner.view.dispatch({ changes: { from: joiner.view.state.doc.length, insert: " Remote." } });
    await flushAll(owner, joiner);
    owner.undoManager.undo();
    await flushAll(owner, joiner);
    for (const peer of [owner, joiner]) {
        expect(peer.ytext.toString()).toBe("Before. After. Remote.");
        expect(Object.values(peer.view.state.field(annotationField))).toHaveLength(0);
    }
    expect(owner.undoManager.canUndo()).toBe(false);
    owner.undoManager.redo();
    await flushAll(owner, joiner);
    for (const peer of [owner, joiner]) {
        expect(peer.view.state.doc.toString()).toBe(`Before.${raw} After. Remote.`);
        expect(sharedVersion(peer, versionId).get("text")?.toString()).toBe(raw);
        expect(revision(peer.view.state).versions[0].provenance).toBe("human");
        expect(revision(peer.view.state).aiProvenance?.requestId).toBe("raw-root");
    }
});

it("replicates inactive nested proposals and raw insertions with one personal undo per write", async () => {
    const { owner, joiner, write } = setup();
    const raw = "I was really very excited. Then I waited.";
    write({
        requestId: "outer",
        action: "wrap_dictation",
        targetText: "Original.",
        label: "Original",
        threadMessage: "Original",
    });
    write({
        requestId: "alternative",
        action: "add_version",
        revisionId: 0,
        label: "Alternative",
        text: raw,
        threadMessage: "Alternative",
    });
    await flushAll(owner, joiner);
    const outer = revision(owner.view.state);
    const versionId = outer.versions[1].id;
    const path = [{ revisionId: outer.id, versionId }];
    owner.undoManager.clear();
    write(
        {
            requestId: "nested-cut",
            action: "revision",
            targetText: "really very ",
            versions: [{ label: "Cut", text: "" }],
            threadMessage: "Remove emphasis",
        },
        path,
    );
    await flushAll(owner, joiner);
    for (const peer of [owner, joiner]) {
        expect(peer.ytext.toString()).toBe("Original.");
        expect(revision(peer.view.state).activeVersionId).toBe(outer.activeVersionId);
        const nested = revision(branch(peer.view.state, path));
        expect(nested.aiProvenance?.requestId).toBe("nested-cut");
        expect(nested.versions[1]).toMatchObject({
            provenance: "ai",
            aiProvenance: { requestId: "nested-cut" },
        });
        expect(revision(peer.view.state).versions[1]).toMatchObject({
            provenance: "ai",
            aiProvenance: { requestId: "alternative" },
        });
        expect(nested.versions.map((version) => version.doc)).toEqual(["really very ", ""]);
        const shared = sharedVersion(peer, versionId);
        expect(shared.get("text")?.toString()).toBe(raw);
        expect(map(shared.get("annotations")).size).toBe(1);
    }
    expect(joiner.undoManager.canUndo()).toBe(false);
    owner.undoManager.undo();
    await flushAll(owner, joiner);
    for (const peer of [owner, joiner]) {
        expect(Object.values(branch(peer.view.state, path).field(annotationField))).toHaveLength(0);
        expect(map(sharedVersion(peer, versionId).get("annotations")).size).toBe(0);
    }
    expect(owner.undoManager.canUndo()).toBe(false);
    owner.undoManager.redo();
    await flushAll(owner, joiner);
    owner.undoManager.clear();
    write(
        {
            requestId: "nested-dictation",
            action: "insert_dictation",
            position: raw.length,
            text: " Um, more raw words. ",
            label: "Dictation",
            threadMessage: "Raw words",
        },
        path,
    );
    await flushAll(owner, joiner);
    for (const peer of [owner, joiner]) {
        expect(sharedVersion(peer, versionId).get("text")?.toString()).toBe(
            `${raw} Um, more raw words. `,
        );
        expect(branch(peer.view.state, path).doc.toString()).toBe(`${raw} Um, more raw words. `);
        expect(Object.values(branch(peer.view.state, path).field(annotationField))).toHaveLength(2);
        expect(peer.ytext.toString()).toBe("Original.");
        expect(revision(peer.view.state).versions[1]).toMatchObject({
            provenance: "mixed",
            aiProvenance: { requestId: "alternative" },
        });
        const inserted = revision(branch(peer.view.state, path), 1);
        expect(inserted.versions[0].provenance).toBe("human");
        expect(inserted.aiProvenance?.requestId).toBe("nested-dictation");
    }
    owner.undoManager.undo();
    await flushAll(owner, joiner);
    for (const peer of [owner, joiner]) {
        expect(sharedVersion(peer, versionId).get("text")?.toString()).toBe(raw);
        expect(Object.values(branch(peer.view.state, path).field(annotationField))).toHaveLength(1);
        expect(revision(peer.view.state).versions[1]).toMatchObject({
            provenance: "ai",
            aiProvenance: { requestId: "alternative" },
        });
    }
    expect(owner.undoManager.canUndo()).toBe(false);
    owner.undoManager.redo();
    await flushAll(owner, joiner);
    for (const peer of [owner, joiner]) {
        expect(sharedVersion(peer, versionId).get("text")?.toString()).toBe(
            `${raw} Um, more raw words. `,
        );
        expect(Object.values(branch(peer.view.state, path).field(annotationField))).toHaveLength(2);
        expect(revision(peer.view.state).versions[1].provenance).toBe("mixed");
        expect(revision(branch(peer.view.state, path), 1).versions[0].provenance).toBe("human");
    }
});

it("preserves an explicit proposal when its mounted nested controller flushes", async () => {
    const { owner, joiner, write } = setup("I was really very excited.");
    write({
        requestId: "outer-mounted",
        action: "wrap_dictation",
        targetText: owner.view.state.doc.toString(),
        label: "Dictation",
        threadMessage: "Raw wording",
    });
    await flushAll(owner, joiner);
    const outer = revision(owner.view.state);
    const path = [{ revisionId: outer.id, versionId: outer.activeVersionId }];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const controller = new NestedEditorController(owner.view, outer.id, {}, "flush");
    controllers.push(controller);
    controller.create(host, outer.versions[0], 0);
    write(
        {
            requestId: "mounted-cut",
            action: "revision",
            targetText: "really very ",
            versions: [{ label: "Cut", text: "" }],
            threadMessage: "Remove emphasis",
        },
        path,
    );
    await flushAll(owner, joiner);
    expect(revision(branch(owner.view.state, path)).versions[1].doc).toBe("");
    controller.destroy();
    await flushAll(owner, joiner);
    for (const peer of [owner, joiner]) {
        expect(revision(branch(peer.view.state, path)).versions[1].doc).toBe("");
        expect(map(sharedVersion(peer, outer.activeVersionId).get("annotations")).size).toBe(1);
    }
});

it("keeps adjacent MCP proposals as separate personal undo steps", async () => {
    const { owner, joiner, write } = setup("I was really very excited. Then I waited.");
    write({
        requestId: "adjacent-outer",
        action: "wrap_dictation",
        targetText: owner.view.state.doc.toString(),
        label: "Dictation",
        threadMessage: "Raw wording",
    });
    await flushAll(owner, joiner);
    const outer = revision(owner.view.state);
    const path = [{ revisionId: outer.id, versionId: outer.activeVersionId }];
    owner.undoManager.clear();
    write(
        {
            requestId: "adjacent-cut",
            action: "revision",
            targetText: "really very ",
            versions: [{ label: "Cut", text: "" }],
            threadMessage: "Remove emphasis",
        },
        path,
    );
    write(
        {
            requestId: "adjacent-rewording",
            action: "revision",
            targetText: "waited",
            versions: [{ label: "Rewording", text: "paused" }],
            threadMessage: "Use a more active verb",
        },
        path,
    );
    await flushAll(owner, joiner);
    owner.undoManager.undo();
    await flushAll(owner, joiner);
    for (const peer of [owner, joiner]) {
        const annotations = Object.values(branch(peer.view.state, path).field(annotationField));
        expect(annotations).toHaveLength(1);
        expect(annotations[0].aiProvenance?.requestId).toBe("adjacent-cut");
    }
    owner.undoManager.undo();
    await flushAll(owner, joiner);
    for (const peer of [owner, joiner]) {
        expect(Object.values(branch(peer.view.state, path).field(annotationField))).toHaveLength(0);
    }
});

it("refreshes the mounted version in place without moving focus or the mapped cursor", async () => {
    const { owner, joiner, write } = setup("I was really very excited.");
    write({
        requestId: "focused-outer",
        action: "wrap_dictation",
        targetText: owner.view.state.doc.toString(),
        label: "Dictation",
        threadMessage: "Raw wording",
    });
    await flushAll(owner, joiner);
    const outer = revision(owner.view.state);
    const path = [{ revisionId: outer.id, versionId: outer.activeVersionId }];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const controller = new NestedEditorController(owner.view, outer.id, {}, "flush");
    controllers.push(controller);
    controller.create(host, outer.versions[0], 0);
    const mounted = controller.editor;
    if (!mounted) throw new Error("Missing mounted editor");
    mounted.dispatch({ selection: { anchor: 3 } });
    mounted.focus();
    write(
        {
            requestId: "focused-cut",
            action: "revision",
            targetText: "really very ",
            versions: [{ label: "Cut", text: "" }],
            threadMessage: "Remove emphasis",
        },
        path,
    );
    controller.flushCurrentStateToParent(false);
    controller.syncVersionFromParent();
    expect(controller.editor).toBe(mounted);
    expect(mounted.hasFocus).toBe(true);
    expect(mounted.state.selection.main.head).toBe(3);
    expect(revision(mounted.state).versions[1].doc).toBe("");
    write(
        {
            requestId: "focused-insert",
            action: "insert_dictation",
            position: 0,
            text: "Um, ",
            label: "Dictation",
            threadMessage: "Raw wording",
        },
        path,
    );
    controller.syncVersionFromParent();
    expect(controller.editor).toBe(mounted);
    expect(mounted.hasFocus).toBe(true);
    expect(mounted.state.selection.main.head).toBe(7);
    expect(mounted.state.doc.toString()).toBe("Um, I was really very excited.");
    expect(Object.values(mounted.state.field(annotationField))).toHaveLength(2);
    controller.destroy();
    await flushAll(owner, joiner);
    expect(Object.values(branch(owner.view.state, path).field(annotationField))).toHaveLength(2);
});

it("preserves unrecognized peer metadata when another local annotation is synchronized", async () => {
    const { owner, joiner, write } = setup();
    write({
        requestId: "metadata-outer",
        action: "wrap_dictation",
        targetText: "Original.",
        label: "Original",
        threadMessage: "Raw words",
    });
    await flushAll(owner, joiner);
    const versionId = revision(owner.view.state).activeVersionId;
    owner.ydoc.transact(() => {
        onlyMap(owner.ymap).set("aiProvenance", { futureRequest: "kept" });
        sharedVersion(owner, versionId).set("aiProvenance", { futureRequest: "kept" });
        sharedVersion(owner, versionId).set("provenance", "future-author");
    }, "future-peer");
    await flushAll(owner, joiner);
    expect(revision(owner.view.state).versions[0].provenance).toBeUndefined();
    write({
        requestId: "metadata-alternative",
        action: "add_version",
        revisionId: revision(owner.view.state).id,
        label: "Alternative",
        text: "A choice.",
        threadMessage: "Another version",
    });
    await flushAll(owner, joiner);
    for (const peer of [owner, joiner]) {
        expect(onlyMap(peer.ymap).get("aiProvenance")).toEqual({ futureRequest: "kept" });
        expect(sharedVersion(peer, versionId).get("aiProvenance")).toEqual({
            futureRequest: "kept",
        });
        expect(sharedVersion(peer, versionId).get("provenance")).toBe("future-author");
        expect(peer.view.state.doc.toString()).toBe("Original.");
    }
});
