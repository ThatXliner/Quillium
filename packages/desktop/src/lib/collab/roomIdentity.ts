/**
 * roomIdentity.ts -- Live relay room identity helpers.
 *
 * The Live Room still mirrors one active editor view, but the room itself is
 * document-scoped so the identity matches the tabs/drafts model and future
 * multi-tab Omni sessions do not need a new room key.
 */

export type LiveRelayRoomIdentityInput = {
    documentId: string | null | undefined;
    draftId: string | null | undefined;
    activeRoomId?: string | null | undefined;
};

export function getLiveRelayRoomId(input: LiveRelayRoomIdentityInput): string {
    return input.activeRoomId ?? input.documentId ?? "";
}
