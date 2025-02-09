<script>
import Comments from "$lib/Comments.svelte";
import Editor from "../lib/Editor.svelte";
</script>

<div class="flex">
  <Editor />
  <Comments />
</div>

<style>
  :global(html) {
    background-color: lightgray;
  }
</style>
