/**
 * migrations.ts -- Versioned Y.Doc schema migrations for the relay.
 *
 * The relay persists opaque Yjs updates, so on-the-wire shape changes need to
 * run against a loaded Y.Doc before clients sync. Migrations are idempotent and
 * versioned in a private metadata map stored in the same Y.Doc.
 */
import * as Y from "yjs";

export const CURRENT_YJS_SCHEMA_VERSION = 2;
export const YJS_SCHEMA_META_MAP = "__quillium";
export const YJS_SCHEMA_VERSION_KEY = "schemaVersion";

export interface YjsMigrationResult {
    startedVersion: number;
    currentVersion: number;
    applied: string[];
    changed: boolean;
}

type Migration = {
    version: number;
    name: string;
    apply: (ydoc: Y.Doc) => boolean;
};

type YjsAnnotationNode = Y.Map<unknown>;

type VersionEntry = {
    key: string;
    id: string;
    node: Y.Map<unknown>;
};

type ReanchorTask = {
    node: YjsAnnotationNode;
    targetText: Y.Text;
    startIndex?: number;
    endIndex?: number;
};

const migrations: Migration[] = [
    {
        version: 2,
        name: "id-native-revision-versions",
        apply: migrateRevisionVersionsToIds,
    },
];

export function readYjsSchemaVersion(ydoc: Y.Doc): number {
    const meta = ydoc.getMap<unknown>(YJS_SCHEMA_META_MAP);
    const version = meta.get(YJS_SCHEMA_VERSION_KEY);
    return typeof version === "number" && Number.isInteger(version) && version > 0 ? version : 1;
}

export function migrateYjsDoc(ydoc: Y.Doc): YjsMigrationResult {
    const startedVersion = readYjsSchemaVersion(ydoc);
    let currentVersion = startedVersion;
    let changed = false;
    const applied: string[] = [];

    for (const migration of migrations) {
        if (currentVersion >= migration.version) continue;

        ydoc.transact(() => {
            changed = migration.apply(ydoc) || changed;
            ydoc.getMap<unknown>(YJS_SCHEMA_META_MAP).set(
                YJS_SCHEMA_VERSION_KEY,
                migration.version,
            );
            // The schema stamp itself is part of the persisted Y.Doc shape. Even
            // if a room has no legacy nodes to rewrite, persist the version bump
            // so the relay does not repeat this migration on every load.
            changed = true;
        }, "schema-migration");

        currentVersion = migration.version;
        applied.push(migration.name);
    }

    return { startedVersion, currentVersion, applied, changed };
}

function migrateRevisionVersionsToIds(ydoc: Y.Doc): boolean {
    const annotations = ydoc.getMap<YjsAnnotationNode>("annotations");
    return migrateAnnotationMap(annotations, ydoc);
}

function migrateAnnotationMap(annotations: Y.Map<YjsAnnotationNode>, ydoc: Y.Doc): boolean {
    let changed = false;

    for (const node of annotations.values()) {
        if (!(node instanceof Y.Map)) continue;
        changed = migrateAnnotationNode(node, ydoc) || changed;
    }

    return changed;
}

function migrateAnnotationNode(node: YjsAnnotationNode, ydoc: Y.Doc): boolean {
    let changed = false;

    const childAnnotations = node.get("annotations");
    if (childAnnotations instanceof Y.Map) {
        changed =
            migrateAnnotationMap(childAnnotations as Y.Map<YjsAnnotationNode>, ydoc) || changed;
    }

    if (node.get("_type") !== "revision") return changed;

    const migration = buildIdNativeRevisionVersions(node, ydoc);
    if (!migration) return changed;

    node.set("versions", migration.versionsMap);
    setVersionOrder(node, migration.order);
    setActiveVersionId(node, node, migration.order, migration.entries);
    applyReanchorTasks(migration.reanchorTasks);
    if (node.get("activeVersionIndex") !== undefined) {
        node.delete("activeVersionIndex");
    }

    return true;
}

function buildIdNativeRevisionVersions(
    revisionNode: YjsAnnotationNode,
    ydoc: Y.Doc,
    reanchorTasks: ReanchorTask[] = [],
): {
    versionsMap: Y.Map<Y.Map<unknown>>;
    order: string[];
    entries: VersionEntry[];
    reanchorTasks: ReanchorTask[];
} | null {
    const sourceVersions = revisionNode.get("versions");
    if (!(sourceVersions instanceof Y.Map)) return null;

    const entries = readVersionEntries(revisionNode, sourceVersions as Y.Map<Y.Map<unknown>>);
    if (entries.length === 0) return null;

    const versionsMap = new Y.Map<Y.Map<unknown>>();
    const order: string[] = [];

    for (const entry of entries) {
        versionsMap.set(entry.id, cloneVersionNode(entry.node, entry.id, ydoc, reanchorTasks));
        order.push(entry.id);
    }

    return { versionsMap, order, entries, reanchorTasks };
}

