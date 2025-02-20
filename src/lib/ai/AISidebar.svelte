<script lang="ts">
// or typescript enum?
type Action = null | "feedback" | "revise";
let action = $state<Action>(null);
async function provideFeedback() {
	action = "feedback";
}
async function reword() {}
</script>
<!-- actions -->
<div class="h-full flex justify-center">
    {#if action === null}
    <button onclick={provideFeedback}>Provide feedback</button>
    <button onclick={reword}>Revise/reword for ___ (flow? conciseness? both?)</button>
    <!-- Settings config for configuring
   - goals
  - essay prompt
 - tone, style
- preference of revision (word count? conciseness or for flow or both) -->
{:else if action === 'feedback'}
    <p>Loading...</p>
{/if}
</div>
