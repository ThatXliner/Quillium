import {
    createNamedSnapshot,
    getSnapshotStorageSize,
    labelSnapshot,
    listSnapshots,
    pruneSnapshotsKeepLastN,
    pruneSnapshotsOlderThan,
    restoreToSnapshot,
} from "$lib/db";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";

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

    describe("getSnapshotStorageSize", () => {
        it("invokes cmd_get_snapshot_storage_size with the correct draftId", async () => {
            const invoked: Array<{ cmd: string; args: unknown }> = [];
            mockIPC((cmd, args) => {
                invoked.push({ cmd, args });
                return 0;
            });

            await getSnapshotStorageSize("draft-abc");

            expect(invoked).toHaveLength(1);
            expect(invoked[0].cmd).toBe("cmd_get_snapshot_storage_size");
            expect((invoked[0].args as { draftId: string }).draftId).toBe("draft-abc");
        });

        it("returns the byte count from the backend", async () => {
            mockIPC(() => 1_500_000);

            const size = await getSnapshotStorageSize("draft-abc");

            expect(size).toBe(1_500_000);
        });

        it("returns 0 when there are no snapshots", async () => {
            mockIPC(() => 0);

            const size = await getSnapshotStorageSize("draft-empty");

            expect(size).toBe(0);
        });
    });

    describe("pruneSnapshotsKeepLastN", () => {
        it("invokes cmd_prune_snapshots_keep_last_n with draftId and keepN", async () => {
            const invoked: Array<{ cmd: string; args: unknown }> = [];
            mockIPC((cmd, args) => {
                invoked.push({ cmd, args });
                return 3;
            });

            await pruneSnapshotsKeepLastN("draft-abc", 10);

            expect(invoked).toHaveLength(1);
            expect(invoked[0].cmd).toBe("cmd_prune_snapshots_keep_last_n");
            const args = invoked[0].args as { draftId: string; keepN: number };
            expect(args.draftId).toBe("draft-abc");
            expect(args.keepN).toBe(10);
        });

        it("returns the number of deleted snapshots", async () => {
            mockIPC(() => 7);

            const deleted = await pruneSnapshotsKeepLastN("draft-abc", 5);

            expect(deleted).toBe(7);
        });

        it("returns 0 when nothing was pruned", async () => {
            mockIPC(() => 0);

            const deleted = await pruneSnapshotsKeepLastN("draft-abc", 100);

            expect(deleted).toBe(0);
        });
    });

    describe("pruneSnapshotsOlderThan", () => {
        it("invokes cmd_prune_snapshots_older_than with draftId and olderThanDays", async () => {
            const invoked: Array<{ cmd: string; args: unknown }> = [];
            mockIPC((cmd, args) => {
                invoked.push({ cmd, args });
                return 2;
            });

            await pruneSnapshotsOlderThan("draft-abc", 30);

            expect(invoked).toHaveLength(1);
            expect(invoked[0].cmd).toBe("cmd_prune_snapshots_older_than");
            const args = invoked[0].args as { draftId: string; olderThanDays: number };
            expect(args.draftId).toBe("draft-abc");
            expect(args.olderThanDays).toBe(30);
        });

        it("returns the number of deleted snapshots", async () => {
            mockIPC(() => 4);

            const deleted = await pruneSnapshotsOlderThan("draft-abc", 7);

            expect(deleted).toBe(4);
        });

        it("returns 0 when nothing was pruned", async () => {
            mockIPC(() => 0);

            const deleted = await pruneSnapshotsOlderThan("draft-abc", 365);

            expect(deleted).toBe(0);
        });
    });
});
