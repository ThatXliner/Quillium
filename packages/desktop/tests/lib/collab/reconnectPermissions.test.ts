import { webcrypto } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import { collabCompartment, disableCollab, enableCollab } from "$lib/collab";
import { AnnotationIdMap, codeMirrorToYjsAnnotation } from "$lib/collab/annotationSchema";
import { getCommentSubmission } from "$lib/collab/commentSubmission.svelte";
import { roleContext } from "$lib/collab/roleContext";
import { createRolePermissions } from "$lib/collab/rolePermissions";
import { collabSession, collabState, isCollabJoiner, joinerPriorView } from "$lib/collab/store";
import {
    accessChangedSignal,
    disconnectYjsProvider,
    prepareCommentOperation,
} from "$lib/collab/yjsProvider";
import { historyCompartment } from "$lib/editor/extensions";
import {
    addAnnotation,
    annotationField,
    removeAnnotation,
} from "$lib/editor/plugins/annotations/annotationField";
import { getDraft, setDraft } from "$lib/editor/plugins/annotations/drafts.svelte";
import { isAnnotationOfType } from "$lib/editor/plugins/annotations/models";
import { createNestedEditorState } from "$lib/editor/plugins/annotations/nestedEditor";
import { versionGroupField } from "$lib/editor/plugins/annotations/versionGroupField";
import { currentDraftId, modalStack } from "$lib/stores";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { get } from "svelte/store";
import { expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type {
    WebSocketServer as RelayServer,
    WebSocket as RelaySocket,
} from "../../../../relay/src/server";
import { setupYjsConnection } from "../../../../relay/src/yjs/sync";

const runtime = vi.hoisted(() => ({ relayUrl: "" }));
vi.mock("$lib/auth/auth.svelte", () => ({
    getSession: () => ({ access_token: "local-test-token" }),
    getUser: () => ({ id: "local-test-user" }),
    getCurrentUserName: () => "Local reviewer",
}));
vi.mock("$env/static/public", () => ({
    get PUBLIC_RELAY_URL() {
        return runtime.relayUrl;
    },
    PUBLIC_SUPABASE_URL: "",
    PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
}));
vi.mock("$lib/appLog", () => ({ logAppEvent: vi.fn() }));
vi.mock("$lib/navigation", () => ({ goToEditor: vi.fn(), goToLibrary: vi.fn() }));

it("restores the local draft instead of retaining editor capabilities after offline downgrade", async () => {
    const { WebSocket, WebSocketServer } = createRequire(
        path.resolve(process.cwd(), "../relay/package.json"),
    )("ws") as {
        WebSocket: unknown;
        WebSocketServer: new (options: { port: number; host: string }) => RelayServer;
    };
    vi.stubGlobal("WebSocket", WebSocket);
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local server address");
    runtime.relayUrl = `ws://127.0.0.1:${address.port}`;
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalState(null);
    doc.getText("document").insert(0, "Authoritative text");
    const room = {
        documentId: "local-room",
        ydoc: doc,
        awareness,
        clients: new Set<RelaySocket>(),
        cleanupTimer: null,
        isOwnerConnected: true,
        ownerId: "owner",
    };
    let role: "editor" | "viewer" = "editor";
    server.on("connection", (socket) =>
        setupYjsConnection(socket, room, {
            userId: "local-test-user",
            documentId: "local-room",
            isOwner: false,
            isAnonymous: true,
            role,
        }),
    );
    const view = new EditorView({
        parent: document.body,
        state: EditorState.create({
            doc: "Local draft",
            extensions: [
                annotationField,
                versionGroupField,
                collabCompartment.of([]),
                historyCompartment.of([]),
            ],
        }),
    });
    joinerPriorView.set({
        draftId: "local-draft",
        viewType: "editor",
        editorStateJson: view.state.toJSON({ annotationField, versionGroupField }),
    });
    isCollabJoiner.set(true);
    currentDraftId.set(null);
    const initialSignal = get(accessChangedSignal);
    const stop = accessChangedSignal.subscribe((signal) => {
        if (signal !== initialSignal) disableCollab(view);
    });
    try {
        await enableCollab(view, "local-room", "local-test-user", false, {
            token: "local-invitation",
            role: "editor",
        });
        expect(view.state.doc.toString()).toBe("Authoritative text");
        modalStack.push({
            type: "comment",
            commentId: 1,
            parentView: view,
            label: "Live Room comment",
        });
        role = "viewer";
        for (const socket of server.clients) socket.terminate();
        await vi.waitFor(() => expect(get(collabSession)).toBeNull(), { timeout: 5000 });
        expect(view.state.doc.toString()).toBe("Local draft");
        expect(view.state.facet(roleContext)).toBeUndefined();
        expect(get(currentDraftId)).toBe("local-draft");
        expect(get(modalStack)).toHaveLength(0);
        expect(doc.getText("document").toString()).toBe("Authoritative text");
    } finally {
        stop();
        disconnectYjsProvider();
        view.destroy();
        isCollabJoiner.set(false);
        joinerPriorView.set(null);
        currentDraftId.set(null);
        for (const socket of server.clients) socket.terminate();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        awareness.destroy();
        doc.destroy();
        vi.unstubAllGlobals();
    }
}, 15000);

it("retries the same immutable comment operation after its acknowledgment is lost", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { WebSocket, WebSocketServer } = createRequire(
        path.resolve(process.cwd(), "../relay/package.json"),
    )("ws") as {
        WebSocket: unknown;
        WebSocketServer: new (options: { port: number; host: string }) => RelayServer;
    };
    vi.stubGlobal("WebSocket", WebSocket);
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local server address");
    runtime.relayUrl = `ws://127.0.0.1:${address.port}`;
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalState(null);
    doc.getText("document").insert(0, "Authoritative text");
    const room = {
        documentId: "retry-room",
        ydoc: doc,
        awareness,
        clients: new Set<RelaySocket>(),
        cleanupTimer: null,
        isOwnerConnected: true,
        ownerId: "owner",
    };
    let connections = 0;
    let currentSocket: RelaySocket | undefined;
    let loseAcknowledgment = true;
    server.on("connection", (socket) => {
        connections++;
        currentSocket = socket;
        setupYjsConnection(socket, room, {
            userId: "joiner",
            documentId: room.documentId,
            isOwner: false,
            isAnonymous: true,
            role: "commenter",
        });
    });
    doc.on("update", () => {
        if (loseAcknowledgment && doc.getMap("annotations").size === 1) {
            loseAcknowledgment = false;
            currentSocket?.terminate();
        }
    });
    const view = new EditorView({
        parent: document.body,
        state: EditorState.create({
            extensions: [
                annotationField,
                versionGroupField,
                collabCompartment.of([]),
                historyCompartment.of([]),
            ],
        }),
    });
    try {
        await enableCollab(view, room.documentId, "joiner", false, {
            token: "invitation",
            role: "commenter",
        });
        const context = view.state.facet(roleContext);
        if (!context) throw new Error("Missing role context");
        const operation = prepareCommentOperation({
            kind: "createComment",
            scope: [],
            start: Array.from(
                Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(context.text, 0)),
            ),
            end: Array.from(
                Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(context.text, 5)),
            ),
            message: "Apply once",
        });
        const first = operation().then(
            () => "confirmed",
            () => "unconfirmed",
        );
        await vi.waitFor(() => expect(doc.getMap("annotations").size).toBe(1));
        await vi.waitFor(() => expect(connections).toBe(2), { timeout: 5000 });
        await vi.waitFor(() => expect(get(collabState)).toBe("connected"), { timeout: 5000 });
        expect(await first).toBe("unconfirmed");
        await operation();
        expect(doc.getMap("annotations").size).toBe(1);
        const comment = Array.from(doc.getMap<Y.Map<unknown>>("annotations").values())[0];
        expect((comment.get("thread") as Y.Array<unknown>).length).toBe(1);
    } finally {
        disconnectYjsProvider();
        view.destroy();
        collabSession.set(null);
        for (const socket of server.clients) socket.terminate();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        awareness.destroy();
        doc.destroy();
        vi.unstubAllGlobals();
    }
}, 25000);

