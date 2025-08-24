// Ok so I know this looks like I'm really trying to not use classes
// but the reason why we're using this is because it needs to be JSON serializable
// If we can use classes but also JSON serializable, we should do that instead
// TODO yea I really want to make my own class
import type { EditorSelection } from "@codemirror/state";

// what about multiple authors and stuff???
export type ThreadMessage = { message: string; author: string; time: number };
export type Thread = ThreadMessage[];
export function isAnnotationOfType<T extends AnnotationType>(
	annotation: GenericAnnotation,
	type: T,
): annotation is Annotation<T> {
	return annotation._type === type;
}
type BaseAnnotation = {
	selection: EditorSelection;
	id: number;
	thread: Thread;
};
export function createNewAnnotation<T extends AnnotationType>(
	annotations: Annotations,
	selection: EditorSelection,
	type: T,
) {
	return {
		selection,
		id: annotations.length,
		_type: type,
		thread: [],
		// um this ain't getting serialized baby
		// sameTypeAs: (annotation: GenericAnnotation) => annotation._type === type,
	};
}
// DO NOT COMPARE _type; instead use isAnnotationOfType
type CommentAnnotation = BaseAnnotation & {
	_type: "comment";
};
// TODO: statuses for Revision and comment (might make it a FSM)
type SuggestionAnnotation = BaseAnnotation & {
	_type: "suggestion";
	replacement: string;
};
type RevisionAnnotation = BaseAnnotation & {
	_type: "revision";
	// this will now refer to an ID
	currentlySelected: number;
	versions: string[];
};
export type GenericAnnotation =
	| CommentAnnotation
	| SuggestionAnnotation
	| RevisionAnnotation;

export type Annotation<T extends GenericAnnotation["_type"]> = Extract<
	GenericAnnotation,
	{ _type: T }
>;

export type AnnotationType = GenericAnnotation["_type"];

export type RawAnnotation = GenericAnnotation & {
	selection: EditorSelection["toJSON"];
};
export type RawAnnotations = RawAnnotation[];
export type Annotations = GenericAnnotation[];