function readVersionEntries(
    revisionNode: YjsAnnotationNode,
    versionsMap: Y.Map<Y.Map<unknown>>,
): VersionEntry[] {
    const orderedKeys = orderedVersionKeys(revisionNode, versionsMap);
    const usedIds = new Set<string>();
    const entries: VersionEntry[] = [];

    for (const key of orderedKeys) {
        const node = versionsMap.get(key);
        if (!(node instanceof Y.Map)) continue;

        const id = uniqueVersionId(versionIdForKey(key, node), usedIds);
        usedIds.add(id);
        entries.push({ key, id, node });
    }

    return entries;
}

function orderedVersionKeys(
    revisionNode: YjsAnnotationNode,
    versionsMap: Y.Map<Y.Map<unknown>>,
): string[] {
    const allKeys = Array.from(versionsMap.keys());
    const seen = new Set<string>();
    const result: string[] = [];
    const order = revisionNode.get("order");

    if (order instanceof Y.Array) {
        for (const rawId of order.toArray()) {
            if (typeof rawId !== "string") continue;
            const key = findKeyForOrderedVersionId(rawId, allKeys, versionsMap);
            if (key !== undefined && !seen.has(key)) {
                result.push(key);
                seen.add(key);
            }
        }
    }

    const remaining = allKeys.filter((key) => !seen.has(key)).sort(compareVersionMapKeys);
    return [...result, ...remaining];
}

function findKeyForOrderedVersionId(
    id: string,
    keys: string[],
    versionsMap: Y.Map<Y.Map<unknown>>,
): string | undefined {
    if (versionsMap.has(id)) return id;
    return keys.find((key) => {
        const node = versionsMap.get(key);
        return node instanceof Y.Map && versionIdForKey(key, node) === id;
    });
}

function versionIdForKey(key: string, node: Y.Map<unknown>): string {
    const nodeId = node.get("id");
    if (typeof nodeId === "string" && nodeId.length > 0) return nodeId;
    if (legacyVersionIndex(key) !== undefined) return `legacy-${key}`;
    return key.length > 0 ? key : "legacy-version";
}

function uniqueVersionId(candidate: string, usedIds: Set<string>): string {
    if (!usedIds.has(candidate)) return candidate;

    let index = 1;
    let next = `${candidate}-${index}`;
    while (usedIds.has(next)) {
        index += 1;
        next = `${candidate}-${index}`;
    }
    return next;
}

function setVersionOrder(node: YjsAnnotationNode, orderIds: string[]): void {
    const order = new Y.Array<string>();
    if (orderIds.length > 0) {
        order.push(orderIds);
    }
    node.set("order", order);
}

function setActiveVersionId(
    target: YjsAnnotationNode,
    source: YjsAnnotationNode,
    order: string[],
    entries: VersionEntry[],
): void {
    const currentActiveId = source.get("activeVersionId");
    if (typeof currentActiveId === "string" && order.includes(currentActiveId)) {
        target.set("activeVersionId", currentActiveId);
        return;
    }

    const activeIndex = source.get("activeVersionIndex");
    const index =
        typeof activeIndex === "number" && Number.isFinite(activeIndex)
            ? Math.max(0, Math.min(Math.trunc(activeIndex), entries.length - 1))
            : 0;
    const activeVersionId = entries[index]?.id ?? order[0];
    if (activeVersionId !== undefined) {
        target.set("activeVersionId", activeVersionId);
    }
}

function cloneVersionNode(
    source: Y.Map<unknown>,
    versionId: string,
    ydoc: Y.Doc,
    reanchorTasks: ReanchorTask[],
): Y.Map<unknown> {
    const clone = new Y.Map<unknown>();
    const sourceText = source.get("text");
    const targetText = new Y.Text();
    const text = sourceText instanceof Y.Text ? sourceText.toString() : "";
    if (text.length > 0) {
        targetText.insert(0, text);
    }

    clone.set("id", versionId);
    clone.set("text", targetText);

    const label = source.get("label");
    if (typeof label === "string") {
        clone.set("label", label);
    }

    const annotations = new Y.Map<YjsAnnotationNode>();
    const sourceAnnotations = source.get("annotations");
    if (sourceAnnotations instanceof Y.Map) {
        cloneAnnotationMapForText(
            sourceAnnotations as Y.Map<YjsAnnotationNode>,
            annotations,
            ydoc,
            sourceText instanceof Y.Text ? sourceText : null,
            targetText,
            reanchorTasks,
        );
    }
    clone.set("annotations", annotations);

    return clone;
}

