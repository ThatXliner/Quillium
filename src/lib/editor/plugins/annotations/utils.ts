import { canCreateNewComment } from "$lib/stores";
import { SearchCursor } from "@codemirror/search";
import {
	EditorSelection,
	RangeSetBuilder,
	type SelectionRange,
	type StateCommand,
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
import { get } from "svelte/store";
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
		if (t === "comment" && annotation.value.thread.length === 0) return;
		if (t === "revision" && annotation.value.versions.length === 0) return;
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
