// sections.ts — Resolve College prompt sections from top-level Markdown H1s.
//
// H1s are document structure, so this module deliberately uses the Markdown
// parser instead of line-oriented matching. That keeps headings inside fenced
// code, blockquotes, and lists out of the section model.

import { parser } from "@lezer/markdown";
import { type CollegePrompt, type CollegeSetup, parseCollegeSetup } from "./model";
import { researchFingerprint } from "./researchModel";

const MAX_ARCHIVED_PROMPTS = 100;
const MAX_PROMPT_TEXT = 4000;
const MAX_PROMPT_LABEL = 200;
const MAX_CONSTRAINT_VALUE = 10_000_000;
const COLLEGE_LIMIT_PATTERN = /\(\s*(\d+)\s+(words?|characters?)\s*\)$/iu;

type CollegeLengthUnit = "words" | "characters";

type ParsedHeading = {
    from: number;
    to: number;
    bodyFrom: number;
    title: string;
    matchText: string;
    limit: { unit: CollegeLengthUnit; max: number } | null;
};

/** One prompt answer and its range in the root draft. */
export type CollegeSection = {
    prompt: CollegePrompt;
    from: number;
    to: number;
    headingFrom: number | null;
    headingTo: number | null;
    wordCount: number;
    characterCount: number;
};

function _plainClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function _normalizeWhitespace(value: string): string {
    return value.replace(/\s+/gu, " ").trim();
}

function _withoutTrailingLimit(value: string): {
    text: string;
    limit: { unit: CollegeLengthUnit; max: number } | null;
} {
    const normalized = _normalizeWhitespace(value);
    const match = COLLEGE_LIMIT_PATTERN.exec(normalized);
    if (!match || match.index === undefined) return { text: normalized, limit: null };
    const max = Number(match[1]);
    if (!Number.isSafeInteger(max) || max > MAX_CONSTRAINT_VALUE) {
        return { text: normalized.slice(0, match.index).trim(), limit: null };
    }
    return {
        text: normalized.slice(0, match.index).trim(),
        limit: {
            unit: match[2].toLowerCase().startsWith("character") ? "characters" : "words",
            max,
        },
    };
}

function _headingTitle(raw: string): string {
    // A closing ATX marker is part of the heading node's source range. Only
    // remove hashes preceded by whitespace, so a title such as "C#" survives.
    return raw
        .trim()
        .replace(/\s+#+\s*$/u, "")
        .trim();
}

function _lineEnd(text: string, offset: number): number {
    if (text[offset] === "\r" && text[offset + 1] === "\n") return offset + 2;
    if (text[offset] === "\r" || text[offset] === "\n") return offset + 1;
    return offset;
}

function _topLevelHeadings(prose: string): ParsedHeading[] {
    const tree = parser.parse(prose);
    const headings: ParsedHeading[] = [];
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
        if (node.type.name !== "ATXHeading1") continue;
        const raw = prose.slice(node.from + 1, node.to);
        const title = _headingTitle(raw);
        const parsed = _withoutTrailingLimit(title);
        headings.push({
            from: node.from,
            to: node.to,
            bodyFrom: _lineEnd(prose, node.to),
            title,
            matchText: parsed.text,
            limit: parsed.limit,
        });
    }
    return headings;
}

function _promptMatchText(prompt: CollegePrompt): string {
    const text = _withoutTrailingLimit(prompt.text).text;
    return text || _withoutTrailingLimit(prompt.label).text;
}

function _wordCount(body: string): number {
    const trimmed = body.trim();
    return trimmed ? trimmed.split(/\s+/u).length : 0;
}

function _characterCount(body: string): number {
    return Array.from(body.trim()).length;
}

function _clip(value: string, maxLength: number): string {
    // Schema string limits count UTF-16 units; avoid splitting a surrogate pair.
    return value.slice(0, maxLength).replace(/[\uD800-\uDBFF]$/u, "");
}

