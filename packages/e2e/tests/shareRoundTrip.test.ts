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
    isAnnotationOfType,
    readonlySavedFields,
    serializeFromState,
    setActiveRevisionVersion,
    versionGroupField,
} from "@quillium/share/core";
import { describe, expect, it } from "vitest";
import { buildFixtureState, serializeFixtureWire } from "./fixtures";

/** Mirror the landing restore path (ReadonlyDocument.onMount). */
function restoreFromWire(wire: Record<string, unknown>): EditorState {
    return EditorState.fromJSON(
        {
            selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
            ...wire,
        },
        { extensions: getReadonlyExtensions() },
        readonlySavedFields,
    );
}

describe("Omni share round-trip (desktop → wire → landing)", () => {
    it("the wire payload carries exactly the read-only saved fields", () => {
        const { state } = buildFixtureState();
        const wire = serializeFixtureWire(state);

        // Guards against the desktop producer and the share restorer drifting on
        // which fields are persisted. The author's transient selection must
        // stay off the wire; the read-only host supplies its own cursor.
        expect(Object.keys(wire).sort()).toEqual(
            ["annotationField", "doc", "versionGroupField"].sort(),
        );
        expect(Object.keys(readonlySavedFields).sort()).toEqual(
            ["annotationField", "versionGroupField"].sort(),
        );
    });

    it("restores content and every annotation with fidelity", () => {
        const { state, ids } = buildFixtureState();
        const restored = restoreFromWire(serializeFixtureWire(state));
        const projection = serializeFromState(restored);

        expect(projection.content).toBe("The quick brown fox");
        expect(projection.annotations.map((a) => a.id).sort()).toEqual(["1", "2", "3", "4"]);

        const revA = projection.annotations.find((a) => a.id === "1");
        expect(revA?.type).toBe("revision");
        expect(revA?.selectedText).toBe("quick");
        if (!revA || revA.type !== "revision") {
            throw new Error("Expected revision projection");
        }
        expect(revA.versions.map((version) => version.versionId)).toEqual([
            ids.vAQuick,
            ids.vASwift,
        ]);
        expect(revA.versions[0].group).toBeUndefined();
        expect(revA.versions[1].group).toMatchObject({
            label: "Formal voice",
            memberCount: 2,
        });
        expect(revA.versions[1].group?.color).toMatch(/^#[0-9a-f]{6}$/);

        const comment = projection.annotations.find((a) => a.id === "3");
        expect(comment?.type).toBe("comment");
        expect(comment?.thread[0]?.message).toBe("Strong opener.");

        const suggestion = projection.annotations.find((a) => a.id === "4");
        expect(suggestion?.type).toBe("suggestion");
        if (!suggestion || suggestion.type !== "suggestion") {
            throw new Error("Expected suggestion projection");
        }
        expect(suggestion.replacements).toEqual([
            { text: "russet", rationale: "More specific" },
            { text: "umber" },
        ]);
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
        expect(map[1] && isAnnotationOfType(map[1], "revision")).toBe(true);
        expect(map[2] && isAnnotationOfType(map[2], "revision")).toBe(true);
    });
});
