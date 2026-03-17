import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    checkForSuspiciousChange,
    saveEmergencyBackup,
    readBackup,
    clearBackup,
} from "$lib/errorGuard";
import { currentDocumentTitle, documentContent } from "$lib/stores";

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

// ── checkForSuspiciousChange ──────────────────────────────────────

describe("checkForSuspiciousChange", () => {
    it("returns false when deletion is small (< min chars threshold)", () => {
        const old = "Hello world";
        const next = "Hello";
        expect(checkForSuspiciousChange(old, next)).toBe(false);
    });

    it("returns false when deletion is large in chars but small ratio", () => {
        // Delete 150 chars from a 10 000-char doc = 1.5% — below 20% ratio
        const old = "a".repeat(10_000);
        const next = "a".repeat(9_850);
        expect(checkForSuspiciousChange(old, next)).toBe(false);
    });

    it("returns false when insertion (doc grew)", () => {
        const old = "Short text";
        const next = "Short text with more content added";
        expect(checkForSuspiciousChange(old, next)).toBe(false);
    });

    it("returns true and writes backup when >20% of a large doc is deleted", () => {
        const old = "a".repeat(1_000);
        const next = "a".repeat(750); // 25% deleted, 250 chars

        const result = checkForSuspiciousChange(old, next);
        expect(result).toBe(true);

        const backup = readBackup("auto");
        expect(backup).not.toBeNull();
        expect(backup!.documentText).toBe(old);
        expect(backup!.reason).toMatch(/Large deletion detected/);
    });

    it("backup contains old text (before deletion)", () => {
        const old = "The quick brown fox jumps over the lazy dog. ".repeat(10);
        const next = old.slice(0, Math.floor(old.length * 0.5));

        checkForSuspiciousChange(old, next);

        const backup = readBackup("auto");
        expect(backup!.documentText).toBe(old);
    });

    it("returns true exactly at 20% deletion ratio with enough chars", () => {
        // Exactly 20% of 1000 chars = 200 chars (above SUSPICIOUS_DELETION_MIN_CHARS=100)
        const old = "x".repeat(1_000);
        const next = "x".repeat(800); // 200 chars deleted = exactly 20%

        expect(checkForSuspiciousChange(old, next)).toBe(true);
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
});

// ── readBackup / clearBackup ──────────────────────────────────────

describe("readBackup / clearBackup", () => {
    it("returns null when no backup exists", () => {
        expect(readBackup("auto")).toBeNull();
        expect(readBackup("crash")).toBeNull();
    });

    it("clearBackup removes the entry", () => {
        const old = "b".repeat(1_000);
        const next = "b".repeat(700); // 30% deleted
        checkForSuspiciousChange(old, next);

        expect(readBackup("auto")).not.toBeNull();
        clearBackup("auto");
        expect(readBackup("auto")).toBeNull();
    });

    it("auto and crash backups are independent keys", () => {
        // Write an auto backup
        const old = "c".repeat(1_000);
        checkForSuspiciousChange(old, "c".repeat(700));

        expect(readBackup("auto")).not.toBeNull();
        expect(readBackup("crash")).toBeNull();
    });
});