it("preserves the retry identity when a nested editor is reopened", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { WebSocket, WebSocketServer } = createRequire(
        path.resolve(process.cwd(), "../relay/package.json"),
    )("ws") as {
        WebSocket: unknown;
        WebSocketServer: new (options: { port: number; host: string }) => RelayServer;
    };
    vi.stubGlobal("WebSocket", WebSocket);
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    runtime.relayUrl = `ws://127.0.0.1:${address.port}`;
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalState(null);
    const text = doc.getText("document");
    text.insert(0, "Authoritative text");
    const revision = codeMirrorToYjsAnnotation(
        {
            id: 0,
            _type: "revision",
            status: "active",
            thread: [],
            selection: EditorSelection.single(0, text.length),
            versions: [{ id: "v1", doc: text.toString(), provenance: "human" }],
            activeVersionId: "v1",
        },
        text,
        "owner",
        doc,
    );
    doc.getMap("annotations").set("revision", revision);
    const version = (revision.get("versions") as Y.Map<Y.Map<unknown>>).get("v1")!;
    const nestedText = version.get("text") as Y.Text;
    const nestedAnnotations = version.get("annotations") as Y.Map<Y.Map<unknown>>;
    const comment = codeMirrorToYjsAnnotation(
        {
            id: 0,
            _type: "comment",
            status: "active",
            selection: EditorSelection.single(0, 5),
            thread: [{ message: "Original", author: "Owner", time: 1 }],
        },
        nestedText,
        "owner",
        doc,
    );
    nestedAnnotations.set("comment", comment);
    const thread = comment.get("thread") as Y.Array<unknown>;
    const room = {
        documentId: "retry-room",
        ydoc: doc,
        awareness,
        clients: new Set<RelaySocket>(),
        cleanupTimer: null,
        isOwnerConnected: true,
        ownerId: "owner",
    };
    let currentSocket: RelaySocket | undefined;
    let loseAcknowledgment = true;
    server.on("connection", (socket) => {
        currentSocket = socket;
        setupYjsConnection(socket, room, {
            userId: "joiner",
            documentId: room.documentId,
            isOwner: false,
            isAnonymous: true,
            role: "commenter",
        });
    });
    doc.on("update", () => {
        if (loseAcknowledgment && thread.length === 2) {
            loseAcknowledgment = false;
            currentSocket?.terminate();
        }
    });
    const view = new EditorView({
        parent: document.body,
        state: EditorState.create({
            extensions: [
                annotationField,
                versionGroupField,
                collabCompartment.of([]),
                historyCompartment.of([]),
            ],
        }),
    });
    let nested: EditorView | undefined;
    const reopen = (): EditorView => {
        const revision = view.state.field(annotationField)[0];
        if (!isAnnotationOfType(revision, "revision")) throw new Error("Missing revision");
        return new EditorView({
            parent: document.body,
            state: createNestedEditorState(revision.versions[0], () => {}, view, 0),
        });
    };
    try {
        await enableCollab(view, room.documentId, "joiner", false, {
            token: "invitation",
            role: "commenter",
        });
        await vi.waitFor(() => expect(view.state.field(annotationField)[0]).toBeDefined());
        nested = reopen();
        setDraft(nested, 0, "Apply once");
        const first = getCommentSubmission(nested, 0)!.send(getDraft(nested, 0));
        await vi.waitFor(() => expect(thread.length).toBe(2));
        expect(await first).toBe(false);
        await vi.waitFor(() => expect(get(collabState)).toBe("connected"));
        nested.destroy();
        nested = reopen();
        expect(getDraft(nested, 0)).toBe("Apply once");
        expect(await getCommentSubmission(nested, 0)!.send(getDraft(nested, 0))).toBe(true);
        expect(thread.length).toBe(2);
    } finally {
        nested?.destroy();
        disconnectYjsProvider();
        view.destroy();
        collabSession.set(null);
        for (const socket of server.clients) socket.terminate();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        awareness.destroy();
        doc.destroy();
        vi.unstubAllGlobals();
    }
}, 25000);

