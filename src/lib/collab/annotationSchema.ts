/**
 * annotationSchema.ts -- Yjs annotation schema and bidirectional converters.
 *
 * Bridges between CodeMirror's annotationField format (EditorSelection, number IDs)
 * and Yjs Y.Map format (RelativePosition, string IDs, JSON-serialized nested data).
 *
 * Per Yjs bug #642: Avoid nested Y.Array/Y.Map in UndoManager-tracked structures.
 * Thread, versions, and replacements are stored as JSON strings instead.
 *
 * Threat mitigations:
 *   T-08-01: YjsAnnotationSchema validates Y.Map entries before conversion (Zod)
 *   T-08-02: JSON.parse calls are wrapped in try-catch; malformed data returns null
 *
 * Key dependencies:
 *   - zod for schema validation
 *   - ./relativePosition for position conversion
 *   - ../editor/plugins/annotations/models for CM types
 */
import { z } from "zod";
import * as Y from "yjs";
import { absoluteToRelative, relativeToAbsolute } from "./relativePosition";
import {
    isAnnotationOfType,
    type GenericAnnotation,
    type Thread,
    type SuggestionReplacement,
    type VersionState,
} from "$lib/editor/plugins/annotations/models";
import type { YjsAnnotation } from "./types";

// ── Zod schema for Y.Map validation (T-08-01) ────────────────────────

export const YjsAnnotationSchema = z.object({
    id: z.string(),
    _type: z.enum(["comment", "suggestion", "revision"]),
    startPos: z.instanceof(Uint8Array),
    endPos: z.instanceof(Uint8Array),
    thread: z.string(), // JSON-serialized Thread
    // Suggestion-specific
    replacements: z.string().optional(),
    author: z.string().optional(),
    // Revision-specific
    versions: z.string().optional(),
    activeVersionIndex: z.number().optional(),
});

// ── ID generation ─────────────────────────────────────────────────────

/**
 * Generate a unique annotation ID for collaborative context.
 * Uses client ID prefix to prevent collisions between concurrent clients.
 */
export function generateAnnotationId(clientId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    return `${clientId}-${timestamp}-${random}`;
}

// ── CodeMirror -> Yjs conversion ──────────────────────────────────────

/**
 * Convert a CodeMirror annotation to Yjs format for sync.
 *
 * @param annotation - CodeMirror GenericAnnotation
 * @param ytext - Y.Text for position encoding
 * @param clientId - Client ID for unique ID generation
 * @returns YjsAnnotation ready for Y.Map storage
 */
export function codeMirrorToYjsAnnotation(
    annotation: GenericAnnotation,
    ytext: Y.Text,
    clientId: string,
): YjsAnnotation {
    const { startPos, endPos } = absoluteToRelative(ytext, annotation.selection);

    const base: YjsAnnotation = {
        id: generateAnnotationId(clientId),
        _type: annotation._type,
        startPos,
        endPos,
        thread: JSON.stringify(annotation.thread),
    };

    if (isAnnotationOfType(annotation, "suggestion")) {
        return {
            ...base,
            replacements: JSON.stringify(annotation.replacements),
            author: annotation.author,
        };
    }

    if (isAnnotationOfType(annotation, "revision")) {
        return {
            ...base,
            versions: JSON.stringify(annotation.versions),
            activeVersionIndex: annotation.activeVersionIndex,
        };
    }

    // Comment
    return base;
}

// ── Yjs -> CodeMirror conversion ──────────────────────────────────────

/**
 * Safely parse JSON, returning null on failure (T-08-02).
 */
function safeJsonParse<T>(json: string): T | null {
    try {
        return JSON.parse(json) as T;
    } catch {
        console.warn("[annotationSchema] Failed to parse JSON:", json.slice(0, 100));
        return null;
    }
}

