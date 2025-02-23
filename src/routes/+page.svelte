<script>
import Comments from "$lib/editor/plugins/comments/Comments.svelte";
import Editor from "$lib/editor/Editor.svelte";
import Save from "$lib/save/Save.svelte";
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
