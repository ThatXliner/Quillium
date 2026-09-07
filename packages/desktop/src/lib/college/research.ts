// research.ts — Pure, bounded school-source crawling and finding validation.

import { z } from "zod";
import type { CollegeReference } from "./model";
import {
    type ResearchTarget,
    collegeResearchSetupKey,
    researchFingerprint,
    researchTargetSchema,
} from "./researchModel";

const MAX_HTML_BYTES = 512 * 1024;
const MAX_PAGE_TEXT = 12_000;
const MAX_PAGES = 4;
const MAX_RESPONSE_CHARS = 24_000;
const RESEARCH_TIMEOUT_MS = 90_000;

export { researchTargetSchema };
export type { ResearchTarget };

const extractedFindingSchema = z
    .object({
        url: z.string().min(1).max(2_000),
        kind: z.enum(["requirement", "official-advice", "editorial-guidance"]),
        summary: z.string().min(1).max(1_200),
        evidence: z.string().max(1_000),
        cycle: z.string().max(100),
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

const extractionResponseSchema = z
    .object({
        findings: z.array(extractedFindingSchema).max(8),
        warnings: z.array(z.string().max(1_000)).max(8),
        institutionMatches: z.boolean(),
    })
    .strict();

export type ResearchExtractPage = {
    url: string;
    title: string;
    text: string;
};

export type ResearchExtractPayload = {
    target: ResearchTarget;
    pages: ResearchExtractPage[];
};

export type SchoolResearchAdapters = {
    fetchPage: (url: string, signal: AbortSignal) => Promise<string>;
    extract: (payload: ResearchExtractPayload, signal: AbortSignal) => Promise<string>;
};

export type ResearchResult = {
    id: string;
    target: ResearchTarget;
    checkedDate: string;
    findings: CollegeReference[];
    warnings: string[];
    pages: Array<{ url: string; title: string }>;
};

type Anchor = {
    url: string;
    label: string;
    path: string;
    order: number;
};

type CrawledPage = ResearchExtractPage & {
    anchors: Anchor[];
};

/**
 * The key deliberately lives beside the research model so context consumers
 * can compare scope without importing the crawling engine.
 */
export { collegeResearchSetupKey };

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
 * Crawl the confirmed source and a few relevant same-origin pages, then validate
 * one extractor response against the fetched text. This function has no access
 * to application state, credentials, or model providers.
 */
export async function runSchoolResearch(
    inputTarget: ResearchTarget,
    adapters: SchoolResearchAdapters,
    callerSignal: AbortSignal,
): Promise<ResearchResult> {
    const target = _reconstructTarget(inputTarget);
    _throwIfAborted(callerSignal);

    const resultId = _uuid();
    const checkedDate = new Date().toISOString().slice(0, 10);
    const warnings: string[] = [];
    const crawledPages: CrawledPage[] = [];
    const visited = new Set<string>();
    const controller = new AbortController();
    let timedOut = false;

    const abortFromCaller = () => controller.abort();
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", abortFromCaller, { once: true });

    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, RESEARCH_TIMEOUT_MS);

    try {
        const source = new URL(target.sourceUrl);
        const pendingAnchors: Anchor[] = [];
        let attempts = 0;

        if (!_crawlableUrl(source, source.origin)) {
            _pushWarning(
                warnings,
                "The confirmed source URL uses a blocked portal or non-HTML route.",
            );
            _addCompletionWarnings(target, [], warnings);
            return _result(target, resultId, checkedDate, crawledPages, [], warnings);
        }

        while (attempts < MAX_PAGES && !timedOut) {
            const nextUrl =
                attempts === 0 ? target.sourceUrl : _nextAnchor(pendingAnchors, visited, target);
            if (!nextUrl) break;
            visited.add(nextUrl);
            attempts += 1;

            let html: string;
            try {
                const operation = Promise.resolve().then(() =>
                    adapters.fetchPage(nextUrl, controller.signal),
                );
                html = await _raceWithAbort(operation, controller.signal);
            } catch (error) {
                if (callerSignal.aborted) throw _abortError();
                if (timedOut) break;
                _pushWarning(warnings, `Could not fetch ${nextUrl}: ${_errorMessage(error)}.`);
                continue;
            }

            if (timedOut) break;
            if (typeof html !== "string") {
                _pushWarning(warnings, `Could not fetch ${nextUrl}: the response was not HTML.`);
                continue;
            }

            const page = _parsePage(html, nextUrl, target, warnings);
            if (!page) continue;
            crawledPages.push(page);
            pendingAnchors.push(...page.anchors);
        }

        if (callerSignal.aborted) throw _abortError();
        if (timedOut) {
            _pushWarning(
                warnings,
                "School research timed out; only completed pages are available.",
            );
            _addCompletionWarnings(target, [], warnings);
            return _result(target, resultId, checkedDate, crawledPages, [], warnings);
        }

        if (crawledPages.length === 0) {
            _pushWarning(warnings, "No pages were fetched, so no findings could be verified.");
            _addCompletionWarnings(target, [], warnings);
            return _result(target, resultId, checkedDate, crawledPages, [], warnings);
        }

        const pages = crawledPages.map(({ url, title, text }) => ({ url, title, text }));
        let responseText: string;
        try {
            const operation = Promise.resolve().then(() =>
                adapters.extract({ target, pages }, controller.signal),
            );
            responseText = await _raceWithAbort(operation, controller.signal);
        } catch (error) {
            if (callerSignal.aborted) throw _abortError();
            if (timedOut) {
                _pushWarning(
                    warnings,
                    "School research timed out before findings could be extracted.",
                );
            } else {
                _pushWarning(
                    warnings,
                    `Could not extract school research: ${_errorMessage(error)}.`,
                );
            }
            _addCompletionWarnings(target, [], warnings);
            return _result(target, resultId, checkedDate, crawledPages, [], warnings);
        }

        const findings = _validateExtraction(
            responseText,
            target,
            resultId,
            checkedDate,
            source.hostname,
            pages,
            warnings,
        );
        _warnAboutConflictingLimits(findings, warnings);
        _addCompletionWarnings(target, findings, warnings);
        return _result(target, resultId, checkedDate, crawledPages, findings, warnings);
    } finally {
        clearTimeout(timeout);
        callerSignal.removeEventListener("abort", abortFromCaller);
    }
}

function _result(
    target: ResearchTarget,
    id: string,
    checkedDate: string,
    pages: CrawledPage[],
    findings: CollegeReference[],
    warnings: string[],
): ResearchResult {
    return {
        id,
        target,
        checkedDate,
        findings,
        warnings,
        pages: pages.map(({ url, title }) => ({ url, title })),
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

function _parsePage(
    html: string,
    url: string,
    target: ResearchTarget,
    warnings: string[],
): CrawledPage | null {
    const boundedHtml = _limitHtml(html, url, warnings);
    let root: DocumentFragment;
    try {
        // A template fragment is inert: retrieved markup is never inserted into
        // the live document, and images/frames cannot initiate page resources.
        const template = document.createElement("template");
        template.innerHTML = boundedHtml;
        root = template.content;
    } catch (error) {
        _pushWarning(warnings, `Could not parse ${url}: ${_errorMessage(error)}.`);
        return null;
    }

    for (const element of root.querySelectorAll(
        "script, style, nav, footer, form, iframe, noscript, template",
    )) {
        element.remove();
    }
    const title =
        _normaliseWhitespace(root.querySelector("title")?.textContent ?? "").slice(0, 200) || url;
    const textRoot = root.querySelector("main, article") ?? root;
    const fullText = _normaliseWhitespace(textRoot.textContent ?? "");
    if (fullText.length > MAX_PAGE_TEXT) {
        _pushWarning(
            warnings,
            `The extracted text for ${url} exceeded ${MAX_PAGE_TEXT} characters and was truncated.`,
        );
    }
    const text = _boundedPageText(fullText, target);
    const source = new URL(url);
    const anchors: Anchor[] = [];
    for (const [order, element] of [...root.querySelectorAll("a[href]")].entries()) {
        const href = element.getAttribute("href");
        if (!href) continue;
        let candidate: URL;
        try {
            candidate = new URL(href, url);
        } catch {
            continue;
        }
        if (!_crawlableUrl(candidate, source.origin) || candidate.toString().length > 2_000)
            continue;
        anchors.push({
            url: candidate.toString(),
            label: _normaliseWhitespace(element.textContent ?? "").slice(0, 200),
            path: candidate.pathname,
            order,
        });
    }
    return { url, title, text, anchors };
}

function _boundedPageText(fullText: string, target: ResearchTarget): string {
    if (fullText.length <= MAX_PAGE_TEXT) return fullText;

    const prefix = fullText.slice(0, 1_000);
    const chunks: Array<{ start: number; text: string; score: number }> = [];
    for (let start = 1_000; start < fullText.length; start += 1_800) {
        const text = fullText.slice(start, start + 1_800);
        chunks.push({ start, text, score: _textRelevance(text, target) });
    }
    const selected = chunks
        .sort((left, right) => right.score - left.score || left.start - right.start)
        .slice(0, 6)
        .sort((left, right) => left.start - right.start);
    const excerpts = [prefix, ...selected.map((chunk) => chunk.text)];
    let result = excerpts.join(" [excerpt break] ");
    if (result.length <= MAX_PAGE_TEXT) return result;

    // The marker makes omitted regions explicit and prevents evidence from
    // accidentally matching across two unrelated excerpts.
    while (result.length > MAX_PAGE_TEXT && selected.length > 0) {
        selected.pop();
        result = [prefix, ...selected.map((chunk) => chunk.text)].join(" [excerpt break] ");
    }
    return result.slice(0, MAX_PAGE_TEXT);
}

function _textRelevance(text: string, target: ResearchTarget): number {
    const lower = text.toLowerCase();
    const terms = [
        "essay",
        "essays",
        "prompt",
        "prompts",
        "personal insight",
        "supplement",
        "supplemental",
        "word limit",
        "words",
        "characters",
    ];
    let score = 0;
    for (const term of terms) {
        if (lower.includes(term)) score += 3;
    }
    const words = [
        ...target.program.toLowerCase().split(/[^a-z0-9]+/),
        ...target.prompts.flatMap((prompt) => prompt.text.toLowerCase().split(/[^a-z0-9]+/)),
    ];
    for (const word of new Set(words.filter((word) => word.length >= 5))) {
        if (lower.includes(word)) score += 1;
    }
    return score;
}

function _limitHtml(html: string, url: string, warnings: string[]): string {
    const bytes = new TextEncoder().encode(html);
    if (bytes.length <= MAX_HTML_BYTES) return html;
    _pushWarning(warnings, `The HTML response for ${url} exceeded 512 KiB and was truncated.`);
    return new TextDecoder().decode(bytes.slice(0, MAX_HTML_BYTES));
}

function _crawlableUrl(url: URL, sourceOrigin: string): boolean {
    if (
        url.protocol !== "https:" ||
        url.origin !== sourceOrigin ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash
    ) {
        return false;
    }
    let pathname: string;
    try {
        pathname = decodeURIComponent(url.pathname).toLowerCase();
    } catch {
        return false;
    }
    if (
        /\.(?:pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|gif|webp|svg|mp4|mp3|csv|json|xml|txt)(?:$|\/)/i.test(
            pathname,
        )
    ) {
        return false;
    }
    if (
        /(^|[/_.-])(portal|login|account|apply-now|signin|sign-in|auth|sso)([/_.-]|$)/i.test(
            pathname,
        )
    ) {
        return false;
    }
    return true;
}

function _nextAnchor(
    anchors: Anchor[],
    visited: Set<string>,
    target: ResearchTarget,
): string | null {
    const candidates = anchors
        .filter((anchor) => !visited.has(anchor.url))
        .map((anchor) => ({ anchor, score: _anchorScore(anchor, target.program) }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score || left.anchor.order - right.anchor.order);
    return candidates[0]?.anchor.url ?? null;
}

function _anchorScore(anchor: Anchor, program: string): number {
    const haystack = `${anchor.label} ${anchor.path}`.toLowerCase();
    const terms = [
        "admission",
        "admissions",
        "application",
        "applications",
        "apply",
        "essay",
        "essays",
        "prompt",
        "prompts",
        "program",
        "programs",
        "supplement",
        "supplemental",
        "requirement",
        "requirements",
        "undergraduate",
    ];
    let score = 0;
    for (const term of terms) {
        if (haystack.includes(term)) score += 2;
    }
    const programWords = program
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3);
    for (const word of new Set(programWords)) {
        if (haystack.includes(word)) score += 3;
    }
    return score;
}

function _addCompletionWarnings(
    target: ResearchTarget,
    findings: CollegeReference[],
    warnings: string[],
): void {
    if (!target.cycle) {
        _pushWarning(
            warnings,
            "The application cycle is unverified because no cycle was provided.",
        );
    }
    if (
        !findings.some(
            (finding) =>
                finding.kind === "requirement" &&
                target.cycle.length > 0 &&
                finding.cycle === target.cycle,
        )
    ) {
        _pushWarning(warnings, "No verified requirement was found in the fetched sources.");
    }
}

function _validateExtraction(
    rawResponse: string,
    target: ResearchTarget,
    snapshotId: string,
    checkedDate: string,
    publisher: string,
    pages: ResearchExtractPage[],
    warnings: string[],
): CollegeReference[] {
    if (typeof rawResponse !== "string" || rawResponse.length > MAX_RESPONSE_CHARS) {
        _pushWarning(warnings, "The research extractor response exceeded 24,000 characters.");
        return [];
    }
    let parsedJson: unknown;
    try {
        parsedJson = JSON.parse(_unwrapJson(rawResponse)) as unknown;
    } catch (error) {
        _pushWarning(
            warnings,
            `The research extractor did not return valid JSON: ${_errorMessage(error)}.`,
        );
        return [];
    }
    const parsed = extractionResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
        _pushWarning(
            warnings,
            "The research extractor response did not match the required schema.",
        );
        return [];
    }
    for (const warning of parsed.data.warnings) _pushWarning(warnings, warning);
    if (!parsed.data.institutionMatches) {
        _pushWarning(
            warnings,
            "The fetched sources did not clearly match the requested institution.",
        );
        return [];
    }

    const targetPromptIds = new Set(target.prompts.map((prompt) => prompt.id));
    const pagesByUrl = new Map(pages.map((page) => [page.url, page]));
    const findings: CollegeReference[] = [];
    for (const finding of parsed.data.findings) {
        const page = pagesByUrl.get(finding.url);
        if (!page) {
            _pushWarning(
                warnings,
                `Ignored a finding for a URL that was not fetched: ${finding.url}.`,
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
        const evidence = _normaliseWhitespace(finding.evidence);
        if (!evidence || !page.text.includes(evidence)) {
            _pushWarning(warnings, `Ignored unsupported evidence from ${finding.url}.`);
            continue;
        }
        let cycle = _normaliseWhitespace(finding.cycle);
        if (cycle && !page.text.includes(cycle)) {
            _pushWarning(warnings, `Ignored the unverified cycle “${cycle}” from ${finding.url}.`);
            cycle = "";
        }
        if (cycle && target.cycle && cycle !== target.cycle) {
            _pushWarning(
                warnings,
                `The finding from ${finding.url} cites cycle “${cycle}”, which differs from requested cycle “${target.cycle}”; it was retained as stale evidence.`,
            );
        } else if (!cycle && target.cycle) {
            _pushWarning(
                warnings,
                `The finding from ${finding.url} has no verified cycle for requested cycle “${target.cycle}”.`,
            );
        }
        findings.push({
            id: _uuid(),
            publisher,
            url: finding.url,
            checkedDate,
            cycle,
            kind: finding.kind,
            summary: _normaliseWhitespace(finding.summary),
            research: {
                setupKey: "",
                snapshotId,
                promptIds: [...finding.promptIds],
                school: target.school,
                program: target.program,
                targetCycle: target.cycle,
                evidence,
            },
        });
    }
    return findings;
}

function _unwrapJson(value: string): string {
    const trimmed = value.trim();
    const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    return match?.[1]?.trim() ?? trimmed;
}

function _warnAboutConflictingLimits(findings: CollegeReference[], warnings: string[]): void {
    const limitsByPrompt = new Map<string, Set<string>>();
    for (const finding of findings) {
        if (finding.kind !== "requirement" || !finding.research) continue;
        const limits = _numericLimits(`${finding.summary} ${finding.research.evidence}`);
        for (const promptId of finding.research.promptIds) {
            const values = limitsByPrompt.get(promptId) ?? new Set<string>();
            for (const limit of limits) values.add(limit);
            limitsByPrompt.set(promptId, values);
        }
    }
    for (const [promptId, limits] of limitsByPrompt) {
        if (limits.size > 1) {
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
    const reverse = /\b(words?|characters?|chars?)\b[^\d]{0,24}(\d[\d,]*)\b/gi;
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

function _normaliseWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function _pushWarning(warnings: string[], warning: string): void {
    const normalized = _normaliseWhitespace(warning).slice(0, 500);
    if (normalized && !warnings.includes(normalized) && warnings.length < 16)
        warnings.push(normalized);
}

function _errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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

function _throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw _abortError();
}

function _abortError(): Error {
    const error = new Error("School research was cancelled.");
    error.name = "AbortError";
    return error;
}

function _raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        void operation.catch(() => undefined);
        return Promise.reject(_abortError());
    }
    return new Promise<T>((resolve, reject) => {
        const abort = () => {
            signal.removeEventListener("abort", abort);
            reject(_abortError());
        };
        signal.addEventListener("abort", abort, { once: true });
        operation.then(
            (value) => {
                signal.removeEventListener("abort", abort);
                resolve(value);
            },
            (error) => {
                signal.removeEventListener("abort", abort);
                reject(error);
            },
        );
    });
}
