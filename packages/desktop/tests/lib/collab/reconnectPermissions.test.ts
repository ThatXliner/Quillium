import { webcrypto } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import { collabCompartment, disableCollab, enableCollab } from "$lib/collab";
import { roleContext } from "$lib/collab/roleContext";
import { collabSession, collabState, isCollabJoiner, joinerPriorView } from "$lib/collab/store";
import {
    accessChangedSignal,
    disconnectYjsProvider,
    prepareCommentOperation,
} from "$lib/collab/yjsProvider";
import { historyCompartment } from "$lib/editor/extensions";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { versionGroupField } from "$lib/editor/plugins/annotations/versionGroupField";
import { currentDraftId, modalStack } from "$lib/stores";
import { EditorState } from "@codemirror/state";
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
