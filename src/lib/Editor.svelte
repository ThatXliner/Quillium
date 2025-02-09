<script lang="ts">
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { onMount } from "svelte";
  import { getExtensions, savedFields } from "./extensions";
  import { invoke } from "@tauri-apps/api/core";
  import {
    activeComment,
    canCreateNewComment,
    comments,
    editorView,
  } from "./stores";
  import "$lib/plugins/comments/default.css";
  import type { ListenerOptions } from "./plugins/listeners";
  import {
    commentField,
    commentsChanged,
    getActiveComment,
  } from "./plugins/comments";
  import type { ViewUpdate } from "@codemirror/view";

  // when using `"withGlobalTauri": true`, you may use
  // const { exists, BaseDirectory } = window.__TAURI__.fs;

  // Check if the `$APPDATA/avatar.png` file exists
  // await exists("avatar.png", { baseDir: BaseDirectory.AppData });
  // import {
  //     searchKeymap,
  //     highlightSelectionMatches,
  // } from "@codemirror/search";

  let element: HTMLDivElement;
  const getExtensionOptions: ListenerOptions = {
    updateListener(update: ViewUpdate) {
      const newComments = update.state.field(commentField);
      if (commentsChanged(update)) {
        $comments = newComments;
        $canCreateNewComment =
          $comments.length === 0 || $comments[$comments.length - 1].text !== "";
      }
      // OPTIMIZE: Probably needs to optimize
      if (!update.startState.selection.eq(update.state.selection)) {
        $activeComment = getActiveComment(update.state);
        console.log($activeComment);
      }
    },
  };
  let fromSave = invoke("load").then((data: string | null) => {
    let state: EditorState;
    if (data) {
      state = EditorState.fromJSON(
        JSON.parse(data),
        { extensions: getExtensions(getExtensionOptions) },
        savedFields
      );
      $comments = state.field(commentField);
      $canCreateNewComment =
        $comments.length === 0 || $comments[$comments.length - 1].text !== "";
    } else {
      state = EditorState.create({
        doc: "Hello World",
        extensions: getExtensions(getExtensionOptions),
      });
    }
    return state;
  });
  onMount(() => {
    fromSave.then((state) => {
      $editorView = new EditorView({
        state,
        parent: element,
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
