<script lang="ts">
// PaperSculpture.svelte progressively enhances a paper illustration with WebGL.
import { Pause, Play } from "@lucide/svelte";
import { onMount } from "svelte";

let host: HTMLDivElement;
let ready = $state(false);
let paused = $state(false);
let failed = $state(false);
let reducedMotion = $state(false);
let scene: ReturnType<typeof import("./paperScene").createPaperScene> | undefined;

function toggleMotion(): void {
    paused = !paused;
    scene?.setPaused(paused);
}

onMount(() => {
    let disposed = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion = reduced.matches;
    paused = reduced.matches;
    const syncMotion = (): void => {
        reducedMotion = reduced.matches;
        paused = reduced.matches;
        scene?.setPaused(paused);
    };
    reduced.addEventListener("change", syncMotion);
    const handleContextLoss = (): void => {
        scene?.dispose();
        scene = undefined;
        ready = false;
        failed = true;
    };
    host.addEventListener("webglcontextlost", handleContextLoss, true);
    import("./paperScene")
        .then(({ createPaperScene }) => {
            if (disposed) return;
            try {
                scene = createPaperScene(host);
                scene.setPaused(paused);
                ready = true;
            } catch (error) {
                failed = true;
                console.warn("[PaperSculpture] Using static illustration", error);
            }
        })
        .catch(() => {
            failed = true;
        });
    return () => {
        disposed = true;
        reduced.removeEventListener("change", syncMotion);
        host.removeEventListener("webglcontextlost", handleContextLoss, true);
        scene?.dispose();
    };
});
</script>

<div class="sculpture">
  <div class="halo" aria-hidden="true"></div>
  <div class="fallback" class:hidden={ready} aria-hidden="true">
    {#each [0, 1, 2] as sheet}
      <div class="paper" style={`--sheet:${sheet}`}>
        <small>THE LIGHTHOUSE</small>
        <h3>A little further.</h3>
        <p>
          The lighthouse swept its beam across the water. On the other shore,
          someone was still awake.
        </p>
        <div class="rules"></div>
        <span>QUILLIUM / OMNI</span>
      </div>
    {/each}
  </div>
  <div
    class="canvas-host"
    bind:this={host}
    class:ready
    aria-hidden="true"
  ></div>
  {#if ready && !failed && !reducedMotion}
    <button
      class="motion-toggle"
      onclick={toggleMotion}
      aria-label={paused ? "Play animation" : "Pause animation"}
    >
      {#if paused}<Play size={12} />{:else}<Pause size={12} />{/if}
    </button>
  {/if}
</div>

<style>
  .sculpture {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 450px;
  }
  .canvas-host {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 900ms;
  }
  .canvas-host.ready {
    opacity: 1;
  }
  .canvas-host :global(canvas) {
    width: 100%;
    height: 100%;
    display: block;
  }
  .halo {
    position: absolute;
    inset: 15% 2%;
    border-radius: 50%;
    background: radial-gradient(
      ellipse,
      rgba(144, 169, 185, 0.15),
      transparent 68%
    );
  }
  .fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    transition: opacity 600ms;
  }
  .fallback.hidden {
    opacity: 0;
  }
  .paper {
    position: absolute;
    width: 230px;
    height: 310px;
    padding: 30px;
    background: #f6f0e4;
    color: #393a35;
    box-shadow: 0 22px 45px #302b2020;
    transform: translate(
        calc((var(--sheet) - 1) * 85px),
        calc((var(--sheet) - 1) * -35px)
      )
      rotate(calc((var(--sheet) - 1) * 19deg));
  }
  .paper small,
  .paper span {
    font-size: 7px;
    letter-spacing: 0.12em;
  }
  .paper h3 {
    font:
      italic 24px Georgia,
      serif;
    margin: 22px 0;
  }
  .paper p {
    font:
      12px/1.7 Georgia,
      serif;
  }
  .rules {
    height: 65px;
    margin: 18px 0;
    background: repeating-linear-gradient(transparent 0 9px, #c9c4b6 9px 10px);
  }

  .motion-toggle {
    position: absolute;
    bottom: 2%;
    right: 8%;
    display: flex;
    gap: 7px;
    align-items: center;
    border: 1px solid var(--border-strong);
    border-radius: 30px;
    padding: 12px;
    color: var(--text-soft);
    background: var(--bg);
    font-size: 10px;
    cursor: pointer;
  }
  .motion-toggle:hover {
    color: var(--text-strong);
  }
  .motion-toggle:focus-visible {
    outline: 2px solid var(--accent-blue);
    outline-offset: 4px;
  }
  @media (max-width: 700px) {
    .sculpture {
      min-height: 410px;
    }

    .motion-toggle {
      right: 4%;
      bottom: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .canvas-host,
    .fallback {
      transition: none;
    }
  }
</style>
