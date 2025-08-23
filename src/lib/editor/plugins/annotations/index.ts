// TODO: since we've refactored, now we can hone in on the issues
// but first let's make it based on the id
import { canCreateNewComment } from "$lib/stores";
import { invertedEffects } from "@codemirror/commands";
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

import { get } from "svelte/store";

import { isEqual } from "lodash-es";
import {
  type Annotation,
  type AnnotationType,
  type GenericAnnotation,
  createNewAnnotation,
  isAnnotationOfType,
} from "./models";
import { equalAnnotationsSignature, getActiveAnnotation } from "./utils";
import {
  annotationField,
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
} from "./annotationField";
export { annotationField };
export const annotationsChanged = (update: ViewUpdate) =>
  isEqual(update.startState, update.state) ||
  update.transactions.some((tr) =>
    tr.effects.some(
      (e) =>
        e.is(addAnnotation) || e.is(updateAnnotation) || e.is(removeAnnotation),
    ),
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
      const cursor = view.state.selection.main;
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
        console.log("Decor", from, to, type);
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
  if (!get(canCreateNewComment)) {
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

// The user now wants to the revision of version `to`.
// So we will update the editor view state to do that
// we don't manage currentlySelected/couple it in the
// state outside of CodeMirror because... idk
// Should I couple this with the updateAnnotation?
export function changeRevisionVersion({
  revision,
  to,
  view,
}: {
  revision: Annotation<"revision">;
  to: number;
  view: EditorView;
}) {
  const state = view.state;
  const original = state
    .field(annotationField)
    .find((x) =>
      equalAnnotationsSignature(x, revision),
    ) as Annotation<"revision">;
  console.assert(original.versions === revision.versions);
  console.log("changing", original.versions[to]);
  view.dispatch(
    state.update({
      effects: [
        updateAnnotation.of({
          ...revision,
          currentlySelected: to,
        }),
      ],
      changes: state.changes({
        from: original.selection.main.from,
        to: original.selection.main.to,
        insert: original.versions[to],
      }),
    }),
  );
  console.log("wtfff");
}

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
  // todo: revamp
  invertedEffects.of((transaction: Transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(addAnnotation)) {
        return [removeAnnotation.of(effect.value)];
      }
      if (effect.is(removeAnnotation)) {
        console.log("what we have here ", effect.value);
        return [addAnnotation.of(effect.value)];
      }
      // transaction.changes.iterChanges((fromA, toA) => {
      //   // if (transaction.state(annotationField))
      // });
      return [
        updateAnnotation.of(
          transaction.startState
            .field(annotationField)
            // very flawed
            .find((c) =>
              equalAnnotationsSignature(c, effect.value),
            ) as GenericAnnotation,
        ),
      ];
    }
    return [];
  }),
];
export type * from "./models";
