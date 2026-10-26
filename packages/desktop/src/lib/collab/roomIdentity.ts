export type LiveRelayRoomIdentityInput = {
    documentId: string | null | undefined;
    isJoiner: boolean;
    activeRoomId?: string | null | undefined;
};

export function getLiveRelayRoomId(input: LiveRelayRoomIdentityInput): string {
    return input.activeRoomId ?? (input.isJoiner ? "" : (input.documentId ?? ""));
}
