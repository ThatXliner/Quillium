// Live Room handshake and custom frames shared by relay and desktop.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { z } from "zod";

export const HandshakeAuthSchema = z.object({
    token: z.string().trim().min(1, "Token is required"),
    documentId: z.string().uuid("Document ID must be a valid UUID"),
});

// Preserve deployed bytes. Type 3 also means awareness query in y-websocket;
// an empty payload is that query, while our frames include subtype + JSON.
export const MESSAGE_CUSTOM = 3;
export const CUSTOM_OWNER_LEFT = 1;
export const CUSTOM_CLIENT_LEFT = 2;
export const LEGACY_OWNER_LEFT_REASON = "Owner left";

export const CustomMessageSchema = z.discriminatedUnion("subtype", [
    z.object({ subtype: z.literal(CUSTOM_OWNER_LEFT), payload: z.object({}) }),
    z.object({
        subtype: z.literal(CUSTOM_CLIENT_LEFT),
        payload: z.object({ userId: z.string().min(1) }),
    }),
]);
export type CustomMessage = z.infer<typeof CustomMessageSchema>;

export function encodeCustomMessage(message: CustomMessage): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_CUSTOM);
    encoding.writeVarUint(encoder, message.subtype);
    encoding.writeVarString(encoder, JSON.stringify(message.payload));
    return encoding.toUint8Array(encoder);
}

// The provider has already consumed the outer message type. Unknown future
// subtypes and malformed frames are ignored without ending a healthy room.
export function decodeCustomMessage(decoder: decoding.Decoder): CustomMessage | null {
    try {
        const parsed = CustomMessageSchema.safeParse({
            subtype: decoding.readVarUint(decoder),
            payload: JSON.parse(decoding.readVarString(decoder)),
        });
        return parsed.success && !decoding.hasContent(decoder) ? parsed.data : null;
    } catch {
        return null;
    }
}
