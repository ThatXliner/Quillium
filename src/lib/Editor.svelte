<script lang="ts">
  import { EditorState, StateEffect } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { onMount } from "svelte";
  import { getExtensions } from "./extensions";
  import { invoke } from "@tauri-apps/api/core";
  import { historyField } from "./plugins/history";
  import { canCreateNewComment, editorState } from "./stores";
  import "$lib/plugins/comments/default.css";
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
    if (data) {
      console.log("from data", data);
      $editorState = EditorState.fromJSON(
        JSON.parse(data),
        { extensions: getExtensions() },
        { historyField }
      );
    } else {
      $editorState = EditorState.create({
        doc: "Hello World",
        extensions: getExtensions(),
      });
    }
  });
  onMount(() => {
    fromSave.then((state) => {
      editorState.subscribe((state) => {
        let view = new EditorView({
          state,
          parent: element,
        });
      });
    });
  });
</script>

<div class="w-full">
  <!-- Stats (todo: rethink UI.. should it even be sticky in the first place?) -->
  <div class="sticky top-4">
    <div class="w-fit mx-auto justify-center p-5 backdrop-blur-md rounded-full">
      file saved Word count: . Characters. WPM, Average WPM graph
    </div>
  </div>

  {#await fromSave then}
    <div
      class="mx-auto w-[816px] z-[-1] h-[1056px] mt-12 bg-white rounded-lg shadow-xl py-3 px-1"
      bind:this={element}
    ></div>
  {/await}
</div>
<input type="checkbox" name="" id="" bind:checked={$canCreateNewComment} />

<style>
  :global(.cm-editor.cm-focused) {
    outline: none;
  }
  :global(.cm-content) {
    font-family:
      /* Garamond,
      Georgia, */
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
