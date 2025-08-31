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
} from "@codemirror/state";
// All this plugin does is
// Highlight text and store which selections (including sub-selections)
// were highlighted. Users of this plugin can provide
// update handlers via Facets.
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type KeyBinding,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { isEqual } from "lodash-es";
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
  isEqual(update.startState, update.state) ||
  update.transactions.some((tr) =>
    tr.effects.some((e) => e.is(addAnnotation) || e.is(removeAnnotation)),
  );

const annotationDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.getDecorations(view, "comment", "cm-comment");
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
      const annotationRanges = view.state
        .field(annotationField)
        .filter((annotation) => isAnnotationOfType(annotation, type))
        // We can assume a single selection
        // because we are not implementing multi-selection support
        // for now
        .flatMap((annotation) => annotation.selection.main);
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

  let selection = editorSelection;
  if (editorSelection && targetText) {
    throw new Error("Cannot specify both targetText and editorSelection");
  }
  if (!editorSelection) {
    if (!targetText) {
      throw new Error(
        "Must specify at least either targetText or editorSelection",
      );
    }
    const query = new SearchCursor(state.doc, targetText);
    const selections = [...query].map(({ from: anchor, to: head }) =>
      EditorSelection.range(anchor, head),
    );
    selection = EditorSelection.create(selections);
  }
  view.dispatch(
    state.update({
      effects: [
        addAnnotation.of({
          ...createNewAnnotation(
            state.field(annotationField),
            selection as EditorSelection,
            "comment",
          ),
          thread: [{ message: comment, author, time: Date.now() }],
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

export const commentKeymap: KeyBinding[] = [
  {
    key: "Mod-Alt-m",
    run: createCommentCommand,
  },
  {
    key: "Mod-Alt-k",
    run: createRevisionCommand,
  },
];

// Extension
export const annotations = () => [
  annotationField,
  annotationDecorations,
  invertedAnnotationFieldEffects,
];
export * from "./models";
