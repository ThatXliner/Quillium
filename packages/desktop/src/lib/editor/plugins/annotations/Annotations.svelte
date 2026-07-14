<script lang="ts">
import {
    type Annotations as AnnotationMap,
    type GenericAnnotation,
    type Thread,
    annotationField,
    isAnnotationOfType,
    removeAnnotation,
    updateThread,
} from "$lib/editor/plugins/annotations";
import { annotationEventBus } from "$lib/events/annotationEventBus";
import posthog from "$lib/posthog";
import {
    ANNOTATION_PANEL_DEFAULT_WIDTH,
    ANNOTATION_PANEL_MAX_WIDTH,
    ANNOTATION_PANEL_MIN_WIDTH,
    appSettings,
    persistSettings,
} from "$lib/settings.svelte";
import { activeAnnotation, annotations, editorView, modalStack, selectedText } from "$lib/stores";
import Kbd from "$lib/ui/Kbd.svelte";
import { type PointerDragOptions, pointerDrag } from "$lib/ui/pointerDrag";
/**
 * Annotations.svelte — Container that renders all annotation
 * cards (comments, revisions, suggestions) in either a
 * "floating" layout (absolutely positioned beside the editor)
 * or an "inline" layout (stacked vertically inside a sidebar).
 *
 * Props:
 *   - view?: EditorView — CodeMirror instance (falls back to
 *     the global editorView store)
 *   - annotationsData?: AnnotationMap — annotation map (falls
 *     back to the global annotations store)
 *   - activeAnnotationData?: GenericAnnotation | null — currently
 *     selected annotation. `undefined` falls back to the global
 *     activeAnnotation store; `null` means explicitly none.
 *   - layout?: "floating" | "inline" — positioning strategy
 *
 * Events emitted: none (dispatches CodeMirror effects directly)
 * Stores read: editorView, annotations, activeAnnotation
 *   (only when corresponding props are not provided)
 *
 * Parent: +page.svelte (floating), RevisionModal.svelte (inline)
 * Children: Comment, Revision, Suggestion, PreComment
 *
 * Floating layout uses viewport-relative positioning: each card
 * is absolutely placed at the Y coordinate of its annotation's
 * text range, with overlap avoidance that pushes cards downward.
 * A ResizeObserver recalculates positions when card heights
 * change (e.g. nested editor toggle).
 */
import type { EditorView } from "@codemirror/view";
import { Minimize2 } from "lucide-svelte";
import { onDestroy, tick } from "svelte";
import { toast } from "svelte-sonner";
import type { Action } from "svelte/action";
import Comment from "./Comment.svelte";
import PreComment from "./PreComment.svelte";
import Revision from "./Revision.svelte";
import Suggestion from "./Suggestion.svelte";
import {
    ANNOTATION_CARD_TOP_TRANSITION,
    AnnotationColumnDomController,
    type ColumnSide,
    MIN_ANNOTATION_COLUMN_WIDTH,
    annotationTopClamp,
    balanceColumns,
    idSignature,
    sidesEqual,
} from "./annotationLayout";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";
const opt = isMac ? "⌥" : "Alt";

const {
    view = undefined,
    annotationsData = undefined,
    activeAnnotationData = undefined,
    layout = "floating",
}: {
    view?: EditorView;
    annotationsData?: AnnotationMap;
    activeAnnotationData?: GenericAnnotation | null;
    layout?: "floating" | "inline";
} = $props();

// Resolve props vs global stores so child components get a
// single consistent data source regardless of context.
const resolvedView = $derived(view ?? $editorView);
const resolvedAnnotations = $derived(annotationsData ?? $annotations);
const resolvedActiveAnnotation = $derived(
    activeAnnotationData === undefined ? $activeAnnotation : activeAnnotationData,
);
const isFloating = $derived(layout === "floating");

/**
 * The layout actually in effect. The two-column layouts (visual-split,
 * by-type) only make sense when the left side of the page is free —
 * which is exactly when AI is disabled, since the AI sidebar renders on
 * the left whenever `aiEnabled` is true. With AI on, always fall back to
 * the single right column so the left column never fights the sidebar.
 */
const effectiveLayout = $derived(appSettings.aiEnabled ? "single" : appSettings.annotationLayout);

/**
 * True when the viewport is too narrow to show floating annotation
 * cards beside the document. In this mode, clicking an annotation
 * decoration opens a modal instead of the floating card.
 */
// Minimum gap kept between the left annotation column and the window edge.
const LEFT_MARGIN = 16;
let narrowMode = $state(false);
// True when a left column would fit on-screen (only checked for two-column
// layouts). When false we fall back to the single right column.
let leftColumnFits = $state(false);

