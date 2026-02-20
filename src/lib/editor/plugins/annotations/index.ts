// TODO: since we've refactored, now we can hone in on the issues
// but first let's make it based on the id

import { SearchCursor } from "@codemirror/search";
import {
  type ChangeSpec,
  EditorSelection,
  EditorState,
  RangeSet,
  RangeSetBuilder,
  type SelectionRange,
  type StateCommand,
  Transaction,
  Text,
} from "@codemirror/state";
// All this plugin does is
// Highlight text and store which selections (including sub-selections)
// were highlighted. Users of this plugin can provide
// update handlers via Facets.
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type KeyBinding,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { filter, flatMap, isEqual } from "lodash-es";
import {
  type AnnotationType,
  createNewAnnotation,
  isAnnotationOfType,
} from "./models";
import { canCreateNewComment, getActiveAnnotation } from "./utils";
import {
  annotationField,
  addAnnotation,
  removeAnnotation,
  setActiveRevisionVersion,
  invertedAnnotationFieldEffects,
} from "./annotationField";
import {
    revisionBoundaryDecorations,
    REVISION_DELIMITER,
} from "./revisionBoundary";

export * from "./annotationField";
export const annotationsChanged = (update: ViewUpdate) =>
  !isEqual(
    update.startState.field(annotationField),
    update.state.field(annotationField),
  ) ||
  update.transactions.some((tr) =>
    tr.effects.some((e) => e.is(addAnnotation) || e.is(removeAnnotation)),
  );

// When a revision's text is fully deleted (range collapses to from===to),
// auto-switch to the next available version. If only one version exists,
// remove the revision entirely.
const collapsedRevisionResolver = ViewPlugin.fromClass(
    class {
        update(update: ViewUpdate) {
            if (!update.docChanged) return;
            const annotations = update.state.field(annotationField);
            for (const annotation of Object.values(annotations)) {
                if (!isAnnotationOfType(annotation, "revision")) continue;
                const { from, to } = annotation.selection.main;
                if (to - from > 2) continue; // still has content between delimiters
                // Revision collapsed — all text between delimiters was deleted
                if (annotation.versions.length <= 1) {
                    // Only one version, nothing to fall back to — remove it + clean up delimiters
                    update.view.dispatch({
                        effects: [removeAnnotation.of(annotation)],
                        changes:
                            to - from === 2
                                ? [
                                      { from, to: from + 1 },
                                      { from: to - 1, to },
                                  ]
                                : [],
                    });
                } else {
                    // Switch to the next available version
                    const nextVersion =
                        annotation.currentlySelected > 0
                            ? annotation.currentlySelected - 1
                            : 1;
                    update.view.dispatch(
                        setActiveRevisionVersion(
                            update.state,
                            annotation.id,
                            nextVersion,
                        ),
                    );
                }
                return; // handle one at a time to avoid stale state
            }
        }
    },
);

const annotationDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = RangeSet.join([
        this.getDecorations(view, "comment", "cm-comment"),
        this.getDecorations(view, "revision", "cm-revision"),
        this.getDecorations(view, "suggestion", "cm-suggestion"),
      ]);
    }

    update(update: ViewUpdate) {
      // update.selectionSet also means "if cursor changed"
      if (
        update.selectionSet ||
        update.docChanged ||
        annotationsChanged(update)
      ) {
        this.decorations = RangeSet.join([
          this.getDecorations(update.view, "comment", "cm-comment"),
          this.getDecorations(update.view, "revision", "cm-revision"),
          this.getDecorations(update.view, "suggestion", "cm-suggestion"),
        ]);
      }
    }

    getDecorations(
      view: EditorView,
      type: AnnotationType,
      classPrefix: string,
    ): DecorationSet {
      // TODO: optimize algorithm to be linear time complexity
      // using some sort of greedy algorithm
      const builder = new RangeSetBuilder<Decoration>();
      const annotationRanges = flatMap(
        filter(Object.values(view.state.field(annotationField)), (annotation) =>
          isAnnotationOfType(annotation, type),
        ),
        // We can assume a single selection
        // because we are not implementing multi-selection support
        // for now
        (annotation) => annotation.selection.main,
      );
      // TODO: use multiple
      const activeRanges: readonly SelectionRange[] =
        getActiveAnnotation(view.state, type)?.selection?.ranges ?? [];
      // If you don't add annotations in order, the plugin will crash
      annotationRanges.sort((a, b) => a.from - b.from);

      // TODO: care about multiple selections
      const toHighlight = [
        ...annotationRanges.map((x) => ({
          active: false,
          x,
        })),
        ...activeRanges.map((x) => ({
          active: true,
          x,
        })),
      ].sort((a, b) => a.x.from - b.x.from);
      for (const {
        x: { from, to },
        active,
      } of toHighlight) {
        builder.add(
          from,
          to,
          Decoration.mark({
            class: active ? `${classPrefix}-active` : classPrefix,
            inclusive: true,
            // inclusive: type === "revision",
          }),
        );
      }
      return builder.finish();
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
function getSelection({
  editorSelection,
  targetText,
  document,
}: {
  editorSelection?: EditorSelection;
  targetText?: string;
  document: Text;
}) {
  let selection = editorSelection;
  if (editorSelection && targetText) {
    throw new Error("Cannot specify both targetText and editorSelection");
  }
  if (!selection) {
    if (!targetText) {
      throw new Error(
        "Must specify at least either targetText or editorSelection",
      );
    }
    const query = new SearchCursor(document, targetText);
    const selections = [...query].map(({ from: anchor, to: head }) =>
      EditorSelection.range(anchor, head),
    );
    selection = EditorSelection.create(selections);
  }
  return selection;
}
export function createComment({
  targetText,
  editorSelection,
  comment,
  author = "AI",
  view,
}: {
  targetText?: string;
  editorSelection?: EditorSelection;
  comment: string;
  author?: string;
  view: EditorView;
}) {
  const state = view.state;

  let selection = getSelection({
    editorSelection,
    targetText,
    document: state.doc,
  });
  view.dispatch(
    state.update({
      effects: [
        addAnnotation.of({
          ...createNewAnnotation(
            state.field(annotationField),
            selection,
            "comment",
          ),
          thread: [{ message: comment, author, time: Date.now() }],
        }),
      ],
      annotations: Transaction.addToHistory.of(true),
    }),
  );
}
export function createSuggestion({
  targetText,
  editorSelection,
  replacements,
  comment,
  author = "AI",
  // TODO: replace this with the simpler
  // view because this was originally being
  // mocked as a command
  dispatch,
  state,
}: {
  state: EditorState;
  dispatch: (transaction: Transaction) => void;
  replacements: string[];
  targetText?: string;
  editorSelection?: EditorSelection;
  author?: string;
  comment?: string;
}) {
  let selection = getSelection({
    editorSelection,
    targetText,
    document: state.doc,
  });
  dispatch(
    state.update({
      effects: [
        addAnnotation.of({
          ...createNewAnnotation(
            state.field(annotationField),
            selection,
            "suggestion",
          ),
          replacements,
          thread: comment
            ? [{ message: comment, author, time: Date.now() }]
            : [],
        }),
      ],
      annotations: Transaction.addToHistory.of(true),
    }),
  );
}

const createCommentCommand: StateCommand = ({ state, dispatch }) => {
  console.log("what");
  // locks it so that we can't have multiple pending states
  if (!canCreateNewComment(state.field(annotationField))) {
    return false;
  }
  // TODO: multi selection support
  if (state.selection.main.empty) return false;

  dispatch(
    state.update({
      effects: [
        addAnnotation.of(
          createNewAnnotation(
            state.field(annotationField),
            state.selection,
            "comment",
          ),
        ),
      ],
    }),
  );
  return true;
};
// QUESTION: Should we have some sort of global annotation mutex
const createRevisionCommand: StateCommand = ({ state, dispatch }) => {
  const from = state.selection.main.from;
  const to = state.selection.main.to;
  const originalText = state.sliceDoc(from, to);

  dispatch(
    state.update({
      changes: [
        { from, insert: REVISION_DELIMITER },
        { from: to, insert: REVISION_DELIMITER },
      ],
      effects: [
        addAnnotation.of({
          ...createNewAnnotation(
            state.field(annotationField),
            state.selection,
            "revision",
          ),
          currentlySelected: 0,
          versions: [originalText], // NO delimiters in stored version
        }),
      ],
    }),
  );
  return true;
};
const dev_dontuseinprod_createSuggestion: StateCommand = ({
  state,
  dispatch,
}) => {
  createSuggestion({
    editorSelection: state.selection,
    state,
    dispatch,
    replacements: ["ur mother"],
  });
  return true;
};
export const annotationKeymap: KeyBinding[] = [
  {
    key: "Mod-Alt-m",
    run: createCommentCommand,
  },
  {
    key: "Mod-Alt-k",
    run: createRevisionCommand,
  },
  {
    key: "Mod-b",
    run: dev_dontuseinprod_createSuggestion,
  },
];

// Prevent user edits from destroying revision delimiter characters.
// When a deletion/replacement overlaps a delimiter, shrink the range
// so the delimiter stays intact.
const revisionDelimiterGuard = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;

    // Skip internal dispatches (version switches, revision creation/
    // removal, etc.) — those intentionally modify delimiter regions.
    // User typing never carries effects, so this is a safe heuristic.
    if (tr.effects.length > 0) return tr;

    // Collect delimiter positions from revisions
    const delimiterPositions = new Set<number>();
    const revisions = tr.startState.field(annotationField);
    for (const annotation of Object.values(revisions)) {
        if (!isAnnotationOfType(annotation, "revision")) continue;
        const { from, to } = annotation.selection.main;
        if (to - from < 2) continue;
        delimiterPositions.add(from); // left delimiter
        delimiterPositions.add(to - 1); // right delimiter
    }

    if (delimiterPositions.size === 0) return tr;

    // Check if any changed range touches a delimiter
    let touchesDelimiter = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
        if (touchesDelimiter) return;
        for (let pos = fromA; pos < toA; pos++) {
            if (delimiterPositions.has(pos)) {
                touchesDelimiter = true;
                return;
            }
        }
    });

    if (!touchesDelimiter) return tr;

    // Rebuild changes, splitting each range into segments that
    // skip over delimiter positions.
    const newChanges: ChangeSpec[] = [];
    tr.changes.iterChanges(
        (fromA: number, toA: number, _fromB: number, _toB: number, inserted: Text) => {
            // Collect delimiter positions within this range, sorted
            const delimsInRange: number[] = [];
            for (let pos = fromA; pos < toA; pos++) {
                if (delimiterPositions.has(pos)) {
                    delimsInRange.push(pos);
                }
            }

            if (delimsInRange.length === 0) {
                // No delimiters in this range — pass through unchanged
                newChanges.push({ from: fromA, to: toA, insert: inserted });
                return;
            }

            // Split around delimiters: delete the non-delimiter segments,
            // attach inserted text to the first segment only.
            let segStart = fromA;
            let first = true;
            for (const dp of delimsInRange) {
                if (segStart < dp) {
                    newChanges.push({
                        from: segStart,
                        to: dp,
                        insert: first ? inserted : "",
                    });
                    first = false;
                }
                segStart = dp + 1; // skip the delimiter
            }
            // Remaining segment after the last delimiter
            if (segStart < toA) {
                newChanges.push({
                    from: segStart,
                    to: toA,
                    insert: first ? inserted : "",
                });
                first = false;
            }
            // If all segments were delimiters, still insert the text
            if (first && inserted.length > 0) {
                newChanges.push({
                    from: fromA,
                    to: fromA,
                    insert: inserted,
                });
            }
        },
    );

    return {
        changes: newChanges,
        effects: tr.effects,
        selection: tr.selection,
    };
});

// Extension
export const annotations = () => [
  annotationField,
  annotationDecorations,
  revisionBoundaryDecorations,
  collapsedRevisionResolver,
  revisionDelimiterGuard,
  invertedAnnotationFieldEffects,
];
export * from "./models";