it("does not reuse a cancelled pending comment's anchors for a new comment", async () => {
    const doc = new Y.Doc();
    const text = doc.getText("document");
    text.insert(0, "First and second passage");
    const prepared: number[] = [];
    let first = true;
    let sentStart: number | undefined;
    const view = new EditorView({
        parent: document.body,
        state: EditorState.create({
            doc: text.toString(),
            extensions: [
                annotationField,
                createRolePermissions({
                    role: "commenter",
                    text,
                    annotations: doc.getMap("annotations"),
                    ids: new AnnotationIdMap(),
                    scope: [],
                    prepareComment(command) {
                        if (command.kind !== "createComment") throw new Error("Unexpected reply");
                        const start = Y.createAbsolutePositionFromRelativePosition(
                            Y.decodeRelativePosition(Uint8Array.from(command.start)),
                            doc,
                        )!.index;
                        prepared.push(start);
                        return async () => {
                            if (first) {
                                first = false;
                                throw new Error("Connection unavailable");
                            }
                            sentStart = start;
                        };
                    },
                }),
            ],
        }),
    });
    try {
        view.dispatch({
            effects: addAnnotation.of({
                id: 0,
                _type: "comment",
                status: "pending",
                thread: [],
                selection: EditorSelection.single(0, 5),
            }),
        });
        const cancelled = getCommentSubmission(view, 0)!;
        expect(await cancelled.send("Please clarify")).toBe(false);
        view.dispatch({ effects: removeAnnotation.of(view.state.field(annotationField)[0]) });
        view.dispatch({
            effects: addAnnotation.of({
                id: 0,
                _type: "comment",
                status: "pending",
                thread: [],
                selection: EditorSelection.single(10, 16),
            }),
        });
        expect(await cancelled.send("Please clarify")).toBe(false);
        expect(await getCommentSubmission(view, 0)!.send("Please clarify")).toBe(true);
        expect(sentStart).toBe(10);
        expect(prepared).toEqual([0, 10]);
    } finally {
        view.destroy();
        doc.destroy();
    }
});