function _newConstraintId(prompt: CollegePrompt, unit: CollegeLengthUnit): string {
    const base = `heading-${unit}`;
    const ids = new Set(prompt.constraints.map((constraint) => constraint.id));
    if (!ids.has(base)) return base;
    let suffix = 2;
    while (ids.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
}

/**
 * Apply the length stated by a heading. H1 structure is authoritative once a
 * heading exists: old numeric word/character maxima are cleared before an
 * explicit heading limit is applied. Constraint IDs remain stable whenever a
 * matching saved constraint already has that value.
 */
function _constraintsForHeading(
    prompt: CollegePrompt,
    limit: { unit: CollegeLengthUnit; max: number } | null,
): CollegePrompt["constraints"] {
    const constraints = prompt.constraints.map((constraint) => ({ ...constraint }));
    const hasMatchingConstraint = constraints.some(
        (constraint) =>
            limit !== null && constraint.unit === limit.unit && constraint.max === limit.max,
    );
    const next = constraints.map((constraint) => {
        if (constraint.unit !== "words" && constraint.unit !== "characters") return constraint;
        if (limit && constraint.unit === limit.unit) {
            return {
                ...constraint,
                min: constraint.min !== null && constraint.min > limit.max ? null : constraint.min,
                max: limit.max,
            };
        }
        return { ...constraint, max: null };
    });
    if (
        limit &&
        !hasMatchingConstraint &&
        !next.some((constraint) => constraint.unit === limit.unit)
    ) {
        next.push({
            id: _newConstraintId(prompt, limit.unit),
            unit: limit.unit,
            min: null,
            max: limit.max,
            detail: "",
        });
    }
    return next;
}

function _newPrompt(
    text: string,
    limit: { unit: CollegeLengthUnit; max: number } | null,
    usedIds: Set<string>,
    occurrence: number,
    occurrenceScoped = false,
): CollegePrompt {
    const normalizedText = _normalizeWhitespace(text);
    const baseId = researchFingerprint(normalizedText);
    let id =
        !occurrenceScoped && occurrence === 1
            ? baseId
            : researchFingerprint(`${normalizedText}\u0000${occurrence}`);
    let suffix = occurrence;
    while (usedIds.has(id)) {
        suffix += 1;
        id = researchFingerprint(`${normalizedText}\u0000${suffix}`);
    }
    const prompt: CollegePrompt = {
        id,
        label: _clip(normalizedText || "Prompt", MAX_PROMPT_LABEL),
        text: _clip(normalizedText, MAX_PROMPT_TEXT),
        sourceUrl: "",
        constraints: [],
    };
    if (limit) {
        prompt.constraints.push({
            id: `heading-${limit.unit}`,
            unit: limit.unit,
            min: null,
            max: limit.max,
            detail: "",
        });
    }
    usedIds.add(id);
    return prompt;
}

function _resolvedPrompt(
    heading: ParsedHeading,
    candidate: CollegePrompt | undefined,
    usedIds: Set<string>,
    occurrence: number,
    allowSavedId: boolean,
): CollegePrompt {
    if (!candidate) {
        return _newPrompt(heading.matchText, heading.limit, usedIds, occurrence, !allowSavedId);
    }

    const prompt = _plainClone(candidate);
    prompt.text = _clip(heading.matchText, MAX_PROMPT_TEXT);
    if (!allowSavedId || usedIds.has(prompt.id)) {
        const baseText = heading.matchText;
        let id = researchFingerprint(`${baseText}\u0000${occurrence}`);
        let suffix = occurrence;
        while (usedIds.has(id) || id === candidate.id) {
            suffix += 1;
            id = researchFingerprint(`${baseText}\u0000${suffix}`);
        }
        prompt.id = id;
    }
    prompt.constraints = _constraintsForHeading(prompt, heading.limit);
    usedIds.add(prompt.id);
    return prompt;
}

function _sectionsForLegacySetup(setup: CollegeSetup, prose: string): CollegeSection[] {
    return setup.prompts.map((prompt) => ({
        prompt: _plainClone(prompt),
        from: 0,
        to: prose.length,
        headingFrom: null,
        headingTo: null,
        wordCount: _wordCount(prose),
        characterCount: _characterCount(prose),
    }));
}

/** Resolve top-level H1 prompt sections from one root draft. */
export function resolveCollegeSections(setup: CollegeSetup, prose: string): CollegeSection[] {
    const text = typeof prose === "string" ? prose : "";
    const headings = _topLevelHeadings(text);
    if (headings.length === 0) {
        return setup.sectionMode ? [] : _sectionsForLegacySetup(setup, text);
    }

    const candidates = [...setup.prompts, ...(setup.promptArchive ?? [])];
    const candidatesByText = new Map<string, CollegePrompt[]>();
    for (const candidate of candidates) {
        const key = _promptMatchText(candidate);
        if (!key) continue;
        const existing = candidatesByText.get(key) ?? [];
        existing.push(candidate);
        candidatesByText.set(key, existing);
    }

    const usedIds = new Set<string>();
    const occurrences = new Map<string, number>();
    const headingCounts = new Map<string, number>();
    for (const heading of headings) {
        headingCounts.set(heading.matchText, (headingCounts.get(heading.matchText) ?? 0) + 1);
    }
    const sections = headings.map((heading, index) => {
        const occurrence = (occurrences.get(heading.matchText) ?? 0) + 1;
        occurrences.set(heading.matchText, occurrence);
        // Repeated heading text is ambiguous: even the first visible copy may
        // be the surviving copy after another one was deleted. Give every
        // current duplicate a fresh occurrence ID so prior research cannot
        // attach to either answer by accident.
        const duplicate = (headingCounts.get(heading.matchText) ?? 0) > 1;
        const candidate = candidatesByText.get(heading.matchText)?.[0];
        const prompt = _resolvedPrompt(heading, candidate, usedIds, occurrence, !duplicate);
        const nextHeading = headings[index + 1];
        const from = heading.bodyFrom;
        const to = nextHeading?.from ?? text.length;
        const body = text.slice(from, to);
        return {
            prompt,
            from,
            to,
            headingFrom: heading.from,
            headingTo: heading.to,
            wordCount: _wordCount(body),
            characterCount: _characterCount(body),
        } satisfies CollegeSection;
    });
    return sections;
}

/**
 * Format a prompt as a single Markdown H1 line. The first available numeric
 * word maximum wins, followed by a character maximum when no word maximum is
 * present.
 */
export function formatCollegePromptHeading(prompt: CollegePrompt): string {
    const title =
        _normalizeWhitespace(prompt.text) || _normalizeWhitespace(prompt.label) || "Prompt";
    const constraint =
        prompt.constraints.find((value) => value.unit === "words" && value.max !== null) ??
        prompt.constraints.find((value) => value.unit === "characters" && value.max !== null);
    if (!constraint) return `# ${title}`;
    const titleWithoutLimit = _withoutTrailingLimit(title).text || title;
    return `# ${titleWithoutLimit} (${constraint.max} ${constraint.unit})`;
}

/** Resolve a setup against the current draft without validating empty sections. */
export function resolveCollegeSetup(setup: CollegeSetup, prose: string): CollegeSetup {
    const resolved = _plainClone(setup);
    resolved.prompts = resolveCollegeSections(setup, prose).map((section) => section.prompt);
    return resolved;
}

function _archivePromptList(stored: CollegeSetup, activePrompts: CollegePrompt[]): CollegePrompt[] {
    const activeIds = new Set(activePrompts.map((prompt) => prompt.id));
    const oldArchive = (stored.promptArchive ?? []).filter((prompt) => !activeIds.has(prompt.id));
    const detached = stored.prompts.filter((prompt) => !activeIds.has(prompt.id));
    const byId = new Map<string, CollegePrompt>();
    for (const prompt of [...oldArchive, ...detached]) byId.set(prompt.id, _plainClone(prompt));
    return [...byId.values()].slice(-MAX_ARCHIVED_PROMPTS);
}

type ResolvedCollegeSetup = CollegeSetup & { prompts: CollegePrompt[] };

/**
 * Archive prompts that detached from a stored setup while retaining the
 * resolved setup's other fields, including caller-owned references.
 */
export function archiveCollegePrompts(
    stored: CollegeSetup,
    resolved: ResolvedCollegeSetup | CollegePrompt[],
): CollegeSetup {
    const resolvedSetup: ResolvedCollegeSetup = Array.isArray(resolved)
        ? { ..._plainClone(stored), prompts: _plainClone(resolved) }
        : _plainClone(resolved);
    if (resolvedSetup.prompts.length === 0) resolvedSetup.sectionMode = true;
    resolvedSetup.promptArchive = _archivePromptList(stored, resolvedSetup.prompts);
    return parseCollegeSetup(resolvedSetup);
}
