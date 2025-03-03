<script>
import { generateText } from "ai";
import { SparklesIcon } from "lucide-svelte";

const props = $props();
</script>
<button class={props.class} onclick={()=>{
  generateText({

  })

}}>
  <SparklesIcon/>
</button>