$effect(() => {
    void resolvedView; // re-run when the view becomes available
    function checkWidth() {
        if (!resolvedView) return;
        narrowMode = window.innerWidth - getAnnotationLeft() - 32 < MIN_ANNOTATION_COLUMN_WIDTH;
        leftColumnFits = getAnnotationLeftColumnX() >= LEFT_MARGIN;
    }
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
});

/**
 * The concrete render mode, resolving the requested layout against the
 * available space:
 *   "modal"      — too narrow even for the single right column; clicking
 *                  an annotation opens a modal (handled elsewhere).
 *   "single"     — one right column.
 *   "two-column" — left + right columns.
 * Precedence: narrowMode wins (modal); then a two-column request that
 * can't fit its left column degrades to single; otherwise honor the
 * effective layout.
 */
const renderMode = $derived(
    !isFloating
        ? "single"
        : narrowMode
          ? "modal"
          : effectiveLayout !== "single" && leftColumnFits
            ? "two-column"
            : "single",
);
const isTwoColumn = $derived(renderMode === "two-column");

/**
 * In narrow mode, when an annotation becomes active (cursor moved into
 * its range), auto-open the appropriate modal. Once dismissed, don't
 * reopen until the cursor leaves and re-enters the annotation range.
 */
let lastNarrowModalId: number | undefined;
$effect(() => {
    if (!isFloating || !narrowMode) return;
    const active = resolvedActiveAnnotation;
    // Reset when cursor leaves all annotations
    if (!active) {
        lastNarrowModalId = undefined;
        return;
    }
    // Reset when cursor moves to a different annotation
    if (lastNarrowModalId !== undefined && active.id !== lastNarrowModalId) {
        lastNarrowModalId = undefined;
    }
    if (!resolvedView || active.id === lastNarrowModalId) return;
    lastNarrowModalId = active.id;
    if (isAnnotationOfType(active, "comment")) {
        modalStack.push({
            type: "comment",
            commentId: active.id,
            parentView: resolvedView,
            label:
                resolvedView.state
                    .sliceDoc(active.selection.main.from, active.selection.main.to)
                    .slice(0, 40) || "Comment",
        });
    } else if (isAnnotationOfType(active, "revision")) {
        modalStack.push({
            type: "revision",
            revisionId: active.id,
            parentView: resolvedView,
            label: "Revision",
        });
    } else if (isAnnotationOfType(active, "suggestion")) {
        modalStack.push({
            type: "diff",
            suggestionId: active.id,
            parentView: resolvedView,
            label: "AI Suggestion",
        });
    }
});

/**
 * Remove an annotation by its ID from the CodeMirror state.
 */
function remove(index: number) {
    if (!resolvedView) return;
    const annotation = resolvedView.state.field(annotationField)[index];
    if (!annotation) return;
    resolvedView.dispatch(
        resolvedView.state.update({
            effects: [removeAnnotation.of(annotation)],
        }),
    );
}

/**
 * Replace the thread of a given annotation via the CodeMirror
 * updateThread effect.
 */
function dispatchUpdateThread(annotationId: number, newThread: Thread) {
    if (!resolvedView) return;
    resolvedView.dispatch(
        resolvedView.state.update({
            effects: [
                updateThread.of({
                    annotationId,
                    newThread,
                }),
            ],
        }),
    );
}

/**
 * Check whether a click/key event target is an interactive
 * element (button, input, etc.) so that the card-level click
 * handler can avoid stealing focus.
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest("button, input, textarea, select, a[href], [contenteditable='true']");
}

function activateAnnotation(annotation: GenericAnnotation): void {
    if (!resolvedView) return;
    resolvedView.dispatch({
        selection: { anchor: annotation.selection.main.from },
        scrollIntoView: true,
    });
    resolvedView.focus();
}

/**
 * Map an annotation to its viewport Y coordinate by looking
 * up the screen position of the annotation's start offset.
 */
function getAnnotationViewportY(annotation: GenericAnnotation): number {
    if (!resolvedView) return 0;
    try {
        const coords = resolvedView.coordsAtPos(annotation.selection.main.from);
        if (!coords) return 0;
        return coords.top - 10;
    } catch {
        return 0;
    }
}

/**
 * Compute the left pixel offset for the floating annotation
 * column, positioned to the right of the editor document.
 *
 * The editor content is centered with a max width of 816px, so its
 * half-width is 408px; the column starts 16px past the content edge.
 */
function getAnnotationLeft(): number {
    if (!resolvedView) return 0;
    const rect = resolvedView.scrollDOM.getBoundingClientRect();
    return rect.left + rect.width / 2 + 408 + 16;
}

