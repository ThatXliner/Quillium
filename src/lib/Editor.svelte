<script lang="ts">
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { onMount } from "svelte";
  import { getExtensions } from "./extensions";
  import { exists, BaseDirectory } from "@tauri-apps/plugin-fs";
  // when using `"withGlobalTauri": true`, you may use
  // const { exists, BaseDirectory } = window.__TAURI__.fs;

  // Check if the `$APPDATA/avatar.png` file exists
  // await exists("avatar.png", { baseDir: BaseDirectory.AppData });
  // import {
  //     searchKeymap,
  //     highlightSelectionMatches,
  // } from "@codemirror/search";

  let element: HTMLDivElement;
  let state = $state(
    EditorState.create({
      doc: "Hello World",
      extensions: getExtensions(),
    })
  );
  // const theme = EditorView.baseTheme({
  //     "&.cm-focused": { outline: "none" },
  //     "&": { "font-family": "Arial" },
  // });
  onMount(() => {
    // How the saving algorithm should work
    // (don't implement it yet as it doesnt really matter)
    // on a change, initiate a save
    // if there is already a save action in progress, mark it as cancelled
    // and/by queueing a new save
    //
    // in the save code, when atomic saving the file (writing to file first and then moving it)
    // and there's a cancellation, delete the temporary file and abort
    // and then use the newest queued action.
    // however, if there hasn't been a save in the past ___ seconds,
    // ignore the change in queue size and write to disk first, and then skip to the latest
    //
    // start autosave action when typing debounce (when we implement multiple documents lol)
    // but save cache on every single time history gets updated

    let view = new EditorView({
      state: state,
      parent: element,
    });
  });
</script>

<div
  class="mx-auto w-[816px] h-[1056px] mt-12 bg-white rounded-lg shadow-xl py-3"
  bind:this={element}
></div>

<style>
  :global(.cm-editor.cm-focused) {
    outline: none;
  }
  :global(.cm-content) {
    font-family:
      Arial,
      Helvetica,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      Roboto,
      Oxygen,
      Ubuntu,
      Cantarell,
      "Open Sans",
      "Helvetica Neue",
      sans-serif;
    letter-spacing: 0.05em; /* Adjust spacing between characters */
    line-height: 1.5; /* Improve vertical spacing */
  }
  :global(.cm-content) {
    text-indent: 2em;
  }
</style>
