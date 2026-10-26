/**
 * migrations.test.ts -- Relay Y.Doc schema migration tests.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
    CURRENT_YJS_SCHEMA_VERSION,
    YJS_SCHEMA_META_MAP,
    YJS_SCHEMA_VERSION_KEY,
    migrateYjsDoc,
    readYjsSchemaVersion,
} from "../yjs/migrations.js";

function setRelativeRange(node: Y.Map<unknown>, ytext: Y.Text, from: number, to: number): void {
    const startRel = Y.createRelativePositionFromTypeIndex(ytext, from);
    const endRel = Y.createRelativePositionFromTypeIndex(ytext, to);
    node.set("startPos", Y.encodeRelativePosition(startRel));
    node.set("endPos", Y.encodeRelativePosition(endRel));
}

function absolutePosition(
    ydoc: Y.Doc,
    encoded: unknown,
): { type: Y.AbstractType<unknown>; index: number } | null {
    if (!(encoded instanceof Uint8Array)) return null;
    const position = Y.createAbsolutePositionFromRelativePosition(
        Y.decodeRelativePosition(encoded),
        ydoc,
    );
    return position ? { type: position.type, index: position.index } : null;
}

function makeLegacyRevisionDoc(): { ydoc: Y.Doc; revision: Y.Map<unknown> } {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const annotations = ydoc.getMap<Y.Map<unknown>>("annotations");
    const revision = new Y.Map<unknown>();

    ydoc.transact(() => {
        ytext.insert(0, "hello world");
        annotations.set("rev-1", revision);
        revision.set("id", "rev-1");
        revision.set("_type", "revision");
        setRelativeRange(revision, ytext, 0, 5);
        revision.set("thread", new Y.Array());
        revision.set("annotations", new Y.Map());

        const versions = new Y.Map<Y.Map<unknown>>();
        revision.set("versions", versions);
        revision.set("activeVersionIndex", 1);

        const v0 = new Y.Map<unknown>();
        const v0Text = new Y.Text();
        const v0Annotations = new Y.Map<Y.Map<unknown>>();
        versions.set("0", v0);
        v0.set("text", v0Text);
        v0Text.insert(0, "hello");
        v0.set("label", "original");
        v0.set("annotations", v0Annotations);

        const nestedComment = new Y.Map<unknown>();
        v0Annotations.set("nested-comment", nestedComment);
        nestedComment.set("id", "nested-comment");
        nestedComment.set("_type", "comment");
        setRelativeRange(nestedComment, v0Text, 0, 2);
        nestedComment.set("thread", new Y.Array());
        nestedComment.set("annotations", new Y.Map());

        const v1 = new Y.Map<unknown>();
        const v1Text = new Y.Text();
        versions.set("1", v1);
        v1.set("text", v1Text);
        v1Text.insert(0, "hullo");
        v1.set("annotations", new Y.Map());
    }, "init");

    return { ydoc, revision };
}

describe("Y.Doc schema migrations", () => {
    it("migrates legacy revision versions to id-native order and active id", () => {
        const { ydoc, revision } = makeLegacyRevisionDoc();

        const result = migrateYjsDoc(ydoc);

        expect(result.startedVersion).toBe(1);
        expect(result.currentVersion).toBe(CURRENT_YJS_SCHEMA_VERSION);
        expect(result.applied).toEqual(["id-native-revision-versions"]);
        expect(result.changed).toBe(true);
        expect(readYjsSchemaVersion(ydoc)).toBe(CURRENT_YJS_SCHEMA_VERSION);
        expect(ydoc.getMap<unknown>(YJS_SCHEMA_META_MAP).get(YJS_SCHEMA_VERSION_KEY)).toBe(
            CURRENT_YJS_SCHEMA_VERSION,
        );

        expect(revision.get("activeVersionIndex")).toBeUndefined();
        expect(revision.get("activeVersionId")).toBe("legacy-1");

        const order = revision.get("order") as Y.Array<string>;
        expect(order.toArray()).toEqual(["legacy-0", "legacy-1"]);

        const versions = revision.get("versions") as Y.Map<Y.Map<unknown>>;
        expect(versions.get("0")).toBeUndefined();
        expect(versions.get("1")).toBeUndefined();
        expect(versions.get("legacy-0")).toBeInstanceOf(Y.Map);
        expect(versions.get("legacy-1")).toBeInstanceOf(Y.Map);

        const migratedV0 = versions.get("legacy-0");
        if (!(migratedV0 instanceof Y.Map)) throw new Error("Expected migrated version");
        expect(migratedV0.get("id")).toBe("legacy-0");
        expect((migratedV0.get("text") as Y.Text).toString()).toBe("hello");
        expect(migratedV0.get("label")).toBe("original");

        const nested = migratedV0.get("annotations") as Y.Map<Y.Map<unknown>>;
        const nestedComment = nested.get("nested-comment");
        if (!(nestedComment instanceof Y.Map)) throw new Error("Expected nested comment");
        const migratedV0Text = migratedV0.get("text") as Y.Text;
        const start = absolutePosition(ydoc, nestedComment.get("startPos"));
        const end = absolutePosition(ydoc, nestedComment.get("endPos"));
        expect(start?.type).toBe(migratedV0Text);
        expect(start?.index).toBe(0);
        expect(end?.type).toBe(migratedV0Text);
        expect(end?.index).toBe(2);

        ydoc.destroy();
    });

    it("does not rerun migrations once the Y.Doc is stamped current", () => {
        const { ydoc } = makeLegacyRevisionDoc();

        const first = migrateYjsDoc(ydoc);
        const second = migrateYjsDoc(ydoc);

        expect(first.changed).toBe(true);
        expect(second.startedVersion).toBe(CURRENT_YJS_SCHEMA_VERSION);
        expect(second.currentVersion).toBe(CURRENT_YJS_SCHEMA_VERSION);
        expect(second.applied).toEqual([]);
        expect(second.changed).toBe(false);

        ydoc.destroy();
    });

    it("reports a change when only the schema stamp is applied", () => {
        const ydoc = new Y.Doc();

        const result = migrateYjsDoc(ydoc);

        expect(result.startedVersion).toBe(1);
        expect(result.currentVersion).toBe(CURRENT_YJS_SCHEMA_VERSION);
        expect(result.applied).toEqual(["id-native-revision-versions"]);
        expect(result.changed).toBe(true);
        expect(readYjsSchemaVersion(ydoc)).toBe(CURRENT_YJS_SCHEMA_VERSION);

        ydoc.destroy();
    });
});
