// research.ts — Normalize one provider result into bounded College sources.

import { abortError, linkAbortSignals, raceWithAbort } from "$lib/abort";
import { z } from "zod";
import type { CollegeReference } from "./model";
import {
    type ResearchTarget,
    collegeResearchSetupKey,
    researchFingerprint,
    researchTargetSchema,
} from "./researchModel";

const RESEARCH_TIMEOUT_MS = 90_000;

export { collegeResearchSetupKey, researchTargetSchema };
export type { ResearchTarget };

const extractedFindingSchema = z
    .object({
        url: z
            .string()
            .min(1)
            .max(2_000)
            .describe("The exact URL of one returned public source supporting this finding."),
        kind: z
            .enum(["requirement", "official-advice", "editorial-guidance"])
            .describe(
                "Use requirement only for an applicant obligation, prohibited action, numeric constraint, or deadline explicitly stated by the source. Use official-advice for source-authored review descriptions such as equal consideration, recommendations, explanations, and how-to advice, and editorial-guidance only for model-derived interpretation.",
            ),
        summary: z
            .string()
            .min(1)
            .max(1_200)
            .describe(
                "One atomic concise direct quotation or exact contiguous excerpt from the attached evidence passage, not a paraphrase.",
            ),
        evidence: z
            .string()
            .min(1)
            .max(1_000)
            .describe(
                "One short contiguous passage from the cited source. The summary must be copied from this passage; do not combine separate passages or add claims.",
            ),
        cycle: z
            .string()
            .max(100)
            .describe(
                "The source-stated application cycle, preserving its original label, or an empty string when the source does not state one.",
            ),
        promptIds: z
            .array(z.string().min(1).max(100))
            .min(1)
            .max(12)
            .refine(
                (promptIds) => new Set(promptIds).size === promptIds.length,
                "Finding prompt IDs must be unique",
            ),
    })
    .strict();

/** The structured extraction returned by a hosted or fallback provider. */
export const researchExtractionSchema = z
    .object({
        findings: z.array(extractedFindingSchema).max(8),
        warnings: z.array(z.string().max(1_000)).max(8),
        institutionMatches: z
            .boolean()
            .describe(
                "Assess institution identity independently from cycle, program, and prompt fit. Require a campus match only when the target names a campus; a clearly official parent or system-wide page can match a broad target. Missing, stale, or different cycles do not make an otherwise matching institution false.",
            ),
    })
    .strict();

export type ResearchExtraction = z.infer<typeof researchExtractionSchema>;

/** A public source returned by a school-research provider. */
export type ResearchSource = {
    url: string;
    title: string;
    text?: string;
};

export type ResearchAdapterResult = {
    extraction: ResearchExtraction;
    sources: ResearchSource[];
};

export type SchoolResearchAdapter = (
    target: ResearchTarget,
    signal: AbortSignal,
) => Promise<ResearchAdapterResult>;

export type ResearchResult = {
    id: string;
    target: ResearchTarget;
    checkedDate: string;
    findings: CollegeReference[];
    warnings: string[];
    pages: Array<{ url: string; title: string }>;
};

const sourceSchema = z
    .object({
        url: z.string().min(1).max(2_000),
        title: z.string().max(500),
        text: z.string().max(12_000).optional(),
    })
    .strict();

/** Return a stable comparison key for a research finding's sourced content. */
export function findingKey(reference: CollegeReference): string {
    return researchFingerprint(
        JSON.stringify({
            url: reference.url,
            kind: reference.kind,
            cycle: reference.cycle,
            publisher: reference.publisher,
            promptIds: reference.research?.promptIds ?? [],
            evidence: reference.research?.evidence ?? "",
            summary: reference.summary,
            school: reference.research?.school ?? "",
            program: reference.research?.program ?? "",
            targetCycle: reference.research?.targetCycle ?? "",
        }),
    );
}

/**
 * Rebuild the public target, run one bounded adapter operation, and normalize
 * only sources that can be tied back to the confirmed hostname.
 */
