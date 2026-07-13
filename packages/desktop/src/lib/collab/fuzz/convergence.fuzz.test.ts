/**
 * convergence.fuzz.test.ts — Opt-in 10k-operation two-peer convergence stress test.
 *
 * This suite is intentionally excluded from normal CI by the COLLAB_FUZZ gate.
 * Run it with `bun run desktop:test:collab-fuzz` from the repository root.
 * Failures report a deterministic seed and operation index for exact replay.
 */
import { yjsAnnotationToCodeMirror } from "$lib/collab/annotationSchema";
import {
    type Peer,
    connect,
    flushAll,
    makePeerWithAnnotationSync,
    teardown,
} from "$lib/collab/test-helpers/twoPeerHarness";
import type { YjsAnnotationNode } from "$lib/collab/types";
import {
    addAnnotation,
    annotationField,
    removeAnnotation,
} from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation } from "$lib/editor/plugins/annotations/models";
import { EditorSelection } from "@codemirror/state";
import { describe, expect, test } from "vitest";

const DEFAULT_OPERATION_COUNT = 10_000;
const DEFAULT_SEED = 334_462;
const DEFAULT_CHECKPOINT_INTERVAL = 100;
const MAX_ANNOTATIONS = 200;
const MAX_DOCUMENT_LENGTH = 2_000;
const RUN_LONG_FUZZ = process.env.COLLAB_FUZZ === "1";

type Random = () => number;

function envInteger(name: string, fallback: number, minimum: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < minimum) {
        throw new Error(`${name} must be an integer >= ${minimum}; received ${raw}`);
    }
    return parsed;
}

function mulberry32(seed: number): Random {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    };
}

function randomInteger(random: Random, maxExclusive: number): number {
    return Math.floor(random() * maxExclusive);
}

function randomText(random: Random): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz     \n";
    const length = 1 + randomInteger(random, 5);
    let value = "";
    for (let index = 0; index < length; index++) {
        value += alphabet[randomInteger(random, alphabet.length)];
    }
    return value;
}

