<script>
import Comments from "$lib/editor/Comments.svelte";
import Editor from "$lib/editor/Editor.svelte";
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
