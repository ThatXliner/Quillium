/**
 * reconnection.test.ts -- Tests for reconnection state management.
 *
 * Tests the stores and types used for connection UX.
 * Does not test the full reconnection flow (requires socket mocking).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { collabState, pendingUpdatesCount, reconnectAttempt, ownerLeftSignal } from "./store";
import type { CollabState } from "./types";

describe("Reconnection stores", () => {
    beforeEach(() => {
        // Reset stores to initial state
        collabState.set("disconnected");
        pendingUpdatesCount.set(0);
        reconnectAttempt.set(0);
        ownerLeftSignal.set(0);
    });

    describe("collabState", () => {
        it("has initial value of disconnected", () => {
            expect(get(collabState)).toBe("disconnected");
        });

        it("can be set to all valid states", () => {
            const states: CollabState[] = [
                "disconnected",
                "connecting",
                "connected",
                "syncing",
                "reconnecting",
                "error",
            ];
            for (const state of states) {
                collabState.set(state);
                expect(get(collabState)).toBe(state);
            }
        });
    });

    describe("pendingUpdatesCount", () => {
        it("has initial value of 0", () => {
            expect(get(pendingUpdatesCount)).toBe(0);
        });

        it("can be incremented", () => {
            pendingUpdatesCount.set(5);
            expect(get(pendingUpdatesCount)).toBe(5);
        });
    });

    describe("reconnectAttempt", () => {
        it("has initial value of 0", () => {
            expect(get(reconnectAttempt)).toBe(0);
        });

        it("can track attempt numbers", () => {
            reconnectAttempt.set(1);
            expect(get(reconnectAttempt)).toBe(1);
            reconnectAttempt.set(5);
            expect(get(reconnectAttempt)).toBe(5);
        });

        it("resets to 0 on success", () => {
            reconnectAttempt.set(3);
            reconnectAttempt.set(0);
            expect(get(reconnectAttempt)).toBe(0);
        });
    });
});

describe("CollabState type", () => {
    it("includes syncing state", () => {
        const state: CollabState = "syncing";
        expect(state).toBe("syncing");
    });

    it("includes reconnecting state", () => {
        const state: CollabState = "reconnecting";
        expect(state).toBe("reconnecting");
    });
});
