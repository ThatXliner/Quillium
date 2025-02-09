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

  // WPM tracking with adaptive smoothing
  // I don't think these need to be annotated with $state
  // because they're not being used in the UI
  let wordTimestamps: number[] = [];
  let lastUpdate = Date.now();
  let smoothedWPM = 0; // Holds the exponentially smoothed WPM

  function updateWPM() {
    const now = Date.now();
    // Remove keystrokes older than 60 seconds
    wordTimestamps = wordTimestamps.filter((t) => now - t < 60000);

    const elapsedSeconds = (now - (wordTimestamps[0] || now)) / 1000;
    const words = wordTimestamps.length;
    const rawWPM = elapsedSeconds > 0 ? words / (elapsedSeconds / 60) : 0;

    // Exponential moving average (smoothing factor α)
    const alpha = 0.3;
    smoothedWPM = alpha * rawWPM + (1 - alpha) * smoothedWPM;

    stats.wpm = smoothedWPM;
    lastUpdate = now;
  }

  function decayWPM() {
    if (Date.now() - lastUpdate > 2000) {
      // Idle for 2 seconds
      smoothedWPM *= 0.98; // Exponential decay
      stats.wpm = smoothedWPM;
    }
    if (smoothedWPM < 1 && smoothedWPM !== 0) {
      smoothedWPM = 0;
      wordTimestamps = [];
    }
    requestAnimationFrame(decayWPM);
  }
  requestAnimationFrame(decayWPM); // Start decay loop

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

      // Track keystrokes
      if (newWords > stats.words) {
        wordTimestamps.push(Date.now());
        updateWPM();
      }

      stats = {
        words: newWords,
        wpm: stats.wpm,
        chars: doc.length,
      };
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