/** Current annotation panel width, clamped to its allowed range. */
function getPanelWidth(): number {
    return Math.min(
        ANNOTATION_PANEL_MAX_WIDTH,
        Math.max(ANNOTATION_PANEL_MIN_WIDTH, appSettings.annotationPanelWidth),
    );
}

/**
 * Compute the left pixel offset for a LEFT annotation column, mirrored
 * across the editor center from the right column. Returns the X of the
 * column's left edge; its right edge sits 16px from the content's left
 * edge. May be negative on narrow windows — callers gate on
 * `leftColumnFits` (see checkWidth) before using a two-column layout.
 */
function getAnnotationLeftColumnX(): number {
    if (!resolvedView) return 0;
    const rect = resolvedView.scrollDOM.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    return center - 408 - 16 - getPanelWidth();
}

// The right column container (also the only container in single-column
// mode) and the optional left column container used in two-column mode.
let scrollContainer = $state<HTMLDivElement | undefined>(undefined);
let scrollContainerLeft = $state<HTMLDivElement | undefined>(undefined);
let resizingPanel = $state(false);

// Per-card column assignment ("left" | "right") used in two-column mode.
// Computed inside updateAnnotationPositions (NOT $derived — it calls
// coordsAtPos, which can trigger a measure cycle that writes to stores).
// The template reads this to decide which column renders each card.
let cardSide = $state<{ [id: number]: ColumnSide }>({});

// Sort annotations by document position for stable rendering
const sortedAnnotations = $derived(
    resolvedAnnotations
        ? Object.values(resolvedAnnotations).sort(
              (a, b) => a.selection.main.from - b.selection.main.from,
          )
        : [],
);

const trimmedSelection = $derived($selectedText.trim());
const hasSelection = $derived(trimmedSelection.length > 0);
const isSingleWordSelection = $derived(
    hasSelection && !/\s/.test(trimmedSelection) && trimmedSelection.length <= 60,
);
// When showAiSuggestions is off, hide suggestion cards unless active (clicked)
const visibleAnnotations = $derived(
    appSettings.showAiSuggestions
        ? sortedAnnotations
        : sortedAnnotations.filter(
              (a) => !isAnnotationOfType(a, "suggestion") || resolvedActiveAnnotation?.id === a.id,
          ),
);

const hasComments = $derived(sortedAnnotations.some((a) => isAnnotationOfType(a, "comment")));
const hasRevisions = $derived(sortedAnnotations.some((a) => isAnnotationOfType(a, "revision")));

// selectionY is computed via $effect instead of $derived because
// coordsAtPos can trigger a CodeMirror measure cycle that fires
// the updateListener → store write, which is forbidden inside $derived.
let selectionY = $state<number | null>(null);
$effect(() => {
    void $selectedText; // re-run when selection changes
    if (!resolvedView || !hasSelection) {
        selectionY = null;
        return;
    }
    const sel = resolvedView.state.selection.main;
    try {
        const from = resolvedView.coordsAtPos(sel.from);
        const to = resolvedView.coordsAtPos(sel.to);
        if (!from || !to) {
            selectionY = null;
            return;
        }
        selectionY = (from.top + to.bottom) / 2;
    } catch {
        selectionY = null;
    }
});
const pendingComment = $derived(
    sortedAnnotations.find(
        (annotation) =>
            isAnnotationOfType(annotation, "comment") && annotation.status === "pending",
    ),
);

// Compute positioned annotations on demand (NOT in $derived —
// coordsAtPos can trigger a CodeMirror measure cycle that fires
// the updateListener, which writes to Svelte stores. Writing to
// $state inside $derived throws state_unsafe_mutation.)
type Positioned = { annotation: GenericAnnotation; viewportY: number };

function getPositionedAnnotations(): Positioned[] {
    if (!sortedAnnotations.length || !resolvedView || !isFloating) return [];
    return sortedAnnotations.map((annotation) => ({
        annotation,
        viewportY: getAnnotationViewportY(annotation),
    }));
}

/** Measured height of a card, with the same 80px fallback the layout uses. */
function getCardHeight(id: number): number {
    return annotationColumnDom.getCardHeight(id);
}

// Last-known *collapsed* (inactive) height per card. Cards grow when active
// (Comment/Revision/Suggestion expand their thread), and feeding that
// expanded height into balanceColumns would shift the greedy packing and
// flip later cards' columns on every click. We balance on the collapsed
// height instead, so column assignment is activation-invariant: a card only
// updates its cached height while it is NOT the active one.
const collapsedCardHeight: { [id: number]: number } = {};

/**
 * Height to use when balancing columns. Uses the cached collapsed height so
 * the active card's expansion never perturbs the assignment. Records the
 * live height only for inactive cards (their current height IS collapsed).
 */
