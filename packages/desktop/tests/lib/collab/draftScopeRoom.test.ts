import { once } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import { collabCompartment, disableCollab, enableCollab } from "$lib/collab";
import { codeMirrorToYjsAnnotation } from "$lib/collab/annotationSchema";
import { isCollabJoiner, joinerPriorView } from "$lib/collab/store";
import { disconnectYjsProvider } from "$lib/collab/yjsProvider";
import { historyCompartment } from "$lib/editor/extensions";
import Thread from "$lib/editor/plugins/annotations/Thread.svelte";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import {
    clearDraft,
    commentDraftScopeBridge,
    getDraft,
} from "$lib/editor/plugins/annotations/drafts.svelte";
import { versionGroupField } from "$lib/editor/plugins/annotations/versionGroupField";
import { currentDocumentId, currentDraftId } from "$lib/stores";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type {
    WebSocketServer as RelayServer,
    WebSocket as RelaySocket,
} from "../../../../relay/src/server";
import { setupYjsConnection } from "../../../../relay/src/yjs/sync";

const runtime = vi.hoisted(() => ({ url: "" }));
vi.mock("$lib/auth/auth.svelte", () => ({
    getSession: () => ({ access_token: "review-token" }),
    getUser: () => ({ id: "reviewer" }),
    getCurrentUserName: () => "Reviewer",
}));
vi.mock("$lib/appLog", () => ({ logAppEvent: vi.fn() }));
vi.mock("$lib/navigation", () => ({ goToEditor: vi.fn(), goToLibrary: vi.fn() }));
vi.mock("$env/static/public", () => ({
    get PUBLIC_RELAY_URL() {
        return runtime.url;
    },
    PUBLIC_SUPABASE_URL: "",
    PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
}));

it("does not show a private local reply in an unrelated Live Room comment", async () => {
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
    runtime.url = `ws://127.0.0.1:${address.port}`;
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    awareness.setLocalState(null);
    const ytext = ydoc.getText("document");
    ytext.insert(0, "Remote text");
    const remote = {
        id: 0,
        _type: "comment" as const,
        status: "active" as const,
        selection: EditorSelection.single(0, 4),
        thread: [{ message: "Remote thread", author: "Owner", time: 1 }],
    };
    const node = codeMirrorToYjsAnnotation(remote, ytext, "owner", ydoc);
    ydoc.getMap("annotations").set("remote-comment", node);
    const room = {
        documentId: "review-room",
        ydoc,
        awareness,
        clients: new Set<RelaySocket>(),
        cleanupTimer: null,
        isOwnerConnected: true,
        ownerId: "owner",
    };
    server.on("connection", (socket) =>
        setupYjsConnection(socket, room, {
            userId: "reviewer",
            documentId: "review-room",
            isOwner: false,
            isAnonymous: true,
            role: "commenter",
        }),
    );
    const view = new EditorView({
        parent: document.body,
        state: EditorState.create({
            doc: "Local text",
            extensions: [
                annotationField,
                commentDraftScopeBridge,
                versionGroupField,
                collabCompartment.of([]),
                historyCompartment.of([]),
            ],
        }),
    });
    const local = { ...remote, thread: [{ message: "Local thread", author: "Me", time: 1 }] };
    view.dispatch({ effects: addAnnotation.of(local) });
    currentDocumentId.set("local-document");
    currentDraftId.set("local-draft");
    const component = render(Thread, {
        props: {
            thread: local.thread,
            updateThread: vi.fn(),
            annotationId: 0,
            view,
            commentThread: true,
        },
    });
    const input = component.getByPlaceholderText("Reply…") as HTMLTextAreaElement;
    await fireEvent.input(input, { target: { value: "Private local reply" } });
    expect(getDraft(view, 0)).toBe("Private local reply");
    joinerPriorView.set({
        draftId: "local-draft",
        viewType: "editor",
        editorStateJson: view.state.toJSON({ annotationField, versionGroupField }),
    });
    isCollabJoiner.set(true);
    currentDraftId.set(null);
    try {
        await enableCollab(view, "review-room", "reviewer", false, {
            token: "invitation",
            role: "commenter",
        });
        await vi.waitFor(() =>
            expect(view.state.field(annotationField)[0]?.thread[0]?.message).toBe("Remote thread"),
        );
        await vi.waitFor(() => expect(input.value).toBe(""));
        await fireEvent.input(input, { target: { value: "Private room reply" } });
        expect(getDraft(view, 0)).toBe("Private room reply");
        disableCollab(view);
        await vi.waitFor(() => expect(input.value).toBe("Private local reply"));
        expect(view.state.field(annotationField)[0]?.thread[0]?.message).toBe("Local thread");
    } finally {
        cleanup();
        disableCollab(view);
        disconnectYjsProvider();
        view.destroy();
        clearDraft(view, 0);
        currentDocumentId.set(null);
        currentDraftId.set(null);
        for (const socket of server.clients) socket.terminate();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        awareness.destroy();
        ydoc.destroy();
        vi.unstubAllGlobals();
    }
}, 15000);
