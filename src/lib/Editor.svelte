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
  import StatusBar from "./StatusBar.svelte";

  let element: HTMLDivElement;
  let stats = $state<{
    words: number;
    wpm: number;
    chars: number;
  }>({
    words: 0,
    wpm: 0,
    chars: 0,
  });
  // I don't think these need to be annotated with $state
  // because they're not being used in the UI
  let firstRenderTime = Date.now();

  const getExtensionOptions: ListenerOptions = {
    updateListener(update: ViewUpdate) {
      const newComments = update.state.field(commentField);
      if (commentsChanged(update)) {
        $comments = newComments;
        $canCreateNewComment =
          $comments.length === 0 || $comments[$comments.length - 1].text !== "";
      }
      if (!update.startState.selection.eq(update.state.selection)) {
        $activeComment = getActiveComment(update.state);
      }

      const doc = update.state.doc.toString();
      const newWords = doc
        .trim()
        .split(/\s+/g)
        .filter((x) => x).length;

      stats = {
        words: newWords,
        wpm: newWords / ((Date.now() - firstRenderTime) / 1000 / 60),
        chars: doc.length,
      };
    },
  };

  const loop = () => {
    stats.wpm = stats.words / ((Date.now() - firstRenderTime) / 1000 / 60);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

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
    const doc = state.doc.toString();
    stats = {
      words: doc.split(" ").length,
      wpm: 0,
      chars: doc.length,
    };
    return state;
  });

  onMount(() => {
    // Must be inside onMount
    // since element may not be defined yet
    fromSave.then((state) => {
      $editorView = new EditorView({
        state,
        parent: element,
      });
    });
  });
</script>

<div class="w-full">
  <div class="sticky top-4"><StatusBar {...stats} /></div>

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
    letter-spacing: 0.05em;
    line-height: 1.5;
  }
  :global(.cm-content) {
    text-indent: 2em;
  }
</style>