function getBalanceHeight(id: number): number {
    const isActive = resolvedActiveAnnotation?.id === id;
    if (!isActive) {
        const h = getCardHeight(id);
        collapsedCardHeight[id] = h;
        return h;
    }
    return collapsedCardHeight[id] ?? 80;
}

/**
 * Horizontal viewport X of an annotation's start, used as a tie-breaker
 * when balancing columns. Falls back to the editor center on failure so
 * the proximity bias is neutral rather than wrong.
 */
function getAnnotationViewportX(annotation: GenericAnnotation): number {
    if (!resolvedView) return window.innerWidth / 2;
    try {
        const coords = resolvedView.coordsAtPos(annotation.selection.main.from);
        if (!coords) return window.innerWidth / 2;
        return coords.left;
    } catch {
        return window.innerWidth / 2;
    }
}

// Memoized visual-split assignment plus the id-set signature it was computed
// for. The balance is recomputed ONLY when the set of annotations changes
// (add/remove); clicking, activating, or resizing reuses the cached map so
// cards never jump columns just because the active card expanded. Combined
// with getBalanceHeight (collapsed heights), assignment is fully
// activation-invariant. balanceColumns itself lives in annotationLayout.ts.
let balancedSides: { [id: number]: ColumnSide } = {};
let balancedSignature = "";

/**
 * Decide each card's column for the current render mode. Returns the new
 * side map. Pure relative to the DOM read of card heights / coords.
 */
function computeCardSides(positions: Positioned[]): { [id: number]: ColumnSide } {
    if (renderMode !== "two-column") {
        // Single / modal: everything nominally on the right.
        const side: { [id: number]: ColumnSide } = {};
        for (const { annotation } of positions) side[annotation.id] = "right";
        return side;
    }
    if (effectiveLayout === "by-type") {
        const side: { [id: number]: ColumnSide } = {};
        for (const { annotation } of positions) {
            side[annotation.id] = isAnnotationOfType(annotation, "comment") ? "left" : "right";
        }
        return side;
    }
    // visual-split: only rebalance when the annotation set changes, so an
    // active card growing taller can't flip later cards between columns.
    const signature = idSignature(positions.map((p) => p.annotation.id));
    if (signature === balancedSignature) return balancedSides;

    const center = resolvedView
        ? (() => {
              const rect = resolvedView.scrollDOM.getBoundingClientRect();
              return rect.left + rect.width / 2;
          })()
        : window.innerWidth / 2;
    balancedSides = balanceColumns(
        positions.map(({ annotation, viewportY }) => ({
            id: annotation.id,
            viewportY,
            height: getBalanceHeight(annotation.id),
            viewportX: getAnnotationViewportX(annotation),
        })),
        center,
    );
    balancedSignature = signature;
    return balancedSides;
}

let annotationElementsVersion = $state(0);
const annotationColumnDom = new AnnotationColumnDomController<number>(updateAnnotationPositions);

const annotationElement: Action<HTMLDivElement, number> = (node, id) => {
    const mounted = annotationColumnDom.mountCard(node, id);
    annotationElementsVersion++;
    return {
        update(nextId) {
            mounted.update(nextId);
            annotationElementsVersion++;
        },
        destroy() {
            mounted.destroy();
            annotationElementsVersion++;
        },
    };
};

// Reposition cards when the active annotation or list changes
$effect(() => {
    if (!isFloating) return;
    if (resolvedActiveAnnotation !== undefined || sortedAnnotations.length) {
        tick().then(updateAnnotationPositions);
    }
});

$effect(() => {
    if (!isFloating) return;
    void appSettings.annotationPanelWidth;
    // Re-run when the layout mode flips (settings change, AI toggled, or a
    // resize crossing the two-column fit threshold) so the new column set
    // is laid out after the template mounts/unmounts containers.
    void renderMode;
    tick().then(updateAnnotationPositions);
});

// Re-run positioning whenever any card changes height
// (e.g. nested editor toggle). Re-observes whenever the
// annotation list changes.
$effect(() => {
    if (!isFloating) return;
    void sortedAnnotations; // track additions/removals
    void annotationElementsVersion; // re-observe when elements register
    tick().then(() => annotationColumnDom.observeCards());
});

function debouncedUpdatePositions() {
    annotationColumnDom.schedule();
}

// A single floating column to lay out. The right column (or the only
// column in single mode) and, in two-column mode, the left column.
type Column = {
    side: "left" | "right";
    leftPx: number;
    cards: Positioned[];
    el: HTMLDivElement | undefined;
};

