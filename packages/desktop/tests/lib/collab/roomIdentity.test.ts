import { describe, expect, it } from "vitest";
import { getLiveRelayRoomId } from "$lib/collab/roomIdentity";

describe("live relay room identity", () => {
    it("uses the document id even when an active draft id exists", () => {
        expect(
            getLiveRelayRoomId({
                documentId: "doc-123",
                draftId: "draft-456",
            }),
        ).toBe("doc-123");
    });

    it("shows the active collab room id for joiners", () => {
        expect(
            getLiveRelayRoomId({
                activeRoomId: "joined-doc-789",
                documentId: "local-doc-123",
                draftId: null,
            }),
        ).toBe("joined-doc-789");
    });

    it("returns an empty room id when no document is open", () => {
        expect(
            getLiveRelayRoomId({
                documentId: null,
                draftId: null,
            }),
        ).toBe("");
    });
});
