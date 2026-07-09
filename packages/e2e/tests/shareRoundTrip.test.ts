/**
 * shareRoundTrip.test.ts — Desktop → wire → landing round-trip for the Omni
 * web preview (Track B), with ZERO infrastructure.
 *
 * Proves that a document serialized the way the desktop publishes it
 * (`state.toJSON(readonlySavedFields)`) can be restored and projected by the
 * @quillium/share core exactly the way the landing `ReadonlyDocument` does
 * (`EditorState.fromJSON(..., getReadonlyExtensions(), readonlySavedFields)`),
 * INCLUDING the linked-revision (version-group) cascade — the fidelity the
 * whole Path A rewrite exists to deliver, and which no single-package test
 * currently covers end to end.
 */
import { EditorState } from "@codemirror/state";
import {
    annotationField,
    getReadonlyExtensions,
    readonlySavedFields,
    serializeFromState,
    setActiveRevisionVersion,
    versionGroupField,
} from "@quillium/share/core";
import { describe, expect, it } from "vitest";
import { buildFixtureState, serializeFixtureWire } from "./fixtures";

/** Mirror the landing restore path (ReadonlyDocument.onMount). */
function restoreFromWire(wire: Record<string, unknown>): EditorState {
    return EditorState.fromJSON(wire, { extensions: getReadonlyExtensions() }, readonlySavedFields);
}

describe("Omni share round-trip (desktop → wire → landing)", () => {
    it("the wire payload carries exactly the read-only saved fields", () => {
        const { state } = buildFixtureState();
        const wire = serializeFixtureWire(state);

        // Guards against the desktop producer and the share restorer drifting on
        // which fields are persisted. `toJSON` also emits doc + selection.
        expect(Object.keys(wire).sort()).toEqual(
            ["annotationField", "doc", "selection", "versionGroupField"].sort(),
        );
        expect(Object.keys(readonlySavedFields).sort()).toEqual(
            ["annotationField", "versionGroupField"].sort(),
        );
    });

    it("restores content and every annotation with fidelity", () => {
        const { state } = buildFixtureState();
        const restored = restoreFromWire(serializeFixtureWire(state));
        const projection = serializeFromState(restored);

        expect(projection.content).toBe("The quick brown fox");
        expect(projection.annotations.map((a) => a.id).sort()).toEqual(["1", "2", "3"]);

        const revA = projection.annotations.find((a) => a.id === "1");
        expect(revA?.type).toBe("revision");
        expect(revA?.selectedText).toBe("quick");

        const comment = projection.annotations.find((a) => a.id === "3");
        expect(comment?.type).toBe("comment");
        expect(comment?.thread[0]?.message).toBe("Strong opener.");
    });

    it("switching a grouped revision cascades to its linked partner", () => {
        const { state, ids } = buildFixtureState();
        const restored = restoreFromWire(serializeFixtureWire(state));

        // Activate revision A's "swift" version. It is linked to revision B's
        // "hound", so the cascade must switch BOTH — even though only A was
        // dispatched, and even though this happens after a full wire round-trip.
        const after = setActiveRevisionVersion(restored, ids.revA, ids.vASwift, {
            moveCursor: true,
        }).state;

        expect(serializeFromState(after).content).toBe("The swift brown hound");
    });

    it("respects version-specific membership (only the linked version cascades)", () => {
        const { state, ids } = buildFixtureState();
        let s = restoreFromWire(serializeFixtureWire(state));

        // Into the linked pair...
        s = setActiveRevisionVersion(s, ids.revA, ids.vASwift, { moveCursor: true }).state;
        expect(serializeFromState(s).content).toBe("The swift brown hound");

        // ...then move revision A back to "quick", which is NOT a group member, so
        // revision B must stay on "hound" (exclusive, version-specific linking).
        s = setActiveRevisionVersion(s, ids.revA, ids.vAQuick, { moveCursor: true }).state;
        expect(serializeFromState(s).content).toBe("The quick brown hound");
    });

    it("keeps the version group intact across the round-trip", () => {
        const { state } = buildFixtureState();
        const restored = restoreFromWire(serializeFixtureWire(state));

        const groups = restored.field(versionGroupField);
        const groupList = Object.values(groups);
        expect(groupList).toHaveLength(1);
        expect(groupList[0].members).toHaveLength(2);

        // Both revisions still exist as switchable revisions after restore.
        const map = restored.field(annotationField);
        expect(map[1]?._type).toBe("revision");
        expect(map[2]?._type).toBe("revision");
    });
});
