<script lang="ts">
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { onMount } from "svelte";
  import { getExtensions } from "./extensions";
  import { invoke } from "@tauri-apps/api/core";
  import { historyField } from "./history";
  // when using `"withGlobalTauri": true`, you may use
  // const { exists, BaseDirectory } = window.__TAURI__.fs;

  // Check if the `$APPDATA/avatar.png` file exists
  // await exists("avatar.png", { baseDir: BaseDirectory.AppData });
  // import {
  //     searchKeymap,
  //     highlightSelectionMatches,
  // } from "@codemirror/search";

  let element: HTMLDivElement;
  let fromSave = invoke("load").then((data: string | null) => {
    let state: EditorState;
    if (data) {
      console.log("from data", data);
      state = EditorState.fromJSON(
        JSON.parse(data),
        { extensions: getExtensions() },
        { historyField }
      );
    } else {
      state = EditorState.create({
        doc: "Hello World",
        extensions: getExtensions(),
      });
    }
    return state;
  });
  onMount(() => {
    fromSave.then((state) => {
      let view = new EditorView({
        state,
        parent: element,
      });
    });
  });
</script>

{#await fromSave then}
  <div
    class="mx-auto w-[816px] h-[1056px] mt-12 bg-white rounded-lg shadow-xl py-3"
    bind:this={element}
  ></div>
{/await}

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
