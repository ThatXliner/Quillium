import { afterEach, describe, expect, it } from "vitest";
import { annotationEventBus } from "$lib/events/annotationEventBus";

let unsubs: Array<() => void> = [];

afterEach(() => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
    annotationEventBus.clearPendingSelections();
});

describe("annotationEventBus", () => {
    it("delivers emitted events to subscribers", () => {
        const received: number[] = [];
        unsubs.push(
            annotationEventBus.on("annotation-add-version", (event) => {
                received.push(event.annotationId);
            }),
        );

        annotationEventBus.emit({ type: "annotation-add-version", annotationId: 7 });

        expect(received).toEqual([7]);
    });

    it("stops delivering events after unsubscribe", () => {
        const received: number[] = [];
        const unsub = annotationEventBus.on("annotation-enter-editor", (event) => {
            received.push(event.annotationId);
        });

        unsub();
        annotationEventBus.emit({ type: "annotation-enter-editor", annotationId: 12 });

        expect(received).toEqual([]);
    });

    it("buffers pending nested editor selections until consumed", () => {
        annotationEventBus.emit({
            type: "pending-nested-editor-selection",
            annotationId: 42,
            from: 3,
            to: 8,
        });

        expect(annotationEventBus.consumePendingSelection(42)).toEqual({
            type: "pending-nested-editor-selection",
            annotationId: 42,
            from: 3,
            to: 8,
        });
        expect(annotationEventBus.consumePendingSelection(42)).toBeUndefined();
    });

    it("keeps pending selections isolated by annotation id", () => {
        annotationEventBus.emit({
            type: "pending-nested-editor-selection",
            annotationId: 1,
            from: 0,
            to: 2,
        });
        annotationEventBus.emit({
            type: "pending-nested-editor-selection",
            annotationId: 2,
            from: 5,
            to: 9,
        });

        expect(annotationEventBus.consumePendingSelection(2)).toEqual({
            type: "pending-nested-editor-selection",
            annotationId: 2,
            from: 5,
            to: 9,
        });
        expect(annotationEventBus.consumePendingSelection(1)).toEqual({
            type: "pending-nested-editor-selection",
            annotationId: 1,
            from: 0,
            to: 2,
        });
    });

    it("clears buffered selections when requested", () => {
        annotationEventBus.emit({
            type: "pending-nested-editor-selection",
            annotationId: 5,
            from: 10,
            to: 14,
        });

        annotationEventBus.clearPendingSelections();

        expect(annotationEventBus.consumePendingSelection(5)).toBeUndefined();
    });
});
