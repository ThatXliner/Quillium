import { canCreateNewComment } from "$lib/stores";
import { invertedEffects } from "@codemirror/commands";
import { SearchCursor } from "@codemirror/search";
import {
  EditorSelection,
  type EditorState,
  RangeSet,
  RangeSetBuilder,
  type SelectionRange,
  type StateCommand,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
// All this plugin does is
// Highlight text and store which selections (including sub-selections)
// were highlighted. Users of this plugin can provide
// update handlers via Facets.
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
  type KeyBinding,
} from "@codemirror/view";
import isMatch from "lodash-es/isMatch";
import { get } from "svelte/store";
import type {
  Annotation,
  AnnotationType,
  AnnotationTypes,
  Comment,
  RawAnnotation,
  Revision,
} from "./models";
import {
  cleanRangesOf,
  equalAnnotationsType,
  positionIntersects,
  updateAnnotationsWithUpdatedText,
} from "./utils";

// TODO: def use IDs...
// XXX: No idea if this is the best way to do it
// Since I have my viewed contained elsewhere,
// a view plugin is not it.
// const annotationUpdateHandler = Facet.define<(annotations: Annotation[]) => void>();
// Effect to CRUD annotations, without the R
export const addAnnotation = StateEffect.define<Annotation>();
// todo: these may be changed
export const updateAnnotation = StateEffect.define<Annotation>();
// todo: these may be changed
export const removeAnnotation = StateEffect.define<Annotation>();

// StateField to track annotation data
// TODO: when a comment gets deleted by a deletion action, track that too so we can later undo it
export const annotationField = StateField.define<Annotation[]>({
  create(): Annotation[] {
    return [];
  },
  update(oldAnnotations: Annotation[], tr: Transaction): Annotation[] {
    let annotations = oldAnnotations;
    for (const e of tr.effects) {
      if (e.is(addAnnotation)) {
        // XXX: Not sure if this is the right attribute to use
        annotations = [...annotations, e.value];
      } else if (e.is(removeAnnotation)) {
        annotations = annotations.filter(
          (c) => !(equalAnnotationsType(c, e.value) && isMatch(c, e.value)),
        );
      } else if (e.is(updateAnnotation)) {
        annotations = annotations.map((c) =>
          equalAnnotationsType(c, e.value) ? e.value : c,
        );
      }
    }
    // Map our old annotations to the new state
    // ranges, as we don't want our annotations/highlighted portion
    // to be static markers of a row and column but instead change with te
    annotations = annotations
      .map((x) => {
        const newSelection = x.selection.map(
          tr.changes,
          x.value.type === "revision" ? 1 : 0,
        );
        console.log(newSelection, x.selection, tr.changes);
        // if (x.value.type === "revision") {
        // 	newSelection = newSelection.addRange(
        // 		newSelection.main.extend(
        // 			newSelection.main.from,
        // 			newSelection.main.to,
        // 		),
        // 	);
        // }
        return {
          ...x,
          selection: cleanRangesOf(newSelection),
        };
      })
      .filter((x) => x.selection !== null) as Annotation[];
    // TODO: run on every character update
    annotations = updateAnnotationsWithUpdatedText(tr.state, annotations);

    return annotations;
  },
  toJSON(value: Annotation[]) {
    return value.map((c) => ({
      selection: c.selection.toJSON(),
      // c.value should always be JSON-serializable
      value: c.value,
    }));
  },
  fromJSON(value: unknown) {
    return (value as RawAnnotation[]).map((x) => ({
      selection: EditorSelection.fromJSON(x.selection),
      value: x.value,
    })) as Annotation[];
  },
});

export const annotationsChanged = (update: ViewUpdate) =>
  update.startState.field(annotationField).every((val, idx) =>
    // OPTIMIZE: this may not be performant?
    // perhaps have a "last updated" field
    isMatch(val, update.state.field(annotationField)[idx]),
  ) ||
  update.transactions.some((tr) =>
    tr.effects.some(
      (e) =>
        e.is(addAnnotation) || e.is(updateAnnotation) || e.is(removeAnnotation),
    ),
  );

// function getActiveAnnotations(state: EditorState) {
// 	return (["comment", "revision"] as const).map(
// 		getActiveAnnotation.bind(null, state),
// 	);
// }
export function getActiveAnnotation<T extends AnnotationTypes = Comment>(
  state: EditorState,
  type: T["type"] = "comment",
): Annotation<T> {
  const cursor = state.selection.main;
  const cursorPos = cursor.head;
  const annotations = state.field(annotationField);
  const rangesWhereCursorIsInside: {
    range: SelectionRange;
    associatedAnnotation: Annotation;
  }[] = [];
  for (const annotation of annotations) {
    // todo: edit for comment only
    if (annotation.value.type !== type) continue;
    const t = annotation.value.type;
    if (t === "comment" && annotation.value.thread.length === 0)
      return annotation;
    if (t === "revision" && annotation.value.versions.length === 0)
      return annotation;
    // if (t === "suggestion" && annotation.value.text === "")
    // 	return;
    for (const range of annotation.selection.ranges)
      if (
        positionIntersects(cursorPos, range) &&
        // Having this extra condition makes it feel like Google docs
        // Basically what this is doing that if the cursor is a selection,
        // we only want to show the annotation if the entire selection is within
        // a single annotation
        (!cursor.empty ? positionIntersects(cursor.anchor, range) : true)
      ) {
        rangesWhereCursorIsInside.push({
          range,
          associatedAnnotation: annotation,
        });
      }
  }
  return rangesWhereCursorIsInside.sort(
    (a, b) => a.range.to - a.range.from - (b.range.to - b.range.from),
  )?.[0]?.associatedAnnotation;
}
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
        .filter((annotation) => annotation.value.type === type)
        // We can assume a single selection
        // because we are not implementing multi-selection support
        // for now
        .flatMap((annotation) => annotation.selection.main);

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
          selection: selection as EditorSelection,
          value: {
            type: "comment",
            thread: [{ message: comment, author, time: Date.now() }],
          },
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
        addAnnotation.of({
          selection: state.selection,
          value: { type: "comment", thread: [] },
        }),
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
          selection: state.selection,
          value: {
            type: "revision",
            currentlySelected: 0,
            versions: [
              state.sliceDoc(
                state.selection.main.from,
                state.selection.main.to,
              ),
            ],
            thread: [],
          },
        }),
      ],
    }),
  );
  return true;
};

export function changeRevisionVersion({
  // maybe use ID instead
  revision,
  to,
  view,
}: {
  revision: Annotation<Revision>;
  to: number;
  view: EditorView;
}) {
  const state = view.state;
  const original = state
    .field(annotationField)
    .find((x) => equalAnnotationsType(x, revision)) as Annotation<Revision>;
  console.assert(original.value.versions === revision.value.versions);
  console.log("changing", original.value.versions[to]);
  view.dispatch(
    state.update({
      effects: [
        updateAnnotation.of({
          selection: revision.selection,
          value: {
            ...revision.value,
            currentlySelected: to,
          },
        }),
      ],
      changes: state.changes({
        from: original.selection.main.from,
        to: original.selection.main.to,
        insert: original.value.versions[to],
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
            .find((c) => equalAnnotationsType(c, effect.value)) as Annotation,
        ),
      ];
    }
    return [];
  }),
];
export type * from "./models";
