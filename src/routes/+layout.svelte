<!--
    +layout.svelte — Root layout wrapper.

    Imports the global Tailwind CSS stylesheet (app.css) and renders
    the child route via Svelte 5's `@render` snippet. Because the
    app is a single-route SPA (static adapter for Tauri), this
    layout wraps only +page.svelte.
-->
<script>
import "../app.css";
const { children } = $props();
</script>

{@render children()}
