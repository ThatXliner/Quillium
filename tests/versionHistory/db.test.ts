import { describe, it, expect } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import {
    listSnapshots,
    labelSnapshot,
    restoreToSnapshot,
    createNamedSnapshot,
} from "$lib/db";

describe("version history db functions", () => {
    describe("listSnapshots", () => {
        it("invokes cmd_list_snapshots with the correct draftId", async () => {
            const invoked: Array<{ cmd: string; args: unknown }> = [];
            mockIPC((cmd, args) => {
                invoked.push({ cmd, args });
                return [];
            });

            await listSnapshots("draft-abc");

            expect(invoked).toHaveLength(1);
            expect(invoked[0].cmd).toBe("cmd_list_snapshots");
            expect((invoked[0].args as { draftId: string }).draftId).toBe("draft-abc");
        });

        it("returns the array of snapshots from the backend", async () => {
            const snapshots = [
                { id: 1, draftId: "draft-abc", upToEventId: 10, createdAt: 1000, label: "v1" },
                { id: 2, draftId: "draft-abc", upToEventId: 20, createdAt: 2000, label: null },
            ];
            mockIPC(() => snapshots);

            const result = await listSnapshots("draft-abc");

            expect(result).toEqual(snapshots);
        });

        it("returns an empty array when no snapshots exist", async () => {
            mockIPC(() => []);

            const result = await listSnapshots("draft-xyz");

            expect(result).toEqual([]);
        });
    });

    describe("labelSnapshot", () => {
        it("invokes cmd_label_snapshot with the correct snapshotId and label", async () => {
            const invoked: Array<{ cmd: string; args: unknown }> = [];
            mockIPC((cmd, args) => {
                invoked.push({ cmd, args });
                return null;
            });

            await labelSnapshot(42, "My checkpoint");

            expect(invoked).toHaveLength(1);
            expect(invoked[0].cmd).toBe("cmd_label_snapshot");
            const args = invoked[0].args as { snapshotId: number; label: string };
            expect(args.snapshotId).toBe(42);
            expect(args.label).toBe("My checkpoint");
        });
    });

    describe("restoreToSnapshot", () => {
        it("invokes cmd_restore_to_snapshot with draftId and snapshotId", async () => {
            const invoked: Array<{ cmd: string; args: unknown }> = [];
            mockIPC((cmd, args) => {
                invoked.push({ cmd, args });
                return null;
            });

            await restoreToSnapshot("draft-abc", 7);

            expect(invoked).toHaveLength(1);
            expect(invoked[0].cmd).toBe("cmd_restore_to_snapshot");
            const args = invoked[0].args as { draftId: string; snapshotId: number };
            expect(args.draftId).toBe("draft-abc");
            expect(args.snapshotId).toBe(7);
        });
    });

    describe("createNamedSnapshot", () => {
        it("invokes cmd_create_named_snapshot with all required fields", async () => {
            const invoked: Array<{ cmd: string; args: unknown }> = [];
            mockIPC((cmd, args) => {
                invoked.push({ cmd, args });
                if (cmd === "cmd_create_named_snapshot") return 99;
                return null;
            });

            const result = await createNamedSnapshot(
                "draft-abc",
                '{"doc":"hello"}',
                15,
                "Before refactor",
            );

            expect(result).toBe(99);
            expect(invoked).toHaveLength(1);
            expect(invoked[0].cmd).toBe("cmd_create_named_snapshot");
            const args = invoked[0].args as {
                draftId: string;
                stateJson: string;
                upToEventId: number;
                label: string;
            };
            expect(args.draftId).toBe("draft-abc");
            expect(args.stateJson).toBe('{"doc":"hello"}');
            expect(args.upToEventId).toBe(15);
            expect(args.label).toBe("Before refactor");
        });

        it("returns the new snapshot id from the backend", async () => {
            mockIPC(() => 123);

            const id = await createNamedSnapshot("draft-abc", "{}", 0, "label");

            expect(id).toBe(123);
        });
    });
});
