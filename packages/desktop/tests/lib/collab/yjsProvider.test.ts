import { collabState, ownerLeftSignal, reconnectAttempt } from "$lib/collab/store";
import { get } from "svelte/store";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockHandler = (data: unknown) => void;
type MockFunction = ReturnType<typeof vi.fn>;

interface MockWebsocketProviderOptions {
    params?: {
        auth?: string;
    };
    connect?: boolean;
    maxBackoffTime?: number;
}

interface TestWebsocketProvider {
    _opts?: MockWebsocketProviderOptions;
    destroy: MockFunction;
    disconnect: MockFunction;
    _testEmit(event: string, data: unknown): void;
}

function testProvider(provider: unknown): TestWebsocketProvider {
    return provider as TestWebsocketProvider;
}

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
        handlers: Map<string, Set<MockHandler>> = new Map();
        destroy = vi.fn();
        disconnect = vi.fn();
        _opts?: MockWebsocketProviderOptions;
        url: string;
        roomname: string;

        constructor(url: string, room: string, _doc: unknown, opts?: MockWebsocketProviderOptions) {
            this.url = url;
            this.roomname = room;
            this._opts = opts;
        }

        on(event: string, handler: MockHandler) {
            if (!this.handlers.has(event)) this.handlers.set(event, new Set());
            this.handlers.get(event)!.add(handler);
        }

        off(event: string, handler: MockHandler) {
            this.handlers.get(event)?.delete(handler);
        }

        _testEmit(event: string, data: unknown) {
            for (const handler of this.handlers.get(event) ?? []) {
                handler(data);
            }
        }
    }

    return { WebsocketProvider: MockWebsocketProvider };
});

// Mock auth
vi.mock("$lib/auth/auth.svelte", () => ({
    getSession: () => ({ access_token: "test-jwt-token" }),
    getUser: () => ({ id: "user-123", email: "test@example.com" }),
}));

// $env/static/public is inlined at transform time, so vi.stubEnv can't reach
// it — the virtual module itself must be mocked.
vi.mock("$env/static/public", () => ({
    PUBLIC_RELAY_URL: "ws://localhost:1234",
}));

// Import after mocks
import { createYjsProvider, disconnectYjsProvider, handleOwnerLeft } from "$lib/collab/yjsProvider";

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
        expect(testProvider(provider)._opts?.params?.auth).toBe("test-jwt-token");
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
        testProvider(provider)._testEmit("sync", true);

        expect(get(collabState)).toBe("connected");
    });

    it("resets reconnectAttempt on sync", async () => {
        reconnectAttempt.set(3);
        const { provider } = await createYjsProvider("doc-123");

        testProvider(provider)._testEmit("sync", true);

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

        expect(testProvider(provider).destroy).toHaveBeenCalled();
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
        expect(testProvider(provider1).destroy).toHaveBeenCalled();

        // Second provider should be active
        expect(provider2).toBeDefined();
    });

    it("sets collabState to reconnecting on first disconnect", async () => {
        const { provider } = await createYjsProvider("doc-123");

        // Simulate disconnect
        testProvider(provider)._testEmit("status", { status: "disconnected" });

        expect(get(collabState)).toBe("reconnecting");
        expect(get(reconnectAttempt)).toBe(1);
    });

    it("increments reconnectAttempt on each connection-close", async () => {
        const { provider } = await createYjsProvider("doc-123");

        // First disconnect sets attempt to 1
        testProvider(provider)._testEmit("status", { status: "disconnected" });
        expect(get(reconnectAttempt)).toBe(1);

        // Subsequent connection-close events increment the counter
        testProvider(provider)._testEmit("connection-close", {});
        expect(get(reconnectAttempt)).toBe(2);

        testProvider(provider)._testEmit("connection-close", {});
        expect(get(reconnectAttempt)).toBe(3);
    });

    it("sets collabState to error after 5 attempts", async () => {
        const { provider } = await createYjsProvider("doc-123");

        // First disconnect
        testProvider(provider)._testEmit("status", { status: "disconnected" });
        expect(get(reconnectAttempt)).toBe(1);

        // 4 more connection-close events (total 5 attempts)
        for (let i = 0; i < 4; i++) {
            testProvider(provider)._testEmit("connection-close", {});
        }

        expect(get(collabState)).toBe("error");
        expect(get(reconnectAttempt)).toBe(5);
    });

    it("calls provider.disconnect() when max attempts reached", async () => {
        vi.useFakeTimers();
        const { provider } = await createYjsProvider("doc-123");

        // First disconnect
        testProvider(provider)._testEmit("status", { status: "disconnected" });

        // 4 more connection-close events (total 5 attempts)
        for (let i = 0; i < 4; i++) {
            testProvider(provider)._testEmit("connection-close", {});
        }

        // disconnect() is called via setTimeout to avoid stack overflow
        vi.runAllTimers();

        expect(testProvider(provider).disconnect).toHaveBeenCalled();
        vi.useRealTimers();
    });

    it("resets reconnectAttempt to 0 on successful sync after reconnecting", async () => {
        const { provider } = await createYjsProvider("doc-123");

        // First disconnect then a connection-close
        testProvider(provider)._testEmit("status", { status: "disconnected" });
        testProvider(provider)._testEmit("connection-close", {});
        expect(get(reconnectAttempt)).toBe(2);
        expect(get(collabState)).toBe("reconnecting");

        // Simulate successful reconnect (sync event)
        testProvider(provider)._testEmit("sync", true);

        expect(get(reconnectAttempt)).toBe(0);
        expect(get(collabState)).toBe("connected");
    });
});