function normalize(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(normalize);
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        // `_historyId` is private CodeMirror undo lineage. Live collaboration
        // uses Y.UndoManager and deliberately does not transmit this field.
        if (key === "_historyId") continue;
        sorted[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
}

function projectFromYjs(peer: Peer): unknown {
    const projected: Record<string, unknown> = {};
    peer.ymap.forEach((value, yjsId) => {
        const cmId = peer.idMap?.getCmId(yjsId);
        if (cmId === undefined) return;
        const annotation = yjsAnnotationToCodeMirror(
            value as YjsAnnotationNode,
            peer.ydoc,
            peer.ytext,
            cmId,
        );
        if (annotation !== null) projected[String(cmId)] = annotation;
    });
    return normalize(projected);
}

function projectFromCodeMirror(peer: Peer): unknown {
    return normalize(peer.view.state.field(annotationField) as unknown);
}

function insertText(peer: Peer, random: Random): string {
    const docLength = peer.view.state.doc.length;
    const from = randomInteger(random, docLength + 1);
    const insert = randomText(random);
    peer.view.dispatch({ changes: { from, insert } });
    return `insert peer=${peer.clientId} from=${from} text=${JSON.stringify(insert)}`;
}

function deleteText(peer: Peer, random: Random): string {
    const docLength = peer.view.state.doc.length;
    if (docLength === 0) {
        return insertText(peer, random);
    }
    const from = randomInteger(random, docLength);
    const maxLength = Math.min(8, docLength - from);
    const to = from + 1 + randomInteger(random, maxLength);
    peer.view.dispatch({ changes: { from, to, insert: "" } });
    return `delete peer=${peer.clientId} from=${from} to=${to}`;
}

function addComment(peer: Peer, random: Random): string {
    const docLength = peer.view.state.doc.length;
    if (docLength === 0) {
        return insertText(peer, random);
    }
    const annotations = peer.view.state.field(annotationField);
    if (Object.keys(annotations).length >= MAX_ANNOTATIONS) {
        return removeComment(peer, random);
    }
    const from = randomInteger(random, docLength);
    const maxLength = Math.min(12, docLength - from);
    const to = from + 1 + randomInteger(random, maxLength);
    const comment = createNewAnnotation(annotations, EditorSelection.single(from, to), "comment");
    peer.view.dispatch({ effects: addAnnotation.of(comment) });
    return `add-comment peer=${peer.clientId} id=${comment.id} from=${from} to=${to}`;
}

function removeComment(peer: Peer, random: Random): string {
    const annotations = Object.values(peer.view.state.field(annotationField));
    if (annotations.length === 0) {
        return addComment(peer, random);
    }
    const annotation = annotations[randomInteger(random, annotations.length)];
    peer.view.dispatch({ effects: removeAnnotation.of(annotation) });
    return `remove-comment peer=${peer.clientId} id=${annotation.id}`;
}

function applyRandomOperation(peers: [Peer, Peer], random: Random): string {
    const peer = peers[randomInteger(random, peers.length)];
    const roll = randomInteger(random, 100);
    if (peer.view.state.doc.length > MAX_DOCUMENT_LENGTH || roll < 30) {
        return deleteText(peer, random);
    }
    if (roll < 72) {
        return insertText(peer, random);
    }
    if (roll < 88) {
        return addComment(peer, random);
    }
    return removeComment(peer, random);
}

async function expectConvergence(peerA: Peer, peerB: Peer): Promise<void> {
    await flushAll(peerA, peerB);
    expect(peerA.view.state.doc.toString()).toBe(peerB.view.state.doc.toString());
    expect(peerA.view.state.doc.toString()).toBe(peerA.ytext.toString());
    expect(peerB.view.state.doc.toString()).toBe(peerB.ytext.toString());
    expect(projectFromCodeMirror(peerA)).toEqual(projectFromYjs(peerA));
    expect(projectFromCodeMirror(peerB)).toEqual(projectFromYjs(peerB));
    expect(normalize(peerA.ymap.toJSON())).toEqual(normalize(peerB.ymap.toJSON()));
}

describe.skipIf(!RUN_LONG_FUZZ)("HARNESS-03: long-running two-peer convergence fuzz", () => {
    test(
        "converges after 10,000 seeded collaborative operations",
        async () => {
            const operationCount = envInteger("COLLAB_FUZZ_OPERATIONS", DEFAULT_OPERATION_COUNT, 1);
            const seed = envInteger("COLLAB_FUZZ_SEED", DEFAULT_SEED, 0);
            const checkpointInterval = envInteger(
                "COLLAB_FUZZ_CHECKPOINT_INTERVAL",
                DEFAULT_CHECKPOINT_INTERVAL,
                1,
            );
            const random = mulberry32(seed);
            const peerA = makePeerWithAnnotationSync("fuzz-a", "Quillium fuzz seed");
            const peerB = makePeerWithAnnotationSync("fuzz-b");
            const disconnect = connect(peerA, peerB);
            let operationIndex = 0;
            let lastOperation = "initial convergence";
            const recentOperations: string[] = [];

            try {
                await expectConvergence(peerA, peerB);
                for (; operationIndex < operationCount; operationIndex++) {
                    lastOperation = applyRandomOperation([peerA, peerB], random);
                    recentOperations.push(`${operationIndex + 1}: ${lastOperation}`);
                    if (recentOperations.length > 20) recentOperations.shift();
                    // A real user action yields to the event loop before the next
                    // action. Let queued CM projections settle at the same cadence.
                    await flushAll(peerA, peerB);
                    if ((operationIndex + 1) % checkpointInterval === 0) {
                        await expectConvergence(peerA, peerB);
                    }
                }
                await expectConvergence(peerA, peerB);
            } catch (error) {
                throw new Error(
                    `[collab fuzz] seed=${seed} operation=${operationIndex + 1}/${operationCount} ${lastOperation}\n${recentOperations.join("\n")}`,
                    { cause: error },
                );
            } finally {
                disconnect();
                teardown(peerA);
                teardown(peerB);
            }
        },
        10 * 60 * 1_000,
    );
});
