import { describe, it, expect } from "vitest";
import { encode, decode, type ClientMessage, type ServerMessage } from "../src/protocol.js";

describe("protocol", () => {
    it("round-trips a pullUpdates message", () => {
        const msg: ClientMessage = { type: "pullUpdates", version: 5 };
        const encoded = encode(msg);
        expect(typeof encoded).toBe("string");
        const decoded = decode(encoded);
        expect(decoded).toEqual(msg);
    });

    it("round-trips a pushUpdates message", () => {
        const msg: ClientMessage = {
            type: "pushUpdates",
            version: 5,
            updates: [
                { changes: { sections: [3, 0, "hello"] }, clientID: "abc" },
            ],
        };
        const encoded = encode(msg);
        const decoded = decode(encoded);
        expect(decoded).toEqual(msg);
    });

    it("round-trips a serverPull response", () => {
        const msg: ServerMessage = {
            type: "pullUpdates",
            updates: [
                { changes: { sections: [3, 0, "hello"] }, clientID: "abc" },
            ],
        };
        const encoded = encode(msg);
        const decoded = decode(encoded);
        expect(decoded).toEqual(msg);
    });

    it("round-trips a serverPush response", () => {
        const msg: ServerMessage = { type: "pushUpdates", ok: true };
        const encoded = encode(msg);
        const decoded = decode(encoded);
        expect(decoded).toEqual(msg);
    });

    it("throws on invalid JSON", () => {
        expect(() => decode("not json")).toThrow();
    });
});
