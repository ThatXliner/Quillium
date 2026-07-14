import {
    type GenericAnnotation,
    type RawAnnotation,
    type RawAnnotations,
    RawAnnotationsSchema,
    type SuggestionReplacement,
    type ThreadMessage,
    type VersionState,
    activeVersionIndex,
    isAnnotationOfType,
    normalizeAnnotation,
    normalizeRevision,
} from "$lib/editor/plugins/annotations/models";
/**
 * annotationSchema.ts — Yjs recursive-Y.Map annotation converters.
 *
 * Per D-90/D-92: YjsAnnotation is a Y.Map<unknown> with Y.Text/Y.Array/Y.Map children.
 * Per D-93: Comment threads are Y.Array<ThreadMessage> (append-only, sorted on read).
 * Per #269: Revision versions are id-native on the wire. The versions Y.Map is
 * keyed by VersionState.id, `order` stores display order, and `activeVersionId`
 * stores the active pointer. The reader still accepts the older index-keyed
 * shape for rooms that have not been migrated yet.
 *
 * Converter invariants:
 *   - codeMirrorToYjsAnnotation runs structural child-Y-type creation inside a
 *     single ydoc.transact(..., "init").
 *   - yjsAnnotationToCodeMirror never throws; it returns null on malformed data.
 *   - Revision version subtree annotations are synced only after their Y.Text is
 *     integrated into a Y.Doc, because Yjs relative positions require that.
 *
 * Key dependencies:
 *   - yjs (Y.Map, Y.Text, Y.Array) for runtime construction
 *   - ./relativePosition for position encoding
 *   - ../editor/plugins/annotations/models for CM types
 */
import { EditorSelection } from "@codemirror/state";
import * as Y from "yjs";
import { absoluteToRelative, relativeToAbsolute } from "./relativePosition";
import type { YjsAnnotationNode } from "./types";

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
 * Creates the structural child Y types inside a single ydoc.transact. Nested
 * version annotations are populated later by syncRawAnnotationsToYjsMap once
 * the version Y.Text has been integrated into a document.
 */
