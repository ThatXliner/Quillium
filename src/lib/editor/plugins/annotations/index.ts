// TODO: since we've refactored, now we can hone in on the issues
// but first let's make it based on the id

import { SearchCursor } from "@codemirror/search";
import {
  EditorSelection,
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
  annotationField,
  annotationDecorations,
  invertedAnnotationFieldEffects,
];
export * from "./models";