function cloneAnnotationMapForText(
    source: Y.Map<YjsAnnotationNode>,
    target: Y.Map<YjsAnnotationNode>,
    ydoc: Y.Doc,
    sourceText: Y.Text | null,
    targetText: Y.Text,
    reanchorTasks: ReanchorTask[],
): void {
    source.forEach((node, key) => {
        if (!(node instanceof Y.Map)) return;
        target.set(
            key,
            cloneAnnotationNodeForText(node, ydoc, sourceText, targetText, reanchorTasks),
        );
    });
}

function cloneAnnotationNodeForText(
    source: YjsAnnotationNode,
    ydoc: Y.Doc,
    sourceText: Y.Text | null,
    targetText: Y.Text,
    reanchorTasks: ReanchorTask[],
): YjsAnnotationNode {
    const clone = new Y.Map<unknown>();

    copyScalar(source, clone, "id");
    copyScalar(source, clone, "_type");
    copyRelativePosition(source, clone, "startPos");
    copyRelativePosition(source, clone, "endPos");
    if (sourceText) {
        reanchorTasks.push({
            node: clone as YjsAnnotationNode,
            targetText,
            startIndex: relativePositionIndex(source.get("startPos"), ydoc, sourceText),
            endIndex: relativePositionIndex(source.get("endPos"), ydoc, sourceText),
        });
    }
    copyArray(source, clone, "thread");

    const childAnnotations = new Y.Map<YjsAnnotationNode>();
    const sourceChildAnnotations = source.get("annotations");
    if (sourceChildAnnotations instanceof Y.Map) {
        cloneAnnotationMapForText(
            sourceChildAnnotations as Y.Map<YjsAnnotationNode>,
            childAnnotations,
            ydoc,
            sourceText,
            targetText,
            reanchorTasks,
        );
    }
    clone.set("annotations", childAnnotations);

    if (source.get("_type") === "suggestion") {
        copyArray(source, clone, "replacements");
        copyScalar(source, clone, "author");
    }

    if (source.get("_type") === "revision") {
        const migration = buildIdNativeRevisionVersions(source, ydoc, reanchorTasks);
        if (migration) {
            clone.set("versions", migration.versionsMap);
            setVersionOrder(clone, migration.order);
            setActiveVersionId(clone, source, migration.order, migration.entries);
        }
    }

    return clone as YjsAnnotationNode;
}

function copyScalar(source: Y.Map<unknown>, target: Y.Map<unknown>, key: string): void {
    const value = source.get(key);
    if (isJsonScalar(value)) {
        target.set(key, cloneJson(value));
    }
}

function copyArray(source: Y.Map<unknown>, target: Y.Map<unknown>, key: string): void {
    const value = source.get(key);
    const copy = new Y.Array<unknown>();
    if (value instanceof Y.Array && value.length > 0) {
        copy.push(value.toArray().map(cloneJson));
    }
    target.set(key, copy);
}

function copyRelativePosition(source: Y.Map<unknown>, target: Y.Map<unknown>, key: string): void {
    const value = source.get(key);
    if (!(value instanceof Uint8Array)) return;
    target.set(key, value);
}

function applyReanchorTasks(tasks: ReanchorTask[]): void {
    for (const task of tasks) {
        reanchorAnnotationNode(task);
    }
}

function reanchorAnnotationNode({ node, targetText, startIndex, endIndex }: ReanchorTask): void {
    if (startIndex !== undefined) {
        node.set("startPos", encodeRelativePosition(targetText, startIndex));
    }

    if (endIndex !== undefined) {
        node.set("endPos", encodeRelativePosition(targetText, endIndex));
    }
}

function relativePositionIndex(
    encoded: unknown,
    ydoc: Y.Doc,
    sourceText: Y.Text,
): number | undefined {
    if (!(encoded instanceof Uint8Array)) return undefined;

    try {
        const relative = Y.decodeRelativePosition(encoded);
        const absolute = Y.createAbsolutePositionFromRelativePosition(relative, ydoc);
        if (!absolute || absolute.type !== sourceText) return undefined;
        return absolute.index;
    } catch {
        return undefined;
    }
}

function encodeRelativePosition(targetText: Y.Text, index: number): Uint8Array {
    const clamped = Math.max(0, Math.min(index, targetText.length));
    return Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(targetText, clamped));
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

function cloneJson<T>(value: T): T {
    if (value === null || typeof value !== "object") return value;
    return JSON.parse(JSON.stringify(value)) as T;
}

function isJsonScalar(value: unknown): value is string | number | boolean | null {
    return (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    );
}
