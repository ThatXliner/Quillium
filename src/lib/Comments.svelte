<script lang="ts">
  import { EditorSelection, SelectionRange } from "@codemirror/state";
  import type { Comment } from "./plugins/comments";
  import { canCreateNewComment } from "./stores";
</script>

<div>
  asdfas
  {#if !$canCreateNewComment}
    CREATING NEW COMENT
  {/if}
</div>