export async function runSchoolResearch(
    inputTarget: ResearchTarget,
    adapter: SchoolResearchAdapter,
    callerSignal: AbortSignal,
): Promise<ResearchResult> {
    const target = _reconstructTarget(inputTarget);
    _throwIfAborted(callerSignal);

    const resultId = _uuid();
    const checkedDate = new Date().toISOString().slice(0, 10);
    const warnings: string[] = [];
    const timeoutController = new AbortController();
    let timedOut = false;
    const linked = linkAbortSignals([callerSignal, timeoutController.signal]);
    const timeout = setTimeout(() => {
        timedOut = true;
        timeoutController.abort(_abortError());
    }, RESEARCH_TIMEOUT_MS);

    try {
        let adapterResult: ResearchAdapterResult;
        try {
            const operation = Promise.resolve().then(() => adapter(target, linked.signal));
            adapterResult = await raceWithAbort(operation, linked.signal, _abortError);
        } catch (error) {
            if (callerSignal.aborted) throw _abortError();
            if (timedOut) {
                _pushWarning(warnings, "School research timed out before sources were returned.");
            } else {
                _pushWarning(
                    warnings,
                    `Could not extract school research: ${_errorMessage(error)}.`,
                );
            }
            _addCompletionWarnings(target, [], warnings);
            return _result(target, resultId, checkedDate, [], [], warnings);
        }

        _throwIfAborted(callerSignal);
        if (timedOut) {
            _pushWarning(warnings, "School research timed out before sources were returned.");
            _addCompletionWarnings(target, [], warnings);
            return _result(target, resultId, checkedDate, [], [], warnings);
        }

        const parsed = _parseAdapterResult(adapterResult, warnings);
        if (!parsed) {
            _addCompletionWarnings(target, [], warnings);
            return _result(target, resultId, checkedDate, [], [], warnings);
        }

        for (const warning of parsed.extraction.warnings) _pushWarning(warnings, warning);
        const sources = _validSources(parsed.sources, target, warnings);
        const findings = parsed.extraction.institutionMatches
            ? _normalizeFindings(
                  parsed.extraction.findings,
                  target,
                  resultId,
                  checkedDate,
                  sources,
                  warnings,
              )
            : [];
        if (!parsed.extraction.institutionMatches) {
            _pushWarning(
                warnings,
                "The returned sources did not clearly match the requested institution.",
            );
        }
        _warnAboutConflictingLimits(findings, warnings);
        _addCompletionWarnings(target, findings, warnings);
        return _result(target, resultId, checkedDate, sources, findings, warnings);
    } finally {
        clearTimeout(timeout);
        linked.cleanup();
    }
}

function _result(
    target: ResearchTarget,
    id: string,
    checkedDate: string,
    sources: ResearchSource[],
    findings: CollegeReference[],
    warnings: string[],
): ResearchResult {
    return {
        id,
        target,
        checkedDate,
        findings,
        warnings,
        pages: sources.map(({ url, title }) => ({ url, title })),
    };
}

function _reconstructTarget(input: ResearchTarget): ResearchTarget {
    const value = input as Partial<ResearchTarget> | null | undefined;
    const prompts = Array.isArray(value?.prompts)
        ? value.prompts.map((prompt) => {
              const candidate = prompt as Partial<ResearchTarget["prompts"][number]> | null;
              return {
                  id: candidate?.id,
                  label: candidate?.label,
                  text: candidate?.text,
              };
          })
        : value?.prompts;
    return researchTargetSchema.parse({
        school: value?.school,
        cycle: value?.cycle,
        program: value?.program,
        sourceUrl: value?.sourceUrl,
        prompts,
    });
}

function _parseAdapterResult(
    value: ResearchAdapterResult,
    warnings: string[],
): ResearchAdapterResult | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        _pushWarning(warnings, "The research adapter response did not match the required schema.");
        return null;
    }
    const extraction = researchExtractionSchema.safeParse(value.extraction);
    if (!extraction.success) {
        _pushWarning(
            warnings,
            "The research extractor response did not match the required schema.",
        );
        return null;
    }
    if (!Array.isArray(value.sources)) {
        _pushWarning(warnings, "The research adapter did not return a source list.");
        return null;
    }
    return { extraction: extraction.data, sources: value.sources };
}

function _validSources(
    values: ResearchSource[],
    target: ResearchTarget,
    warnings: string[],
): ResearchSource[] {
    const targetHostname = _hostname(target.sourceUrl);
    if (!targetHostname) {
        _pushWarning(warnings, "The confirmed source URL has no usable hostname.");
        return [];
    }
    const seen = new Set<string>();
    const sources: ResearchSource[] = [];
    for (const value of values) {
        const parsed = sourceSchema.safeParse(value);
        if (!parsed.success) {
            _pushWarning(warnings, "Ignored a malformed research source.");
            continue;
        }
        const url = _sourceUrl(parsed.data.url, targetHostname);
        if (!url) {
            _pushWarning(warnings, `Ignored a research source outside ${targetHostname}.`);
            continue;
        }
        if (seen.has(parsed.data.url)) continue;
        seen.add(parsed.data.url);
        sources.push({
            url: parsed.data.url,
            title: parsed.data.title,
            ...(parsed.data.text === undefined ? {} : { text: parsed.data.text }),
        });
    }
    return sources;
}

