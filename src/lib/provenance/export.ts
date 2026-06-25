/**
 * export.ts — Authorship report export (JSON + Markdown).
 *
 * Turns a `ProvenanceReport` (built by `$lib/provenance/report`) into a
 * downloadable JSON or Markdown file. The Markdown renderer is local; saving
 * reuses the shared native-dialog helpers from `$lib/export`.
 *
 * Used by:
 *   - UI export menus / actions that offer an "Authorship report" download.
 *
 * Depends on:
 *   - `$lib/provenance/report` for the report data model and builder.
 *   - `$lib/export` for `saveWithDialog` / `sanitizeFilename`.
 *   - `$lib/posthog` for the `authorship_report_exported` analytics event.
 */

import { sanitizeFilename, saveWithDialog } from "$lib/export";
import posthog from "$lib/posthog";
import { type ProvenanceReport, generateProvenanceReport } from "$lib/provenance/report";

export type ReportFormat = "json" | "md";

/** Maximum number of pasted characters embedded inline in the Markdown paste log. */
const PASTE_PREVIEW_LIMIT = 500;

/**
 * Format a millisecond duration as a coarse human string:
 *   - "Xh Ym" when at least an hour,
 *   - "Ym Zs" when at least a minute,
 *   - "Zs" otherwise.
 * Negative or non-finite inputs collapse to "0s".
 */
function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0s";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function isoTime(ms: number): string {
    return new Date(ms).toISOString();
}

/** Render a fenced code block, escaping any backtick fences in the content. */
function fencedBlock(text: string): string {
    const truncated =
        text.length > PASTE_PREVIEW_LIMIT
            ? `${text.slice(0, PASTE_PREVIEW_LIMIT)}…\n\n_(truncated — ${text.length} chars total)_`
            : text;
    return ["```", truncated, "```"].join("\n");
}

function buildSummarySection(report: ProvenanceReport): string {
    const lines = [
        "## Summary",
        "",
        `- Generated at: ${report.generatedAt}`,
        `- Events: ${report.eventCount}`,
        `- Active writing time: ${formatDuration(report.activeWritingMs)}`,
        `- Final document length: ${report.totals.finalDocLength} chars`,
    ];
    return lines.join("\n");
}

function buildTotalsSection(report: ProvenanceReport): string {
    const t = report.totals;
    const rows: Array<[string, number]> = [
        ["Typed", t.typedChars],
        ["Pasted", t.pastedChars],
        ["AI revision", t.aiRevisionChars],
        ["Formatting", t.formatChars],
        ["Unknown", t.unknownChars],
    ];
    const lines = [
        "## Totals",
        "",
        "| Origin | Characters |",
        "| --- | --- |",
        ...rows.map(([origin, chars]) => `| ${origin} | ${chars} |`),
    ];
    return lines.join("\n");
}

function buildSessionsSection(report: ProvenanceReport): string {
    const lines = ["## Writing sessions", ""];
    if (report.sessions.length === 0) {
        lines.push("_No sessions recorded._");
        return lines.join("\n");
    }
    lines.push("| # | Start | Duration | Typed | Pasted |");
    lines.push("| --- | --- | --- | --- | --- |");
    report.sessions.forEach((session, index) => {
        lines.push(
            `| ${index + 1} | ${isoTime(session.startedAt)} | ${formatDuration(
                session.durationMs,
            )} | ${session.typedChars} | ${session.pastedChars} |`,
        );
    });
    return lines.join("\n");
}

function buildPasteSection(report: ProvenanceReport): string {
    const lines = ["## Paste log", ""];
    if (report.pastes.length === 0) {
        lines.push("_No pastes recorded._");
        return lines.join("\n");
    }
    report.pastes.forEach((paste, index) => {
        const flagged = paste.flagged ? " — ⚠️ flagged" : "";
        lines.push(`### Paste ${index + 1}`);
        lines.push("");
        lines.push(`- Timestamp: ${isoTime(paste.timestamp)}`);
        lines.push(`- Size: ${paste.size} chars${flagged}`);
        lines.push("");
        lines.push(fencedBlock(paste.text));
        lines.push("");
    });
    return lines.join("\n").trimEnd();
}

function buildAiSection(report: ProvenanceReport): string {
    const lines = [
        "## AI assistance",
        "",
        `- AI revision events: ${report.aiAssist.aiRevisionEvents}`,
        `- AI-authored annotations: ${report.aiAssist.aiAuthoredAnnotations}`,
    ];
    return lines.join("\n");
}

function buildIntegritySection(report: ProvenanceReport): string {
    const integrity = report.integrity;
    const legacyPct = `${(integrity.legacyEventRatio * 100).toFixed(1)}%`;
    const lines = [
        "## Integrity",
        "",
        integrity.statement,
        "",
        `- Covers full history: ${integrity.coversFullHistory ? "yes" : "no"}`,
        `- Legacy (unclassified) events: ${legacyPct}`,
    ];
    return lines.join("\n");
}

/** Render a full `ProvenanceReport` as a Markdown document. */
export function buildReportMarkdown(report: ProvenanceReport): string {
    return [
        `# Authorship Report — ${report.documentTitle}`,
        buildSummarySection(report),
        buildTotalsSection(report),
        buildSessionsSection(report),
        buildPasteSection(report),
        buildAiSection(report),
        buildIntegritySection(report),
    ].join("\n\n");
}

/**
 * Build an authorship report for a draft and save it to disk in the requested
 * format via the native save dialog. Returns whether the file was written
 * (false when the user cancels the dialog).
 */
export async function exportAuthorshipReport(
    draftId: string,
    documentTitle: string,
    format: ReportFormat,
): Promise<boolean> {
    const report = await generateProvenanceReport(draftId, documentTitle);
    const content =
        format === "json" ? JSON.stringify(report, null, 2) : buildReportMarkdown(report);
    const filename = `${sanitizeFilename(documentTitle)}-authorship.${format}`;
    const saved = await saveWithDialog(content, filename, format);
    if (saved) {
        posthog.capture("authorship_report_exported", { format });
    }
    return saved;
}
