/**
 * annotationSchema.ts — Yjs recursive-Y.Map annotation converters.
 *
 * Per D-90/D-92: YjsAnnotation is a Y.Map<unknown> with Y.Text/Y.Array/Y.Map children.
 * Per D-93: Comment threads are Y.Array<MessageObject> (append-only, sorted on read).
 * Per D-94: No migration; Phase 8 wire format was never shipped.
 *
 * Converter invariants:
 *   - codeMirrorToYjsAnnotation runs all child-Y-type creation inside a single
 *     ydoc.transact(..., "init") so remote peers see atomic node insertion.
 *   - yjsAnnotationToCodeMirror never throws; it returns null on malformed data.
 *   - Subtree annotations (`annotations` field on each node / version) start empty;
 *     Plan 8.5c-01 populates them when nested editors create child annotations.
 *
 * Key dependencies:
 *   - yjs (Y.Map, Y.Text, Y.Array) for runtime construction
 *   - ./relativePosition for position encoding
 *   - ../editor/plugins/annotations/models for CM types
 */
import * as Y from "yjs";
import { absoluteToRelative, relativeToAbsolute } from "./relativePosition";
import {
    isAnnotationOfType,
    type GenericAnnotation,
    type SuggestionReplacement,
    type VersionState,
} from "$lib/editor/plugins/annotations/models";
import type { YjsAnnotationNode, MessageObject } from "./types";

// ── ID generation ─────────────────────────────────────────────────────

/**
 * Generate a unique annotation ID for collaborative context.
 * Client-prefixed to prevent collisions between concurrent clients.
 */
export function generateAnnotationId(clientId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    return `${clientId}-${timestamp}-${random}`;
}

// ── CodeMirror → Yjs (recursive Y.Map builder) ────────────────────────

/**
 * Convert a CodeMirror annotation to a freshly constructed YjsAnnotationNode.
 * Creates and populates every child Y type inside a single ydoc.transact so
 * peers never observe a partially assembled node.
 */
export function codeMirrorToYjsAnnotation(
    annotation: GenericAnnotation,
    ytext: Y.Text,
    clientId: string,
    ydoc: Y.Doc,
): YjsAnnotationNode {
    const { startPos, endPos } = absoluteToRelative(ytext, annotation.selection);
    const node: YjsAnnotationNode = new Y.Map<unknown>();

    ydoc.transact(() => {
        node.set("id", generateAnnotationId(clientId));
        node.set("_type", annotation._type);
        node.set("startPos", startPos);
        node.set("endPos", endPos);

        const thread = new Y.Array<MessageObject>();
        if (annotation.thread.length > 0) {
            thread.push(annotation.thread.map((m) => ({ ...m })));
        }
        node.set("thread", thread);

        node.set("annotations", new Y.Map<YjsAnnotationNode>());

        if (isAnnotationOfType(annotation, "suggestion")) {
            const repl = new Y.Array<SuggestionReplacement>();
            if (annotation.replacements.length > 0) {
                repl.push(annotation.replacements.map((r) => ({ ...r })));
            }
            node.set("replacements", repl);
            if (annotation.author !== undefined) {
                node.set("author", annotation.author);
            }
        } else if (isAnnotationOfType(annotation, "revision")) {
            const versionsMap = new Y.Map<Y.Map<unknown>>();
            annotation.versions.forEach((v, idx) => {
                const versionNode = new Y.Map<unknown>();
                const vtext = new Y.Text();
                if (v.doc.length > 0) {
                    vtext.insert(0, v.doc);
                }
                versionNode.set("text", vtext);
                if (v.label !== undefined) {
                    versionNode.set("label", v.label);
                }
                versionNode.set("annotations", new Y.Map<YjsAnnotationNode>());
                versionsMap.set(String(idx), versionNode);
            });
            node.set("versions", versionsMap);
            node.set("activeVersionIndex", annotation.activeVersionIndex);
        }
    }, "init");

    return node;
}

// ── Yjs → CodeMirror (recursive Y.Map reader) ─────────────────────────

/**
 * Convert a YjsAnnotationNode back to a CodeMirror GenericAnnotation.
 * Returns null if the anchored text was deleted or the node is malformed.
 */
