<script lang="ts">
    import { useCollegeEffects } from "$lib/college/state.svelte";

    let { onChange }: { onChange?: () => void } = $props();

    useCollegeEffects(() => onChange?.());
</script>

<div data-testid="college-effects-harness"></div>
