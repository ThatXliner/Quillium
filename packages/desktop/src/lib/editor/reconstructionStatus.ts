// reconstructionStatus.ts — Report recoverable load losses without changing recovery behavior.
import { Facet } from "@codemirror/state";
export const reconstructionFailure = Facet.define<() => void, (() => void) | undefined>({
    combine: (callbacks) => callbacks[0],
});