/**
 * Top-level layout pass. Computes each card's column for the current
 * render mode, then lays out each column independently. The card-side
 * assignment is stored in `cardSide` ($state) so the template renders
 * each card into the matching column; we only write it when it actually
 * changes to avoid an effect loop (the write would re-trigger the
 * positioning effect).
 */
function updateAnnotationPositions() {
    if (!resolvedView || !isFloating) return;

    const positions = getPositionedAnnotations();

    // Resolve each card's column and publish it for the template.
    const sides = computeCardSides(positions);
    if (!sidesEqual(sides, cardSide)) cardSide = sides;

    if (renderMode === "two-column") {
        const left: Positioned[] = [];
        const right: Positioned[] = [];
        for (const p of positions) {
            (cardSide[p.annotation.id] === "left" ? left : right).push(p);
        }
        layoutColumn({
            side: "left",
            leftPx: getAnnotationLeftColumnX(),
            cards: left,
            el: scrollContainerLeft,
        });
        layoutColumn({
            side: "right",
            leftPx: getAnnotationLeft(),
            cards: right,
            el: scrollContainer,
        });
    } else {
        // Single column: every card on the right (matches classic layout).
        layoutColumn({
            side: "right",
            leftPx: getAnnotationLeft(),
            cards: positions,
            el: scrollContainer,
        });
    }
}

/**
 * Lay out one floating column: measure card heights, run the pure
 * positioning algorithm (layoutColumnPositions in annotationLayout.ts),
 * then apply the results to the DOM. Operates purely on the column's own
 * card list / container, so each column keeps its own scrollTop, overhead,
 * and inner height.
 */
function layoutColumn(col: Column) {
    if (!resolvedView || !isFloating) return;

    const items = col.cards.map(({ annotation, viewportY }) => ({
        id: annotation.id,
        viewportY,
    }));
    // The active card anchors at its natural Y only if it lives in this column.
    const activeId =
        resolvedActiveAnnotation &&
        col.cards.some((p) => p.annotation.id === resolvedActiveAnnotation.id)
            ? resolvedActiveAnnotation.id
            : null;
    annotationColumnDom.apply({
        container: col.el,
        items,
        activeId,
        geometry: getColumnGeometry(col),
    });
}

/**
 * Resize the column's inner scroll container so it can hold all cards,
 * and position it at the correct horizontal offset. The container width
 * is the panel width, clamped so it never spills off the near edge of
 * the viewport (the right edge for the right column, the left edge for
 * the left column).
 */
function getColumnGeometry(col: Column): { left: number; width: number; topClamp: number } {
    const desiredWidth = getPanelWidth();
    let leftPx = col.leftPx;
    let availableWidth: number;
    if (col.side === "left") {
        // Don't let the column run off the left edge; shrink it if needed.
        leftPx = Math.max(LEFT_MARGIN, col.leftPx);
        availableWidth = Math.min(desiredWidth, Math.max(0, col.leftPx + desiredWidth - leftPx));
    } else {
        const RIGHT_MARGIN = 32;
        availableWidth = Math.min(
            desiredWidth,
            Math.max(0, window.innerWidth - leftPx - RIGHT_MARGIN),
        );
    }
    const occluders = [...document.querySelectorAll<HTMLElement>("[data-annotation-occluder]")]
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
    return {
        left: leftPx,
        width: availableWidth,
        topClamp: annotationTopClamp({ left: leftPx, right: leftPx + availableWidth }, occluders),
    };
}

// Drag gesture (pointer capture, window listeners, body style overrides,
// unmount cleanup) is the shared pointerDrag action — same as the AI
// sidebar's resize handles. Only the width semantics live here.
let panelDragStartWidth = 0;
const panelDragOptions: PointerDragOptions = {
    cursor: "ew-resize",
    onStart: () => {
        resizingPanel = true;
        panelDragStartWidth = appSettings.annotationPanelWidth;
    },
    onMove: (dx) => {
        appSettings.annotationPanelWidth = Math.min(
            ANNOTATION_PANEL_MAX_WIDTH,
            Math.max(ANNOTATION_PANEL_MIN_WIDTH, Math.round(panelDragStartWidth + dx)),
        );
    },
    onEnd: () => {
        resizingPanel = false;
        persistSettings();
    },
};

const isCustomPanelWidth = $derived(
    appSettings.annotationPanelWidth !== ANNOTATION_PANEL_DEFAULT_WIDTH,
);

function resetPanelWidth() {
    appSettings.annotationPanelWidth = ANNOTATION_PANEL_DEFAULT_WIDTH;
    persistSettings();
}

/**
 * Apply computed top positions to each card DOM element. Cards are
 * positioned relative to their (already placed) column container, so
 * left stays 0 within the column.
 */
