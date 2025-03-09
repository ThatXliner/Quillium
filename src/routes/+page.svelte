<script>
import Annotations from "$lib/editor/plugins/annotations/Annotations.svelte";
import Editor from "$lib/editor/Editor.svelte";
</script>

<div class="flex">
  <Editor />
  <Annotations />
</div>

<style>
  :global(html) {
    background-color: lightgray;
  }
</style>