export function codeMirrorToYjsAnnotation(
    annotation: GenericAnnotation,
    ytext: Y.Text,
    clientId: string,
    ydoc: Y.Doc,
    _options?: {
        nestedIdMapFor?: (annotations: Y.Map<YjsAnnotationNode>) => AnnotationIdMap;
    },
): YjsAnnotationNode {
    const { startPos, endPos } = absoluteToRelative(ytext, annotation.selection);
    const node: YjsAnnotationNode = new Y.Map<unknown>();

    ydoc.transact(() => {
        node.set("id", generateAnnotationId(clientId));
        node.set("_type", annotation._type);
        node.set("status", annotation.status);
        node.set("startPos", startPos);
        node.set("endPos", endPos);

        const thread = new Y.Array<ThreadMessage>();
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
            const order = new Y.Array<string>();
            const versionIds: string[] = [];
            for (const v of annotation.versions) {
                const versionNode = new Y.Map<unknown>();
                const vtext = new Y.Text();
                if (v.doc.length > 0) {
                    vtext.insert(0, v.doc);
                }
                versionNode.set("id", v.id);
                versionNode.set("text", vtext);
                if (v.label !== undefined) {
                    versionNode.set("label", v.label);
                }
                versionNode.set("annotations", new Y.Map<YjsAnnotationNode>());
                versionsMap.set(v.id, versionNode);
                versionIds.push(v.id);
            }
            if (versionIds.length > 0) {
                order.push(versionIds);
            }
            node.set("versions", versionsMap);
            node.set("order", order);
            const activeVersionId = annotation.versions.some(
                (v) => v.id === annotation.activeVersionId,
            )
                ? annotation.activeVersionId
                : annotation.versions[0]?.id;
            if (activeVersionId !== undefined) {
                node.set("activeVersionId", activeVersionId);
            }
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
    options?: {
        nestedIdMapFor?: (annotations: Y.Map<YjsAnnotationNode>) => AnnotationIdMap;
    },
): GenericAnnotation | null {
    const startPos = node.get("startPos") as Uint8Array | undefined;
    const endPos = node.get("endPos") as Uint8Array | undefined;
    if (!(startPos instanceof Uint8Array) || !(endPos instanceof Uint8Array)) {
        console.warn("[annotationSchema] Missing or malformed positions");
        return null;
    }

    let selection: EditorSelection | null;
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
    const thread: ThreadMessage[] =
        threadArr instanceof Y.Array ? (threadArr.toArray() as ThreadMessage[]) : [];

    const type = node.get("_type") as GenericAnnotation["_type"] | undefined;
    if (type !== "comment" && type !== "suggestion" && type !== "revision") {
        console.warn("[annotationSchema] Unknown _type:", type);
        return null;
    }

    const rawStatus = node.get("status");
    const status = rawStatus === "pending" || rawStatus === "active" ? rawStatus : undefined;
    const base = { id: numericId, selection, thread, status };

    if (type === "comment") {
        return normalizeAnnotation({ ...base, _type: "comment" } as GenericAnnotation);
    }

    if (type === "suggestion") {
        const replArr = node.get("replacements");
        const replacements: SuggestionReplacement[] =
            replArr instanceof Y.Array ? (replArr.toArray() as SuggestionReplacement[]) : [];
        const author = node.get("author");
        return normalizeAnnotation({
            ...base,
            _type: "suggestion",
            replacements,
            author: typeof author === "string" ? author : undefined,
        } as GenericAnnotation);
    }

    // revision
    const versionsMap = node.get("versions");
    if (!(versionsMap instanceof Y.Map)) {
        console.warn("[annotationSchema] Revision missing versions map");
        return null;
    }
    const keys = orderedVersionKeys(node, versionsMap);
    if (keys.length === 0) {
        console.warn("[annotationSchema] Revision has empty versions map");
        return null;
    }
    // Loose pre-normalization versions: legacy index-keyed rooms may have no
    // version ids yet. normalizeRevision() mints ids for those below, while
    // id-native rooms preserve the stable key/id.
    const versions: Record<string, unknown>[] = keys.map((key) => {
        const v = versionsMap.get(key) as Y.Map<unknown>;
        const vtext = v.get("text");
        const doc = vtext instanceof Y.Text ? vtext.toString() : "";
        const label = v.get("label");
        const versionId = versionIdForYjsKey(key, v);
        const nestedAnnotations = v.get("annotations");
        const annotationField =
            nestedAnnotations instanceof Y.Map && vtext instanceof Y.Text
                ? yjsAnnotationMapToRawAnnotations(nestedAnnotations, ydoc, vtext, options)
                : undefined;
        return {
            ...(versionId !== undefined ? { id: versionId } : {}),
            doc,
            ...(typeof label === "string" ? { label } : {}),
            ...(annotationField && Object.keys(annotationField).length > 0
                ? { annotationField }
                : {}),
        };
    });

    const rawIndex =
        typeof node.get("activeVersionIndex") === "number"
            ? (node.get("activeVersionIndex") as number)
            : 0;

    const activeVersionId = node.get("activeVersionId");

    // normalizeRevision heals legacy rooms into the runtime id-native shape:
    // versions without ids get ids, and activeVersionIndex is translated into
    // activeVersionId when the newer pointer is missing or stale.
    return normalizeRevision(
        normalizeAnnotation({
            ...base,
            _type: "revision",
            versions,
            ...(typeof activeVersionId === "string" ? { activeVersionId } : {}),
            activeVersionIndex: rawIndex,
        } as unknown as GenericAnnotation) as never,
    );
}

function orderedVersionKeys(node: YjsAnnotationNode, versionsMap: Y.Map<Y.Map<unknown>>): string[] {
    const knownKeys = new Set(versionsMap.keys());
    const order = node.get("order");
    const ordered =
        order instanceof Y.Array
            ? order.toArray().filter((id): id is string => typeof id === "string")
            : [];
    const result: string[] = [];
    const seen = new Set<string>();

    for (const key of ordered) {
        if (knownKeys.has(key) && !seen.has(key)) {
            result.push(key);
            seen.add(key);
        }
    }

    const remaining = Array.from(knownKeys)
        .filter((key) => !seen.has(key))
        .sort(compareVersionMapKeys);
    return [...result, ...remaining];
}

function compareVersionMapKeys(a: string, b: string): number {
    const aIndex = legacyVersionIndex(a);
    const bIndex = legacyVersionIndex(b);
    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    return a.localeCompare(b);
}

function legacyVersionIndex(key: string): number | undefined {
    const parsed = Number(key);
    return Number.isInteger(parsed) && parsed >= 0 && String(parsed) === key ? parsed : undefined;
}

function versionIdForYjsKey(key: string, node: Y.Map<unknown>): string | undefined {
    const nodeId = node.get("id");
    if (typeof nodeId === "string" && nodeId.length > 0) return nodeId;
    return legacyVersionIndex(key) === undefined ? key : undefined;
}

export function getRawAnnotationField(version: VersionState): RawAnnotations | undefined {
    const candidate = (version as { annotationField?: unknown }).annotationField;
    if (candidate == null) return undefined;
    const parsed = RawAnnotationsSchema.safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
}

function rawAnnotationToCodeMirror(raw: RawAnnotation): GenericAnnotation {
    const annotation = normalizeAnnotation({
        ...raw,
        selection: EditorSelection.fromJSON(raw.selection),
    } as GenericAnnotation);
    return isAnnotationOfType(annotation, "revision") ? normalizeRevision(annotation) : annotation;
}

function codeMirrorAnnotationToRaw(annotation: GenericAnnotation): RawAnnotation {
    return {
        ...annotation,
        selection: annotation.selection.toJSON(),
    } as RawAnnotation;
}

export function syncRawAnnotationsToYjsMap(
    rawAnnotations: RawAnnotations | undefined,
    annotationsMap: Y.Map<YjsAnnotationNode>,
    ytext: Y.Text,
    clientId: string,
    ydoc: Y.Doc,
    idMap: AnnotationIdMap,
    options?: {
        nestedIdMapFor?: (annotations: Y.Map<YjsAnnotationNode>) => AnnotationIdMap;
    },
): void {
    const entries = rawAnnotations ? Object.entries(rawAnnotations) : [];
    const rawIds = new Set(entries.map(([id]) => Number(id)));

    for (const yjsKey of Array.from(annotationsMap.keys())) {
        const cmId = idMap.getCmId(yjsKey);
        if (cmId === undefined || !rawIds.has(cmId)) {
            annotationsMap.delete(yjsKey);
            idMap.remove(yjsKey);
        }
    }

    for (const [id, raw] of entries) {
        const cmId = Number(id);
        if (!Number.isFinite(cmId)) continue;
        const annotation = rawAnnotationToCodeMirror(raw);
        const yjsKey = idMap.getOrCreateYjsId(cmId, clientId);
        const node = codeMirrorToYjsAnnotation(annotation, ytext, clientId, ydoc, options);
        node.set("id", yjsKey);
        annotationsMap.set(yjsKey, node);
        syncIntegratedAnnotationSubtrees(annotation, node, clientId, ydoc, options);
    }
}

function syncIntegratedAnnotationSubtrees(
    annotation: GenericAnnotation,
    node: YjsAnnotationNode,
    clientId: string,
    ydoc: Y.Doc,
    options?: {
        nestedIdMapFor?: (annotations: Y.Map<YjsAnnotationNode>) => AnnotationIdMap;
    },
): void {
    if (!isAnnotationOfType(annotation, "revision")) return;

    const versionsMap = node.get("versions");
    if (!(versionsMap instanceof Y.Map)) return;

    for (const version of annotation.versions) {
        const versionNode = versionsMap.get(version.id);
        if (!(versionNode instanceof Y.Map)) continue;

        const vtext = versionNode.get("text");
        if (!(vtext instanceof Y.Text)) continue;

        let nestedAnnotations = versionNode.get("annotations");
        if (!(nestedAnnotations instanceof Y.Map)) {
            nestedAnnotations = new Y.Map<YjsAnnotationNode>();
            versionNode.set("annotations", nestedAnnotations);
        }

        syncRawAnnotationsToYjsMap(
            getRawAnnotationField(version),
            nestedAnnotations,
            vtext,
            clientId,
            ydoc,
            options?.nestedIdMapFor?.(nestedAnnotations) ?? new AnnotationIdMap(),
            options,
        );
    }
}

function yjsAnnotationMapToRawAnnotations(
    annotationsMap: Y.Map<YjsAnnotationNode>,
    ydoc: Y.Doc,
    ytext: Y.Text,
    options?: {
        nestedIdMapFor?: (annotations: Y.Map<YjsAnnotationNode>) => AnnotationIdMap;
    },
): RawAnnotations {
    const idMap = options?.nestedIdMapFor?.(annotationsMap) ?? new AnnotationIdMap();
    const raw: RawAnnotations = {};

    annotationsMap.forEach((node, yjsKey) => {
        const cmId = idMap.getOrCreateCmId(yjsKey);
        const annotation = yjsAnnotationToCodeMirror(node, ydoc, ytext, cmId, options);
        if (!annotation) return;
        raw[String(annotation.id)] = codeMirrorAnnotationToRaw(annotation);
    });

    return raw;
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
            if (cmId >= this.nextCmId) {
                this.nextCmId = cmId + 1;
            }
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
