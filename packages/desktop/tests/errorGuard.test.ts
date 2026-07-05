import type { GenericAnnotation } from "$lib/editor/plugins/annotations";
import {
    clearBackup,
    isDeepAnnotationLoss,
    isSuspiciousAnnotationChange,
    isSuspiciousDeletion,
    readBackup,
    saveEmergencyBackup,
} from "$lib/errorGuard";
import { currentDocumentTitle, documentContent } from "$lib/stores";
import { EditorSelection } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── localStorage mock ─────────────────────────────────────────────
const store: Record<string, string> = {};

beforeEach(() => {
    // Clear in-memory store between tests
    for (const key of Object.keys(store)) delete store[key];

    vi.stubGlobal("localStorage", {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
            store[k] = v;
        },
        removeItem: (k: string) => {
            delete store[k];
        },
    });

    // Reset svelte stores so documentContent and currentDocumentTitle start clean
    // (the stores module is imported fresh each test run via vitest isolation)
});

// ── isSuspiciousDeletion ──────────────────────────────────────────

describe("isSuspiciousDeletion", () => {
    it("returns false when deletion is small (< min chars threshold)", () => {
        const old = "Hello world";
        const next = "Hello";
        expect(isSuspiciousDeletion(old, next)).toBe(false);
    });

    it("returns false when deletion is large in chars but small ratio", () => {
        // Delete 150 chars from a 10 000-char doc = 1.5% — below 20% ratio
        const old = "a".repeat(10_000);
        const next = "a".repeat(9_850);
        expect(isSuspiciousDeletion(old, next)).toBe(false);
    });

    it("returns false when insertion (doc grew)", () => {
        const old = "Short text";
        const next = "Short text with more content added";
        expect(isSuspiciousDeletion(old, next)).toBe(false);
    });

    it("returns true when >20% of a large doc is deleted", () => {
        const old = "a".repeat(1_000);
        const next = "a".repeat(750); // 25% deleted, 250 chars
        expect(isSuspiciousDeletion(old, next)).toBe(true);
    });

    it("returns true exactly at 20% deletion ratio with enough chars", () => {
        // Exactly 20% of 1000 chars = 200 chars (above SUSPICIOUS_DELETION_MIN_CHARS=100)
        const old = "x".repeat(1_000);
        const next = "x".repeat(800); // 200 chars deleted = exactly 20%
        expect(isSuspiciousDeletion(old, next)).toBe(true);
    });

    it("does not write to localStorage", () => {
        const old = "a".repeat(1_000);
        const next = "a".repeat(750);
        isSuspiciousDeletion(old, next);
        expect(Object.keys(store)).toHaveLength(0);
    });
});

// ── isSuspiciousAnnotationChange ──────────────────────────────────

describe("isSuspiciousAnnotationChange", () => {
    it("returns false when only 1-2 annotations are removed", () => {
        expect(isSuspiciousAnnotationChange(4, 2)).toBe(false); // 2 removed, 50% — but below min=3
    });

    it("returns false when removal count is high but ratio is low", () => {
        // 3 removed from 20 = 15% — below 25% ratio
        expect(isSuspiciousAnnotationChange(20, 17)).toBe(false);
    });

    it("returns false when annotations are added (count grew)", () => {
        expect(isSuspiciousAnnotationChange(2, 5)).toBe(false);
    });

    it("returns false when count is unchanged", () => {
        expect(isSuspiciousAnnotationChange(5, 5)).toBe(false);
    });

    it("returns true when 3+ annotations removed and ratio >= 25%", () => {
        // 3 removed from 10 = 30%
        expect(isSuspiciousAnnotationChange(10, 7)).toBe(true);
    });

    it("returns true when all annotations are removed from a large set", () => {
        expect(isSuspiciousAnnotationChange(10, 0)).toBe(true);
    });

    it("returns false when starting from 0 annotations", () => {
        expect(isSuspiciousAnnotationChange(0, 0)).toBe(false);
    });
});

// ── isDeepAnnotationLoss ─────────────────────────────────────────

function makeSelection(from: number, to: number) {
    return EditorSelection.create([EditorSelection.range(from, to)]);
}

function makeComment(id: number): GenericAnnotation {
    return { _type: "comment", id, thread: [], selection: makeSelection(0, 5) };
}

type TestVersionState = {
    id?: string;
    doc: string;
    label?: string;
    annotationField?: unknown;
};

let _testVersionIdCounter = 0;

function makeRevision(id: number, versions: TestVersionState[]): GenericAnnotation {
    const builtVersions = versions.map((v) => ({
        ...v,
        id: v.id ?? `tv${_testVersionIdCounter++}`,
    }));
    return {
        _type: "revision",
        id,
        thread: [],
        selection: makeSelection(0, 10),
        activeVersionId: builtVersions[0].id,
        versions: builtVersions,
    };
}

