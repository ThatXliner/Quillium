import { getLiveRelayRoomId } from "$lib/collab/roomIdentity";
import { describe, expect, it } from "vitest";

describe("live relay room identity", () => {
    it("hides the local room identity while a joiner connects", () => {
        expect(getLiveRelayRoomId({ documentId: "local-doc", isJoiner: true })).toBe("");
    });
    it("uses the document id before starting a session", () => {
        expect(
            getLiveRelayRoomId({
                isJoiner: false,
                documentId: "doc-123",
            }),
        ).toBe("doc-123");
    });

    it("shows the active collab room id for joiners", () => {
        expect(
            getLiveRelayRoomId({
                activeRoomId: "joined-doc-789",
                isJoiner: true,
                documentId: "local-doc-123",
            }),
        ).toBe("joined-doc-789");
    });

    it("returns an empty room id when no document is open", () => {
        expect(
            getLiveRelayRoomId({
                isJoiner: false,
                documentId: null,
            }),
        ).toBe("");
    });
});