/**
 * Convert a Yjs annotation back to CodeMirror format.
 *
 * @param yjsAnnotation - Yjs-stored annotation
 * @param ydoc - Y.Doc for position resolution
 * @param ytext - Y.Text for position resolution
 * @param numericId - Numeric ID for CM annotationField (caller manages ID mapping)
 * @returns GenericAnnotation or null if position resolution or JSON parsing fails
 */
export function yjsAnnotationToCodeMirror(
    yjsAnnotation: YjsAnnotation,
    ydoc: Y.Doc,
    ytext: Y.Text,
    numericId: number,
): GenericAnnotation | null {
    let selection;
    try {
        selection = relativeToAbsolute(
            ydoc,
            ytext,
            yjsAnnotation.startPos,
            yjsAnnotation.endPos,
        );
    } catch {
        // T-08-01: Corrupted position data from Y.Map returns null
        console.warn("[annotationSchema] Failed to decode position for annotation:", yjsAnnotation.id);
        return null;
    }

    if (selection === null) {
        return null; // Anchored text was deleted
    }

    // T-08-02: Wrap JSON.parse in try-catch; malformed data returns null
    const thread = safeJsonParse<Thread>(yjsAnnotation.thread);
    if (thread === null) {
        return null;
    }

    const base = {
        id: numericId,
        selection,
        thread,
    };

    if (yjsAnnotation._type === "comment") {
        return { ...base, _type: "comment" };
    }

    if (yjsAnnotation._type === "suggestion") {
        const replacements: SuggestionReplacement[] = yjsAnnotation.replacements
            ? (safeJsonParse<SuggestionReplacement[]>(yjsAnnotation.replacements) ?? [])
            : [];
        return {
            ...base,
            _type: "suggestion",
            replacements,
            author: yjsAnnotation.author,
        };
    }

    if (yjsAnnotation._type === "revision") {
        const versions: VersionState[] = yjsAnnotation.versions
            ? (safeJsonParse<VersionState[]>(yjsAnnotation.versions) ?? [])
            : [];
        return {
            ...base,
            _type: "revision",
            versions,
            activeVersionIndex: yjsAnnotation.activeVersionIndex ?? 0,
        };
    }

    return null;
}

// ── ID mapping utilities ──────────────────────────────────────────────

/**
 * Maps between Yjs string IDs and CodeMirror numeric IDs.
 * Necessary because annotationField uses numeric keys but Yjs uses strings.
 */
export class AnnotationIdMap {
    private yjsToCm = new Map<string, number>();
    private cmToYjs = new Map<number, string>();
    private nextCmId = 0;

    /**
     * Get or create a numeric CM ID for a Yjs annotation ID.
     */
    getOrCreateCmId(yjsId: string): number {
        let cmId = this.yjsToCm.get(yjsId);
        if (cmId === undefined) {
            cmId = this.nextCmId++;
            this.yjsToCm.set(yjsId, cmId);
            this.cmToYjs.set(cmId, yjsId);
        }
        return cmId;
    }

    /**
     * Get the Yjs ID for a CM numeric ID.
     */
    getYjsId(cmId: number): string | undefined {
        return this.cmToYjs.get(cmId);
    }

    /**
     * Get the CM ID for a Yjs ID.
     */
    getCmId(yjsId: string): number | undefined {
        return this.yjsToCm.get(yjsId);
    }

    /**
     * Register a new mapping (when CM creates an annotation locally).
     */
    register(yjsId: string, cmId: number): void {
        this.yjsToCm.set(yjsId, cmId);
        this.cmToYjs.set(cmId, yjsId);
        if (cmId >= this.nextCmId) {
            this.nextCmId = cmId + 1;
        }
    }

    /**
     * Remove a mapping.
     */
    remove(yjsId: string): void {
        const cmId = this.yjsToCm.get(yjsId);
        if (cmId !== undefined) {
            this.cmToYjs.delete(cmId);
        }
        this.yjsToCm.delete(yjsId);
    }

    /**
     * Clear all mappings.
     */
    clear(): void {
        this.yjsToCm.clear();
        this.cmToYjs.clear();
        this.nextCmId = 0;
    }
}
