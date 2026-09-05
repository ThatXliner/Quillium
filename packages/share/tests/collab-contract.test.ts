import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import {
    CUSTOM_CLIENT_LEFT,
    CUSTOM_OWNER_LEFT,
    MESSAGE_CUSTOM,
    decodeCustomMessage,
    encodeCustomMessage,
} from "../src/collab-contract/index";

describe("deployed custom frame compatibility", () => {
    it("keeps owner-left bytes and decodes existing relays", () => {
        const frame = new Uint8Array([3, 1, 2, 123, 125]);
        expect(encodeCustomMessage({ subtype: CUSTOM_OWNER_LEFT, payload: {} })).toEqual(frame);
        const decoder = decoding.createDecoder(frame);
        expect(decoding.readVarUint(decoder)).toBe(MESSAGE_CUSTOM);
        expect(decodeCustomMessage(decoder)).toEqual({ subtype: CUSTOM_OWNER_LEFT, payload: {} });
    });

    it.each([
        [CUSTOM_CLIENT_LEFT, { userId: "user-123" }, true],
        [CUSTOM_CLIENT_LEFT, { userId: 123 }, false],
        [CUSTOM_OWNER_LEFT, null, false],
        [99, {}, false],
    ])("validates subtype %s and payload %j", (subtype, payload, valid) => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, subtype as number);
        encoding.writeVarString(encoder, JSON.stringify(payload));
        expect(
            decodeCustomMessage(decoding.createDecoder(encoding.toUint8Array(encoder))) !== null,
        ).toBe(valid);
    });

    it.each([[], [1], [1, 8, 123], [1, 2, 123, 125, 0]])(
        "ignores malformed payload %j",
        (...bytes) => {
            expect(decodeCustomMessage(decoding.createDecoder(new Uint8Array(bytes)))).toBeNull();
        },
    );
});