function _sourceUrl(value: string, targetHostname: string): URL | null {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    const hostname = _normalizeHostname(url.hostname);
    if (
        url.protocol !== "https:" ||
        !hostname ||
        url.username ||
        url.password ||
        (hostname !== targetHostname && !hostname.endsWith(`.${targetHostname}`))
    ) {
        return null;
    }
    return url;
}

function _normalizeFindings(
    extracted: ResearchExtraction["findings"],
    target: ResearchTarget,
    snapshotId: string,
    checkedDate: string,
    sources: ResearchSource[],
    warnings: string[],
): CollegeReference[] {
    const sourcesByUrl = new Map(sources.map((source) => [source.url, source]));
    const targetPromptIds = new Set(target.prompts.map((prompt) => prompt.id));
    const findings: CollegeReference[] = [];
    for (const finding of extracted) {
        const source = sourcesByUrl.get(finding.url);
        if (!source) {
            _pushWarning(
                warnings,
                `Ignored a finding for a URL that was not returned: ${finding.url}.`,
            );
            continue;
        }
        if (finding.promptIds.some((promptId) => !targetPromptIds.has(promptId))) {
            _pushWarning(
                warnings,
                `Ignored a finding with an unknown prompt ID from ${finding.url}.`,
            );
            continue;
        }

        const sourceText = source.text;
        if (sourceText !== undefined && !sourceText.includes(finding.evidence)) {
            _pushWarning(warnings, `Ignored unsupported evidence from ${finding.url}.`);
            continue;
        }
        if (sourceText === undefined && !finding.evidence.trim()) {
            _pushWarning(warnings, `Ignored an unverified hosted finding from ${finding.url}.`);
            continue;
        }

        const summary = _normaliseWhitespace(finding.summary);
        if (!_isExtractiveSummary(summary, finding.evidence)) {
            _pushWarning(
                warnings,
                `Ignored a finding whose summary is not a contiguous excerpt of its attached evidence from ${finding.url}.`,
            );
            continue;
        }

        let cycle = finding.cycle;
        if (sourceText !== undefined && cycle && !sourceText.includes(cycle)) {
            _pushWarning(warnings, `Ignored the unverified cycle “${cycle}” from ${finding.url}.`);
            cycle = "";
        }
        if (cycle && target.cycle && !_sameApplicationCycle(cycle, target.cycle)) {
            _pushWarning(
                warnings,
                `The finding from ${finding.url} cites cycle “${cycle}”, which differs from requested cycle “${target.cycle}”; check whether the cycle labels refer to the same application year before using it.`,
            );
        } else if (!cycle && target.cycle) {
            _pushWarning(
                warnings,
                `The finding from ${finding.url} has no verified cycle for requested cycle “${target.cycle}”.`,
            );
        }

        findings.push({
            id: _uuid(),
            publisher: _hostname(source.url) ?? "",
            url: source.url,
            checkedDate,
            cycle,
            kind: finding.kind,
            summary,
            research: {
                setupKey: "",
                snapshotId,
                promptIds: [...finding.promptIds],
                school: target.school,
                program: target.program,
                targetCycle: target.cycle,
                evidence: finding.evidence,
            },
        });
    }
    return findings;
}

function _addCompletionWarnings(
    target: ResearchTarget,
    findings: CollegeReference[],
    warnings: string[],
): void {
    const requirementFindings = findings.filter((finding) => finding.kind === "requirement");
    if (!target.cycle) {
        _pushWarning(
            warnings,
            "The application cycle is unverified because no cycle was provided.",
        );
        if (requirementFindings.length === 0) {
            _pushWarning(warnings, "No verified requirement was found in the returned sources.");
        }
        return;
    }
    if (requirementFindings.length === 0) {
        _pushWarning(warnings, "No verified requirement was found in the returned sources.");
    } else if (
        !requirementFindings.some((finding) => _sameApplicationCycle(finding.cycle, target.cycle))
    ) {
        _pushWarning(
            warnings,
            `No requirement was verified for requested cycle “${target.cycle}”; returned requirement findings cite a different or missing cycle.`,
        );
    }
}