it("does not let an old acknowledgment remove a replacement pending comment", async () => {
    const doc = new Y.Doc();
    const text = doc.getText("document");
    text.insert(0, "First and second passage");
    let accept: (() => void) | undefined;
    const view = new EditorView({
        parent: document.body,
        state: EditorState.create({
            doc: text.toString(),
            extensions: [
                annotationField,
                createRolePermissions({
                    role: "commenter",
                    text,
                    annotations: doc.getMap("annotations"),
                    ids: new AnnotationIdMap(),
                    scope: [],
                    prepareComment: () => () =>
                        new Promise<void>((resolve) => {
                            accept = resolve;
                        }),
                }),
            ],
        }),
    });
    try {
        view.dispatch({
            effects: addAnnotation.of({
                id: 0,
                _type: "comment",
                status: "pending",
                thread: [],
                selection: EditorSelection.single(0, 5),
            }),
        });
        const original = getCommentSubmission(view, 0)!.send("Please clarify");
        view.dispatch({ effects: removeAnnotation.of(view.state.field(annotationField)[0]) });
        view.dispatch({
            effects: addAnnotation.of({
                id: 0,
                _type: "comment",
                status: "pending",
                thread: [],
                selection: EditorSelection.single(10, 16),
            }),
        });
        accept?.();
        expect(await original).toBe(false);
        expect(view.state.field(annotationField)[0].selection.main.from).toBe(10);
        expect(getCommentSubmission(view, 0)?.pending).toBe(false);
    } finally {
        view.destroy();
        doc.destroy();
    }
});