export function yjsAnnotationToCodeMirror(
    node: YjsAnnotationNode,
    ydoc: Y.Doc,
    ytext: Y.Text,
    numericId: number,
): GenericAnnotation | null {
    const startPos = node.get("startPos") as Uint8Array | undefined;
    const endPos = node.get("endPos") as Uint8Array | undefined;
    if (!(startPos instanceof Uint8Array) || !(endPos instanceof Uint8Array)) {
        console.warn("[annotationSchema] Missing or malformed positions");
        return null;
    }

    let selection;
    try {
        selection = relativeToAbsolute(ydoc, ytext, startPos, endPos);
    } catch {
        console.warn("[annotationSchema] Failed to decode position");
        return null;
    }
    if (selection === null) {
        return null; // Anchored text was deleted
    }

    const threadArr = node.get("thread");
    const thread: MessageObject[] =
        threadArr instanceof Y.Array ? (threadArr.toArray() as MessageObject[]) : [];

    const type = node.get("_type") as GenericAnnotation["_type"] | undefined;
    if (type !== "comment" && type !== "suggestion" && type !== "revision") {
        console.warn("[annotationSchema] Unknown _type:", type);
        return null;
    }

    const base = { id: numericId, selection, thread };

    if (type === "comment") {
        return { ...base, _type: "comment" };
    }

    if (type === "suggestion") {
        const replArr = node.get("replacements");
        const replacements: SuggestionReplacement[] =
            replArr instanceof Y.Array ? (replArr.toArray() as SuggestionReplacement[]) : [];
        const author = node.get("author");
        return {
            ...base,
            _type: "suggestion",
            replacements,
            author: typeof author === "string" ? author : undefined,
        };
    }

    // revision
    const versionsMap = node.get("versions");
    if (!(versionsMap instanceof Y.Map)) {
        console.warn("[annotationSchema] Revision missing versions map");
        return null;
    }
    const keys = Array.from(versionsMap.keys())
        .map((k) => Number(k))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
    if (keys.length === 0) {
        console.warn("[annotationSchema] Revision has empty versions map");
        return null;
    }
    const versions: VersionState[] = keys.map((k) => {
        const v = versionsMap.get(String(k)) as Y.Map<unknown>;
        const vtext = v.get("text");
        const doc = vtext instanceof Y.Text ? vtext.toString() : "";
        const label = v.get("label");
        return {
            doc,
            ...(typeof label === "string" ? { label } : {}),
        };
    });

    const rawIndex =
        typeof node.get("activeVersionIndex") === "number"
            ? (node.get("activeVersionIndex") as number)
            : 0;
    const activeVersionIndex = Math.max(0, Math.min(rawIndex, versions.length - 1));

    return {
        ...base,
        _type: "revision",
        versions,
        activeVersionIndex,
    };
}

// ── ID mapping utilities (unchanged; preserved verbatim) ─────────────

export class AnnotationIdMap {
    private yjsToCm = new Map<string, number>();
    private cmToYjs = new Map<number, string>();
    private nextCmId = 0;

    getOrCreateCmId(yjsId: string): number {
        let cmId = this.yjsToCm.get(yjsId);
        if (cmId === undefined) {
            cmId = this.nextCmId++;
            this.yjsToCm.set(yjsId, cmId);
            this.cmToYjs.set(cmId, yjsId);
        }
        return cmId;
    }

    getOrCreateYjsId(cmId: number, clientId: string): string {
        let yjsId = this.cmToYjs.get(cmId);
        if (yjsId === undefined) {
            yjsId = generateAnnotationId(clientId);
            this.yjsToCm.set(yjsId, cmId);
            this.cmToYjs.set(cmId, yjsId);
        }
        return yjsId;
    }

    getYjsId(cmId: number): string | undefined {
        return this.cmToYjs.get(cmId);
    }

    getCmId(yjsId: string): number | undefined {
        return this.yjsToCm.get(yjsId);
    }

    register(yjsId: string, cmId: number): void {
        this.yjsToCm.set(yjsId, cmId);
        this.cmToYjs.set(cmId, yjsId);
        if (cmId >= this.nextCmId) {
            this.nextCmId = cmId + 1;
        }
    }

    remove(yjsId: string): void {
        const cmId = this.yjsToCm.get(yjsId);
        if (cmId !== undefined) {
            this.cmToYjs.delete(cmId);
        }
        this.yjsToCm.delete(yjsId);
    }

    clear(): void {
        this.yjsToCm.clear();
        this.cmToYjs.clear();
        this.nextCmId = 0;
    }
}