function _warnAboutConflictingLimits(findings: CollegeReference[], warnings: string[]): void {
    const limitsByPrompt = new Map<string, string[][]>();
    for (const finding of findings) {
        if (finding.kind !== "requirement" || !finding.research) continue;
        const limits = _numericLimits(finding.research.evidence);
        if (limits.length === 0) continue;
        for (const promptId of finding.research.promptIds) {
            const findingLimits = limitsByPrompt.get(promptId) ?? [];
            findingLimits.push(limits);
            limitsByPrompt.set(promptId, findingLimits);
        }
    }
    for (const [promptId, findingLimits] of limitsByPrompt) {
        const distinctSets = new Set(
            findingLimits.map((limits) => [...limits].sort().join("\u0000")),
        );
        if (findingLimits.length >= 2 && distinctSets.size > 1) {
            _pushWarning(
                warnings,
                `The fetched sources give conflicting numeric limits for prompt ${promptId}; both findings were retained for review.`,
            );
        }
    }
}

function _numericLimits(value: string): string[] {
    const limits = new Set<string>();
    const direct = /\b(\d[\d,]*)\s*(words?|characters?|chars?)\b/gi;
    const reverse =
        /\b(words?|characters?|chars?)(?:\s*[:=]\s*|\s+(?:limit|maximum|max(?:imum)?|count)\s*(?:(?::|=)\s*|(?:is|of|must\s+be|cannot\s+exceed|does\s+not\s+exceed|may\s+not\s+exceed|should\s+not\s+exceed|up\s+to)\s+)?)(\d[\d,]*)\b/gi;
    for (const match of value.matchAll(direct)) {
        limits.add(`${_limitUnit(match[2])}:${match[1].replaceAll(",", "")}`);
    }
    for (const match of value.matchAll(reverse)) {
        limits.add(`${_limitUnit(match[1])}:${match[2].replaceAll(",", "")}`);
    }
    return [...limits];
}

function _limitUnit(value: string): "words" | "characters" {
    return value.toLowerCase().startsWith("char") ? "characters" : "words";
}

function _sameApplicationCycle(left: string, right: string): boolean {
    return _applicationCycleKey(left) === _applicationCycleKey(right);
}

function _applicationCycleKey(value: string): string {
    const normalized = value.trim().replace(/\s+/g, " ");
    const match = /^(\d{4})\s*[-–—]\s*(\d{2}|\d{4})$/.exec(normalized);
    if (!match) return normalized;
    const [, start, end] = match;
    const expandedEnd = end.length === 2 ? `${start.slice(0, 2)}${end}` : end;
    return `${start}-${expandedEnd}`;
}

function _hostname(value: string): string | null {
    try {
        const url = new URL(value);
        const hostname = _normalizeHostname(url.hostname);
        return hostname || null;
    } catch {
        return null;
    }
}

function _normalizeHostname(value: string): string {
    return value.toLowerCase().replace(/\.$/, "");
}

function _normaliseWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function _isExtractiveSummary(summary: string, evidence: string): boolean {
    const normalizedSummary = _normaliseExtractiveText(summary);
    const normalizedEvidence = _normaliseExtractiveText(evidence);
    return normalizedSummary.length > 0 && normalizedEvidence.includes(normalizedSummary);
}

function _normaliseExtractiveText(value: string): string {
    return _normaliseWhitespace(value)
        .replace(/^[\s"“”‘’([{]+/, "")
        .replace(/[\s"“”‘’)\]}.,;:!?]+$/, "");
}

function _pushWarning(warnings: string[], warning: string): void {
    const normalized = _normaliseWhitespace(warning).slice(0, 500);
    if (normalized && !warnings.includes(normalized) && warnings.length < 16)
        warnings.push(normalized);
}

function _errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function _throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw _abortError();
}

function _abortError(): Error {
    return abortError("School research was cancelled.", "AbortError");
}

function _uuid(): string {
    if (typeof globalThis.crypto?.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes]
        .map((byte, index) =>
            [4, 6, 8, 10].includes(index)
                ? `-${byte.toString(16).padStart(2, "0")}`
                : byte.toString(16).padStart(2, "0"),
        )
        .join("");
}
