/**
 * yjsProvider.test.ts -- Tests for WebsocketProvider wrapper.
 *
 * Tests cover:
 * 1. createYjsProvider returns provider, awareness, ydoc, ytext
 * 2. JWT passed in params.auth
 * 3. collabState updates to 'connecting' on start
 * 4. collabState updates to 'connected' on provider sync
 * 5. collabState updates to 'disconnected' on disconnect
 * 6. disconnectYjsProvider destroys provider and clears state
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";
import { collabState, ownerLeftSignal, reconnectAttempt } from "./store";

// Mock y-websocket - factory must define class inline
vi.mock("y-websocket", () => {
    class MockWebsocketProvider {
        awareness = {
            clientID: 1,
            setLocalStateField: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
            destroy: vi.fn(),
        };
        handlers: Map<string, Set<Function>> = new Map();
        destroy = vi.fn();
        _opts: any;
        url: string;
        roomname: string;

        constructor(url: string, room: string, _doc: any, opts?: any) {
            this.url = url;
            this.roomname = room;
            this._opts = opts;
        }

        on(event: string, handler: Function) {
            if (!this.handlers.has(event)) this.handlers.set(event, new Set());
            this.handlers.get(event)!.add(handler);
        }

        off(event: string, handler: Function) {
            this.handlers.get(event)?.delete(handler);
        }

        _testEmit(event: string, data: unknown) {
            this.handlers.get(event)?.forEach((h) => h(data));
        }
    }

    return { WebsocketProvider: MockWebsocketProvider };
});

// Mock auth
vi.mock("$lib/auth/auth.svelte", () => ({
    getSession: () => ({ access_token: "test-jwt-token" }),
    getUser: () => ({ id: "user-123", email: "test@example.com" }),
}));

// Mock env
vi.mock("$env/static/public", () => ({
    PUBLIC_RELAY_URL: "ws://localhost:1234",
}));

// Import after mocks
import { createYjsProvider, disconnectYjsProvider, handleOwnerLeft } from "./yjsProvider";

describe("yjsProvider", () => {
    beforeEach(() => {
        // Reset all stores to initial state
        collabState.set("disconnected");
        ownerLeftSignal.set(0);
        reconnectAttempt.set(0);
        // Ensure no existing connection
        disconnectYjsProvider();
    });

    afterEach(() => {
        disconnectYjsProvider();
    });

    it("returns provider, awareness, ydoc, and ytext", async () => {
        const result = await createYjsProvider("doc-123");

        expect(result.provider).toBeDefined();
        expect(result.awareness).toBeDefined();
        expect(result.ydoc).toBeDefined();
        expect(result.ytext).toBeDefined();

        // ytext should be from ydoc
        expect(result.ytext).toBe(result.ydoc.getText("document"));
    });

    it("passes JWT in params.auth", async () => {
        const { provider } = await createYjsProvider("doc-123");

        // Access the stored opts from the mock
        expect((provider as any)._opts?.params?.auth).toBe("test-jwt-token");
    });

    it("sets collabState to connecting on start", async () => {
        expect(get(collabState)).toBe("disconnected");

        const promise = createYjsProvider("doc-123");

        // State should be connecting immediately after createYjsProvider is called
        expect(get(collabState)).toBe("connecting");

        await promise;
    });

    it("sets collabState to connected on sync", async () => {
        const { provider } = await createYjsProvider("doc-123");

        expect(get(collabState)).toBe("connecting");

        // Simulate sync event from WebsocketProvider
        (provider as any)._testEmit("sync", true);

        expect(get(collabState)).toBe("connected");
    });

    it("resets reconnectAttempt on sync", async () => {
        reconnectAttempt.set(3);
        const { provider } = await createYjsProvider("doc-123");

        (provider as any)._testEmit("sync", true);

        expect(get(reconnectAttempt)).toBe(0);
    });

    it("sets collabState to disconnected on destroy", async () => {
        await createYjsProvider("doc-123");

        disconnectYjsProvider();

        expect(get(collabState)).toBe("disconnected");
    });

    it("destroys provider when disconnectYjsProvider is called", async () => {
        const { provider } = await createYjsProvider("doc-123");

        disconnectYjsProvider();

        expect((provider as any).destroy).toHaveBeenCalled();
    });

    it("increments ownerLeftSignal and disconnects on handleOwnerLeft", async () => {
        await createYjsProvider("doc-123");

        expect(get(ownerLeftSignal)).toBe(0);

        handleOwnerLeft();

        expect(get(ownerLeftSignal)).toBe(1);
        expect(get(collabState)).toBe("disconnected");
    });

    it("cleans up existing connection when creating new one", async () => {
        const { provider: provider1 } = await createYjsProvider("doc-123");

        // Create second connection
        const { provider: provider2 } = await createYjsProvider("doc-456");

        // First provider should have been destroyed
        expect((provider1 as any).destroy).toHaveBeenCalled();

        // Second provider should be active
        expect(provider2).toBeDefined();
    });
});
