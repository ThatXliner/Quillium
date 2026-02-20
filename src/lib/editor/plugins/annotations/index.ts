// TODO: since we've refactored, now we can hone in on the issues
// but first let's make it based on the id

import { SearchCursor } from "@codemirror/search";
import {
  EditorSelection,
  Prec,
  RangeSet,
  RangeSetBuilder,
  type SelectionRange,
  type StateCommand,
  Transaction,
  Text,
  EditorState,
} from "@codemirror/state";
// All this plugin does is
// Highlight text and store which selections (including sub-selections)
// were highlighted. Users of this plugin can provide
// update handlers via Facets.
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
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
  allowRevisionDocEdit,
  removeAnnotation,
  setActiveRevisionVersion,
  invertedAnnotationFieldEffects,
} from "./annotationField";

export * from "./annotationField";
export const annotationsChanged = (update: ViewUpdate) =>
  !isEqual(
    update.startState.field(annotationField),
    update.state.field(annotationField),
  ) ||
  update.transactions.some((tr) =>
    tr.effects.some((e) => e.is(addAnnotation) || e.is(removeAnnotation)),
  );

function hasRevisionIntersection(
  from: number,
  to: number,
  revisions: readonly SelectionRange[],
) {
  return revisions.some(
    ({ from: revisionFrom, to: revisionTo }) =>
      from < revisionTo && to > revisionFrom,
  );
}

function findRevisionAtBoundary(
  state: EditorState,
  position: number,
  direction: "backward" | "forward",
) {
  const annotations = Object.values(state.field(annotationField));
  return annotations.find((annotation) => {
    if (!isAnnotationOfType(annotation, "revision")) return false;
    const { from, to } = annotation.selection.main;
    if (from === to) return false;
    return direction === "backward" ? to === position : from === position;
  });
}

function deleteAdjacentRevision(
  direction: "backward" | "forward",
): StateCommand {
  return ({ state, dispatch }) => {
    const cursor = state.selection.main;
    if (!cursor.empty) return false;
    const target = findRevisionAtBoundary(state, cursor.from, direction);
    if (!target) return false;

    dispatch(
      state.update({
        changes: state.changes({
          from: target.selection.main.from,
          to: target.selection.main.to,
          insert: "",
        }),
        effects: [removeAnnotation.of(target)],
        annotations: [
          allowRevisionDocEdit.of(true),
          Transaction.addToHistory.of(true),
        ],
      }),
    );
    return true;
  };
}

const blockDirectRevisionEdits = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(allowRevisionDocEdit)) return tr;

  const revisionRanges = Object.values(tr.startState.field(annotationField))
    .filter((annotation) => isAnnotationOfType(annotation, "revision"))
    .map((annotation) => annotation.selection.main)
    .filter(({ from, to }) => from !== to);
  if (revisionRanges.length === 0) return tr;

  let blocked = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (blocked) return;
    if (hasRevisionIntersection(fromA, toA, revisionRanges)) {
      blocked = true;
    }
  });
  return blocked ? [] : tr;
});

const revisionAtomicRanges = ViewPlugin.fromClass(
  class {
    ranges: DecorationSet;

    constructor(view: EditorView) {
      this.ranges = this.buildRanges(view.state);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || annotationsChanged(update)) {
        this.ranges = this.buildRanges(update.state);
      }
    }

    buildRanges(state: EditorState): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const revisions = Object.values(state.field(annotationField)).filter(
        (annotation) => isAnnotationOfType(annotation, "revision"),
      );
      for (const revision of revisions) {
        const { from, to } = revision.selection.main;
        if (from === to) continue;
        builder.add(from, to, Decoration.mark({}));
      }
      return builder.finish();
    }
  },
  {
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.ranges ?? Decoration.none,
      ),
  },
);

// When a revision's text is fully deleted (range collapses to from===to),
// auto-switch to the next available version. If only one version exists,
// remove the revision entirely.
const collapsedRevisionResolver = ViewPlugin.fromClass(
    class {
        update(update: ViewUpdate) {
            if (!update.docChanged) return;
            if (
                update.transactions.some((tr) =>
                    tr.annotation(allowRevisionDocEdit),
                )
            )
                return;
            const annotations = update.state.field(annotationField);
            for (const annotation of Object.values(annotations)) {
                if (!isAnnotationOfType(annotation, "revision")) continue;
                const { from, to } = annotation.selection.main;
                if (from !== to) continue;
                // Revision range collapsed — all text was deleted
                if (annotation.versions.length <= 1) {
                    // Only one version, nothing to fall back to — remove it
                    update.view.dispatch({
                        effects: [removeAnnotation.of(annotation)],
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
  dispatch(
    state.update({
      effects: [
        addAnnotation.of({
          ...createNewAnnotation(
            state.field(annotationField),
            state.selection,
            "revision",
          ),
          currentlySelected: 0,
          versions: [
            state.sliceDoc(state.selection.main.from, state.selection.main.to),
          ],
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
    key: "Backspace",
    run: deleteAdjacentRevision("backward"),
  },
  {
    key: "Delete",
    run: deleteAdjacentRevision("forward"),
  },
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

// Extension
export const annotations = () => [
  Prec.high(keymap.of(annotationKeymap)),
  blockDirectRevisionEdits,
  annotationField,
  annotationDecorations,
  revisionAtomicRanges,
  collapsedRevisionResolver,
  invertedAnnotationFieldEffects,
];
export * from "./models";
