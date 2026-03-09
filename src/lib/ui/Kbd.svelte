<!--
    Kbd.svelte — Consistent keyboard shortcut badge.

    Props:
      - variant: "default" | "blue" | "red" | "large"
        - default: dark text on white/80 bg (standard UI chrome)
        - blue:    white text on white/20 bg (inside blue buttons)
        - red:     red-tinted (inside red/danger buttons)
        - large:   same as default but with more padding (annotation hints)
-->
<script lang="ts">
interface Props {
    variant?: "default" | "blue" | "red" | "large";
}
const { variant = "default" }: Props = $props();

const classes: Record<string, string> = {
    default:
        "inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 text-[10px] font-mono bg-white/80 border border-black/15 shadow-sm rounded text-black/60 leading-none",
    blue: "inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 text-[10px] font-mono bg-white/20 border border-white/20 shadow-sm rounded text-white/70 leading-none",
    red: "inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 text-[10px] font-mono bg-red-50 border border-red-100 shadow-sm rounded text-red-400/80 leading-none",
    large: "inline-flex items-center justify-center min-w-[24px] h-[22px] px-2 text-xs font-mono bg-white/90 border border-black/12 shadow-sm rounded-md text-black/55 leading-none",
};
</script>

<kbd class={classes[variant]}><slot /></kbd>