describe("isDeepAnnotationLoss", () => {
    it("returns false when no annotations were removed", () => {
        const annotations = { 0: makeComment(0), 1: makeComment(1) };
        expect(isDeepAnnotationLoss(annotations, annotations)).toBe(false);
    });

    it("returns false when a removed revision has no nested annotations", () => {
        const old = {
            0: makeRevision(0, [{ doc: "hello" }]),
        };
        expect(isDeepAnnotationLoss(old, {})).toBe(false);
    });

    it("returns false when a removed revision has <= 3 children and no grandchildren", () => {
        const old = {
            0: makeRevision(0, [
                {
                    doc: "hello",
                    annotationField: { 0: { _type: "comment" }, 1: { _type: "comment" } },
                },
            ]),
        };
        expect(isDeepAnnotationLoss(old, {})).toBe(false);
    });

    it("returns true when a removed revision has > 3 children across versions", () => {
        const old = {
            0: makeRevision(0, [
                {
                    doc: "v1",
                    annotationField: { 0: { _type: "comment" }, 1: { _type: "comment" } },
                },
                {
                    doc: "v2",
                    annotationField: { 0: { _type: "comment" }, 1: { _type: "comment" } },
                },
            ]),
        };
        // 4 total children across 2 versions
        expect(isDeepAnnotationLoss(old, {})).toBe(true);
    });

    it("returns true when a removed revision has a grandchild", () => {
        const old = {
            0: makeRevision(0, [
                {
                    doc: "v1",
                    annotationField: {
                        0: {
                            _type: "revision",
                            versions: [
                                { doc: "nested", annotationField: { 0: { _type: "comment" } } },
                            ],
                        },
                    },
                },
            ]),
        };
        // Only 1 child, but it has a grandchild
        expect(isDeepAnnotationLoss(old, {})).toBe(true);
    });

    it("returns false when a removed annotation is a comment (not a revision)", () => {
        const old = { 0: makeComment(0) };
        expect(isDeepAnnotationLoss(old, {})).toBe(false);
    });

    it("returns false when the revision still exists (not removed)", () => {
        const annotations = {
            0: makeRevision(0, [
                {
                    doc: "v1",
                    annotationField: {
                        0: { _type: "comment" },
                        1: { _type: "comment" },
                        2: { _type: "comment" },
                        3: { _type: "comment" },
                    },
                },
            ]),
        };
        expect(isDeepAnnotationLoss(annotations, annotations)).toBe(false);
    });
});

// ── saveEmergencyBackup ───────────────────────────────────────────

describe("saveEmergencyBackup", () => {
    it("does nothing when documentContent store is empty", () => {
        // Default store value is "" so backup should not be written
        const result = saveEmergencyBackup("test crash");
        expect(result).toBe(false);
        expect(readBackup("crash")).toBeNull();
    });

    it("writes a backup when documentContent store has text", () => {
        documentContent.set("something important");
        currentDocumentTitle.set("My doc");
        const result = saveEmergencyBackup("test crash");
        expect(result).toBe(true);
        const backup = readBackup("crash");
        expect(backup).not.toBeNull();
        expect(backup!.documentText).toBe("something important");
        expect(backup!.documentTitle).toBe("My doc");
        expect(backup!.reason).toBe("test crash");
    });

    it("truncates backup when localStorage is full", () => {
        const longText = "x".repeat(10_000);
        documentContent.set(longText);
        currentDocumentTitle.set("Big doc");

        // Simulate localStorage quota: first setItem throws, then accept smaller writes
        let callCount = 0;
        vi.stubGlobal("localStorage", {
            getItem: (k: string) => store[k] ?? null,
            setItem: (k: string, v: string) => {
                callCount++;
                if (callCount === 1) {
                    throw new DOMException("QuotaExceededError");
                }
                store[k] = v;
            },
            removeItem: (k: string) => {
                delete store[k];
            },
        });

        const result = saveEmergencyBackup("crash");
        expect(result).toBe(true);
        const backup = readBackup("crash");
        expect(backup).not.toBeNull();
        // Should be truncated to 75% (first retry)
        expect(backup!.documentText.length).toBe(7_500);
        expect(backup!.reason).toContain("[truncated to 75%]");
    });

    it("falls back to absolute size limits when percentage truncations fail", () => {
        const longText = "y".repeat(200_000);
        documentContent.set(longText);
        currentDocumentTitle.set("Huge doc");

        // Reject everything above 10k chars of JSON
        vi.stubGlobal("localStorage", {
            getItem: (k: string) => store[k] ?? null,
            setItem: (k: string, v: string) => {
                if (v.length > 12_000) {
                    throw new DOMException("QuotaExceededError");
                }
                store[k] = v;
            },
            removeItem: (k: string) => {
                delete store[k];
            },
        });

        const result = saveEmergencyBackup("crash");
        expect(result).toBe(true);
        const backup = readBackup("crash");
        expect(backup).not.toBeNull();
        expect(backup!.documentText.length).toBe(10_000);
        expect(backup!.reason).toContain("[truncated to 10k chars]");
    });

    it("returns false when localStorage rejects all truncation attempts", () => {
        documentContent.set("some text");
        currentDocumentTitle.set("Doc");

        vi.stubGlobal("localStorage", {
            getItem: (k: string) => store[k] ?? null,
            setItem: () => {
                throw new DOMException("QuotaExceededError");
            },
            removeItem: (k: string) => {
                delete store[k];
            },
        });

        const result = saveEmergencyBackup("crash");
        expect(result).toBe(false);
    });
});

// ── readBackup / clearBackup ──────────────────────────────────────

describe("readBackup / clearBackup", () => {
    it("returns null when no backup exists", () => {
        expect(readBackup("crash")).toBeNull();
    });

    it("clearBackup removes the entry", () => {
        documentContent.set("important text");
        saveEmergencyBackup("test");

        expect(readBackup("crash")).not.toBeNull();
        clearBackup("crash");
        expect(readBackup("crash")).toBeNull();
    });
});
