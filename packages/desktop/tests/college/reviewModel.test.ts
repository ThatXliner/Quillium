import {
    type CapturedReviewSource,
    type CollegeReviewGroup,
    capturedReviewSourceSchema,
    capturedSourceMetadata,
    cloneCollegeReviewGroup,
    collegeReviewGroupSchema,
    parseCollegeReviewGroup,
    serializeCollegeReviewGroup,
} from "$lib/college/reviewModel";
import { describe, expect, it } from "vitest";

function source(documentId: string, tabId: string, draftId: string) {
    return { documentId, tabId, draftId };
}

function group(overrides: Partial<CollegeReviewGroup> = {}): CollegeReviewGroup {
    return {
        version: 1,
        id: "group-1",
        name: "Application set",
        school: "Example University",
        cycle: "2026",
        sources: [
            source("document-1", "tab-1", "draft-1"),
            source("document-2", "tab-2", "draft-2"),
        ],
        ...overrides,
    };
}

function captured(): CapturedReviewSource {
    return {
        sourceKey: "source-1",
        documentId: "document-1",
        tabId: "tab-1",
        draftId: "draft-1",
        documentLabel: "Essay",
        tabLabel: "Community",
        draftLabel: "First attempt",
        promptLabel: "Supplement",
        promptText: "Tell us about a community.",
        setupSchool: "Example University",
        setupCycle: "2026",
        contentFingerprint: "fingerprint",
        totalChars: 11,
        sentChars: 11,
        omittedChars: 0,
        sentContent: "hello world",
    };
}

describe("College cross-essay review model", () => {
    it("requires distinct tabs as well as distinct draft IDs", () => {
        const sameTab = group({
            sources: [
                source("document-1", "tab-1", "draft-1"),
                source("document-1", "tab-1", "draft-2"),
            ],
        });
        expect(collegeReviewGroupSchema.safeParse(sameTab).success).toBe(false);

        const duplicateDraft = group({
            sources: [
                source("document-1", "tab-1", "draft-1"),
                source("document-2", "tab-2", "draft-1"),
            ],
        });
        expect(collegeReviewGroupSchema.safeParse(duplicateDraft).success).toBe(false);
    });

    it("fails closed for malformed and future group versions", () => {
        expect(() => parseCollegeReviewGroup("not JSON")).toThrow(/valid JSON/i);
        expect(() => parseCollegeReviewGroup({ ...group(), version: 2 })).toThrow(/unsupported/i);
        expect(() => parseCollegeReviewGroup({ ...group(), school: "   " })).toThrow(/blank/i);
    });

    it("round-trips and deep-clones a group", () => {
        const original = group();
        const parsed = parseCollegeReviewGroup(serializeCollegeReviewGroup(original));
        const cloned = cloneCollegeReviewGroup(parsed);
        cloned.sources[0]!.draftId = "changed";
        expect(parsed.sources[0]!.draftId).toBe("draft-1");
    });

    it("keeps persisted report metadata free of transmitted prose", () => {
        const sourceValue = captured();
        expect(capturedReviewSourceSchema.safeParse(sourceValue).success).toBe(true);
        expect(capturedSourceMetadata(sourceValue)).not.toHaveProperty("sentContent");
        expect(capturedSourceMetadata(sourceValue)).toMatchObject({
            sourceKey: sourceValue.sourceKey,
            contentFingerprint: sourceValue.contentFingerprint,
            sentChars: sourceValue.sentChars,
            omittedChars: sourceValue.omittedChars,
        });
    });
});