// Track which pending card is currently showing the alert animation
let alertingPendingId: number | undefined = $state();

// React to pending-comment events: scroll the pending card into view,
// then play a shake + red-outline-fade animation on it. The alert only
// fires when canCreateNewComment() is false, so the pending comment card
// already exists in the DOM — no timing workaround needed.
$effect(() => {
    return annotationEventBus.on("pending-comment-alert", () => {
        if (!isFloating || !pendingComment) return;

        const el = annotationColumnDom.getCardElement(pendingComment.id);
        if (!el) return;

        // Scroll the editor to show the pending comment's highlighted text
        if (resolvedView) {
            resolvedView.dispatch({
                selection: { anchor: pendingComment.selection.main.from },
                scrollIntoView: true,
            });
        }

        // Scroll the pending card into view
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });

        // Trigger shake animation via CSS. The animation-name reset
        // (removing then re-adding the class) ensures it replays on
        // repeated alerts. The animationend event cleans up — no
        // setTimeout needed.
        alertingPendingId = pendingComment.id;
        el.classList.remove("pending-shake");
        void el.offsetWidth; // force reflow to restart animation
        el.classList.add("pending-shake");
    });
});

$effect(() => {
    return annotationEventBus.on("overlapping-revision-alert", () => {
        // Annotations.svelte is mounted once per editor instance (including nested
        // editors), so the event bus fires this handler N times. Guard on isFloating
        // so only the top-level panel shows the toast — not every nested instance.
        if (!isFloating) return;
        toast.error("Overlapping revision regions are not supported.");
    });
});

