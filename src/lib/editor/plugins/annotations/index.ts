import { invertedEffects } from "@codemirror/commands";
import {
	EditorSelection,
	type EditorState,
	RangeSetBuilder,
	type SelectionRange,
	type StateCommand,
	StateEffect,
	StateField,
	type Transaction,
} from "@codemirror/state";
// All this plugin does is
// Highlight text and store which selections (including sub-selections)
// were highlighted. Users of this plugin can provide
// update handlers via Facets.
import type { ViewUpdate } from "@codemirror/view";
import isMatch from "lodash-es/isMatch";
// what about multiple authors and stuff???
export type Comment = { type: "comment"; thread: string[] };
export type Suggestion = { type: "suggestion"; text: string; thread: string[] };
export type Revision = {
	type: "revision";
	currentlySelected: number;
	versions: string[];
	thread: string[];
};
export type AnnotationTypes = Comment | Suggestion | Revision;
type AnnotationType = AnnotationTypes["type"];
export interface Annotation<Type extends AnnotationTypes = AnnotationTypes> {
	selection: EditorSelection;
	value: Type;
}
type RawAnnotation = {
	selection: EditorSelection["toJSON"];
	value: AnnotationTypes;
};
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

function cleanRangesOf(selection: EditorSelection) {
	const newRanges = selection.ranges.filter(
		(range) => range.from !== range.to,
	);
	return newRanges.length > 0
		? EditorSelection.create(newRanges, selection.mainIndex)
		: null;
}
// Equal type and selection
function equalAnnotationsType(a: Annotation, b: Annotation) {
	console.log(a, b);
	return a.selection.eq(b.selection) && a.value.type === b.value.type;
}
// StateField to track annotation data
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
					(c) =>
						!(
							equalAnnotationsType(c, e.value) &&
							isMatch(c, e.value)
						),
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
			.map((x) => ({
				...x,
				selection: cleanRangesOf(x.selection.map(tr.changes, 0)),
			}))
			.filter((x) => x.selection !== null) as Annotation[];

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
				e.is(addAnnotation) ||
				e.is(updateAnnotation) ||
				e.is(removeAnnotation),
		),
	);

function positionIntersects(position: number, selection: SelectionRange) {
	return selection.from <= position && position <= selection.to;
}
export function getActiveAnnotation(
	state: EditorState,
	type: AnnotationType = "comment",
) {
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
				(!cursor.empty
					? positionIntersects(cursor.anchor, range)
					: true)
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

// Extension
export const annotations = () => [
	annotationField,
	// todo: revamp
	invertedEffects.of((transaction: Transaction) => {
		for (const effect of transaction.effects) {
			if (effect.is(addAnnotation)) {
				return [removeAnnotation.of(effect.value)];
			}
			if (effect.is(removeAnnotation)) {
				return [addAnnotation.of(effect.value)];
			}
			return [
				updateAnnotation.of(
					transaction.startState
						.field(annotationField)
						.find((c) =>
							equalAnnotationsType(c, effect.value),
						) as Annotation,
				),
			];
		}
		return [];
	}),
];
