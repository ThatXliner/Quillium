import { afterEach, describe, expect, it } from "vitest";
import { appEventBus } from "$lib/events/appEventBus";

let unsubs: Array<() => void> = [];

afterEach(() => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
});

describe("appEventBus", () => {
    it("delivers dictionary-open events to subscribers", () => {
        const received: string[] = [];
        unsubs.push(
            appEventBus.on("dictionary-open", (event) => {
                received.push(event.word);
            }),
        );

        appEventBus.emit({
            type: "dictionary-open",
            word: "helpful",
            selectionFrom: 0,
            selectionTo: 7,
            x: 12,
            y: 24,
        });

        expect(received).toEqual(["helpful"]);
    });

    it("stops delivering after unsubscribe", () => {
        const received: string[] = [];
        const unsub = appEventBus.on("ai-open-chat", (event) => {
            received.push(event.message);
        });

        unsub();
        appEventBus.emit({ type: "ai-open-chat", message: "hello" });

        expect(received).toEqual([]);
    });
});