// Annotation keyboard shortcuts:
//   ⌘/          — focus reply textarea (comment / suggestion / revision)
//   ⌘E          — enter revision editor (inline or modal)
$effect(() => {
    function onKeydown(e: KeyboardEvent) {
        if (!(e.metaKey || e.ctrlKey)) return;
        const active = resolvedActiveAnnotation;
        if (!active) return;

        if (e.key === "/" && !e.shiftKey) {
            e.preventDefault();
            annotationEventBus.emit({
                type: "annotation-focus-reply",
                annotationId: active.id,
            });
        } else if ((e.key === "e" || e.key === "E") && !e.shiftKey) {
            if (isAnnotationOfType(active, "revision")) {
                e.preventDefault();
                annotationEventBus.emit({
                    type: "annotation-enter-editor",
                    annotationId: active.id,
                });
            }
        }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
});

// Listen for editor scroll and window resize to reposition cards
$effect(() => {
    if (!isFloating || !resolvedView) return;
    annotationColumnDom.setEventTargets([resolvedView.scrollDOM]);
    window.addEventListener("resize", annotationColumnDom.schedule);
    return () => {
        annotationColumnDom.setEventTargets([]);
        window.removeEventListener("resize", annotationColumnDom.schedule);
    };
});

// Persistent chrome can appear or resize independently of editor state (for
// example auth reconnect controls or an expanded draft tree). Observe only
// explicitly marked occluders and schedule the same pure layout pass.
$effect(() => {
    if (!isFloating || typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(annotationColumnDom.schedule);
    let observed = new Set<Element>();
    const refresh = () => {
        const next = new Set(document.querySelectorAll("[data-annotation-occluder]"));
        if (next.size === observed.size && [...next].every((element) => observed.has(element))) {
            return;
        }
        resizeObserver.disconnect();
        for (const element of next) resizeObserver.observe(element);
        observed = next;
        annotationColumnDom.schedule();
    };
    const containsOccluder = (node: Node) =>
        node instanceof Element &&
        (node.matches("[data-annotation-occluder]") ||
            node.querySelector("[data-annotation-occluder]"));
    const mutationObserver = new MutationObserver((mutations) => {
        if (
            mutations.some((mutation) =>
                [...mutation.addedNodes, ...mutation.removedNodes].some(containsOccluder),
            )
        ) {
            refresh();
        }
    });

    refresh();
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    return () => {
        resizeObserver.disconnect();
        mutationObserver.disconnect();
    };
});

onDestroy(() => annotationColumnDom.destroy());
</script>

{#if sortedAnnotations && resolvedAnnotations !== undefined && resolvedView}
    {#if isFloating && !narrowMode && appSettings.showShortcutHints && hasSelection && selectionY !== null && !resolvedActiveAnnotation && (!hasComments || !hasRevisions || isSingleWordSelection)}
        {@const leftPx = getAnnotationLeft()}
        {@const hintsAtTop = hasComments || hasRevisions}
        <div
            class="fixed z-20 flex flex-col gap-2"
            style="{hintsAtTop ? 'left: 56px; top: 80px;' : `left: ${leftPx}px; top: ${selectionY}px; transform: translateY(-50%);`}"
        >
            {#if !hasComments}
                <div class="flex items-center gap-2 text-black/40">
                    <Kbd variant="large" keys={[mod, opt, "M"]} />
                    <span class="text-sm font-medium text-black/35">comment</span>
                </div>
            {/if}
            {#if !hasRevisions}
                <div class="flex items-center gap-2 text-black/40">
                    <Kbd variant="large" keys={[mod, opt, "K"]} />
                    <span class="text-sm font-medium text-black/35">revision</span>
                </div>
            {/if}
            {#if isSingleWordSelection}
                <div class="flex items-center gap-2 text-black/40">
                    <Kbd variant="large" keys={[mod, "D"]} />
                    <span class="text-sm font-medium text-black/35">dictionary</span>
                </div>
            {/if}
            <button
                type="button"
                class="mt-1 text-[11px] text-black/30 hover:text-black/50 transition-colors text-left cursor-pointer"
                onclick={() => {
                    appSettings.showShortcutHints = false;
                    persistSettings();
                    posthog.capture("shortcut_hints_hidden");
                }}
            >Hide hints</button>
        </div>
    {/if}
    {#snippet cardContent(c: GenericAnnotation, i: number, isActive: boolean, isPendingComment: boolean)}
        {#if isAnnotationOfType(c, "comment") && !isPendingComment}
            <Comment
                comment={c}
                view={resolvedView}
                {isActive}
                removeComment={remove.bind(null, i)}
                updateThread={dispatchUpdateThread.bind(null, i)}
            />
        {/if}
        {#if isAnnotationOfType(c, "comment") && isPendingComment}
            <PreComment
                view={resolvedView}
                annotationsData={resolvedAnnotations}
                pendingAnnotation={c}
                activeAnnotationData={resolvedActiveAnnotation}
            />
        {/if}
        {#if isAnnotationOfType(c, "revision")}
            <Revision
                revision={c}
                view={resolvedView}
                {isActive}
                updateThread={dispatchUpdateThread.bind(null, i)}
            />
        {/if}
        {#if isAnnotationOfType(c, "suggestion")}
            <Suggestion
                suggestion={c}
                view={resolvedView}
                {isActive}
                remove={remove.bind(null, i)}
                updateThread={dispatchUpdateThread.bind(null, i)}
            />
        {/if}
    {/snippet}

    {#snippet floatingCard(c: GenericAnnotation)}
        {@const i = c.id}
        {@const isActive = resolvedActiveAnnotation?.id === c.id}
        {@const isPendingComment = pendingComment?.id === c.id}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            use:annotationElement={i}
            class="annotation-card"
            class:is-active={isActive}
            style:z-index={isActive ? 120 : isPendingComment ? 110 : 50}
            style:transition={ANNOTATION_CARD_TOP_TRANSITION}
            onclick={(e) => {
                if (isInteractiveTarget(e.target)) return;
                if (!isActive) activateAnnotation(c);
            }}
            role="group"
            aria-label="Annotation card"
        >
            <button
                type="button"
                class="sr-only"
                aria-label="Focus annotation"
                onclick={() => activateAnnotation(c)}
            ></button>
            {@render cardContent(c, i, isActive, isPendingComment)}
            {#if alertingPendingId === c.id}
                <div
                    class="alert-ring rounded-[14px]"
                    onanimationend={() => { alertingPendingId = undefined; }}
                ></div>
            {/if}
        </div>
    {/snippet}

    {#if isFloating && renderMode === "two-column"}
        <!-- Left column: no resize handle (the right handle resizes both
             columns symmetrically via the shared panel width). -->
        <div class="annotation-scroll-container" bind:this={scrollContainerLeft}>
            <div class="annotation-scroll-inner">
                {#each visibleAnnotations as c (c.id)}
                    {#if cardSide[c.id] !== "right"}
                        {@render floatingCard(c)}
                    {/if}
                {/each}
            </div>
        </div>
    {/if}
    {#if isFloating && (renderMode === "two-column" || renderMode === "single")}
        <div class="annotation-scroll-container" bind:this={scrollContainer}>
            <div
                role="separator"
                aria-label="Resize annotations panel"
                aria-orientation="vertical"
                class="annotation-resize-handle"
                class:is-resizing={resizingPanel}
                use:pointerDrag={panelDragOptions}
            >
                {#if isCustomPanelWidth}
                    <button
                        onclick={resetPanelWidth}
                        onpointerdown={(e) => e.stopPropagation()}
                        aria-label="Reset to default width"
                        title="Reset width"
                        class="annotation-reset-btn"
                    >
                        <Minimize2 size={12} />
                    </button>
                {/if}
            </div>
            <div class="annotation-scroll-inner">
                {#each visibleAnnotations as c (c.id)}
                    {#if renderMode === "single" || cardSide[c.id] === "right"}
                        {@render floatingCard(c)}
                    {/if}
                {/each}
            </div>
        </div>
    {:else if !isFloating}
        <div class="annotation-inline-list">
            {#each visibleAnnotations as c (c.id)}
                {@const i = c.id}
                {@const isActive = resolvedActiveAnnotation?.id === c.id}
                {@const isPendingComment = pendingComment?.id === c.id}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div
                    use:annotationElement={i}
                    class="annotation-card-inline"
                    class:is-active={isActive}
                    onclick={(e) => {
                        if (isInteractiveTarget(e.target)) return;
                        if (!isActive) activateAnnotation(c);
                    }}
                    role="group"
                    aria-label="Annotation card"
                >
                    <button
                        type="button"
                        class="sr-only"
                        aria-label="Focus annotation"
                        onclick={() => activateAnnotation(c)}
                    ></button>
                    {@render cardContent(c, i, isActive, isPendingComment)}
                </div>
            {/each}
        </div>
    {/if}
{/if}

<style>
    .annotation-scroll-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 256px; /* overridden dynamically in updateScrollContainerSize */
        height: 100vh;
        overflow-y: auto;
        overflow-x: visible;
        overscroll-behavior: contain;
        pointer-events: none;
        z-index: 20;
        /* hide scrollbar visually but keep it functional */
        scrollbar-width: none;
    }

    .annotation-scroll-container::-webkit-scrollbar {
        display: none;
    }

    .annotation-resize-handle {
        position: absolute;
        top: 16px;
        bottom: 16px;
        right: -7px;
        width: 10px;
        cursor: ew-resize;
        pointer-events: auto;
        /* Stop touch drags on the handle from scrolling the page. */
        touch-action: none;
        z-index: 160;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }

    .annotation-resize-handle::after {
        content: "";
        position: absolute;
        top: 25%;
        bottom: 25%;
        right: 4px;
        width: 2px;
        border-radius: 9999px;
        background-color: rgba(0, 0, 0, 0.1);
        opacity: 0;
        transition:
            background-color 180ms ease,
            opacity 180ms ease;
    }

    .annotation-resize-handle:hover::after,
    .annotation-resize-handle.is-resizing::after {
        background-color: rgba(0, 0, 0, 0.2);
        opacity: 1;
    }

    .annotation-reset-btn {
        position: absolute;
        top: 50%;
        right: -4px;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 9999px;
        background: white;
        border: 1px solid rgba(0, 0, 0, 0.1);
        color: rgba(0, 0, 0, 0.35);
        cursor: pointer;
        opacity: 0;
        transition: opacity 180ms ease, color 180ms ease, background 180ms ease;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }

    .annotation-resize-handle:hover .annotation-reset-btn,
    .annotation-resize-handle.is-resizing .annotation-reset-btn {
        opacity: 1;
    }

    .annotation-reset-btn:hover {
        color: rgba(0, 0, 0, 0.6);
        background: rgba(0, 0, 0, 0.04);
    }

    .annotation-scroll-inner {
        position: relative;
        width: 100%;
        pointer-events: none;
    }

    .annotation-card {
        position: absolute;
        top: 64px;
        left: 0;
        width: 100%;
        pointer-events: auto;
    }

    .annotation-inline-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .annotation-card-inline {
        position: relative;
        width: 100%;
    }

    @keyframes pending-shake {
        0%   { transform: translateX(0); }
        10%  { transform: translateX(-6px); }
        20%  { transform: translateX(6px); }
        30%  { transform: translateX(-5px); }
        40%  { transform: translateX(5px); }
        50%  { transform: translateX(-3px); }
        60%  { transform: translateX(3px); }
        70%  { transform: translateX(-1px); }
        80%  { transform: translateX(1px); }
        100% { transform: translateX(0); }
    }

    :global(.annotation-card.pending-shake) {
        animation: pending-shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
    }

    /* Overlay div sits on top of the card content as a sibling,
       so it's never clipped by overflow-hidden on the inner card. */
    .alert-ring {
        position: absolute;
        inset: 0;
        pointer-events: none;
        animation: pending-ring-fade 1.4s ease-out both;
        /* ring-rose-400 = #fb7185, 3px, matches blue's chroma */
        box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.85);
    }

    @keyframes pending-ring-fade {
        0%   { box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.85); }
        70%  { box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.85); }
        100% { box-shadow: 0 0 0 3px rgba(251, 113, 133, 0); }
    }
</style>
