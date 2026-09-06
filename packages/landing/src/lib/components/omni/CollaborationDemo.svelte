<script lang="ts">
import { Pause, Play } from "@lucide/svelte";
// CollaborationDemo.svelte stages three Omni scenarios using desktop annotation cards.
import { CommentCard, RevisionCard } from "@quillium/share";
import { onMount } from "svelte";

const scenarios = [
    {
        label: "Live comments",
        caption: "Rena’s comment arrives beside the same words in your draft.",
    },
    {
        label: "Independent revisions",
        caption: "Try another version. Your editor’s view stays their own.",
    },
    {
        label: "Follow along",
        caption: "Follow your editor when you want to look at the same passage.",
    },
];
const duration = 9000;
let root: HTMLDivElement;
let tablist: HTMLDivElement;
let active = $state(0);
let elapsed = $state(0);
let playing = $state(true);
let reduced = $state(false);
let visible = false;
let frame = 0;
let last = 0;
let manualVersions = $state<(number | null)[]>([null, null]);
let manualFollow = $state<boolean | null>(null);
const phase = $derived(reduced ? 5000 : elapsed);
const following = $derived(manualFollow ?? (active === 2 && phase > 2300));

function version(person: number): number {
    return manualVersions[person] ?? (active === 1 && person === 0 && phase > 2400 ? 1 : 0);
}
function select(index: number): void {
    active = index;
    elapsed = 0;
    manualVersions = [null, null];
    manualFollow = null;
}
function keyboard(event: KeyboardEvent, index: number): void {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % scenarios.length;
    else if (event.key === "ArrowLeft") next = (index + scenarios.length - 1) % scenarios.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = scenarios.length - 1;
    else return;
    event.preventDefault();
    playing = false;
    select(next);
    tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
}
function chooseVersion(person: number, index: number): void {
    playing = false;
    manualVersions[person] = index;
}
function toggleFollow(): void {
    playing = false;
    manualFollow = !following;
    elapsed = Math.max(elapsed, 3600);
}

onMount(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = (): void => {
        reduced = media.matches;
        if (reduced) playing = false;
    };
    syncMotion();
    const animate = (now: number): void => {
        const delta = last ? now - last : 0;
        last = now;
        if (playing && !reduced) {
            elapsed += delta;
            if (elapsed >= duration) select((active + 1) % scenarios.length);
        }
        frame = requestAnimationFrame(animate);
    };
    const updateVisibility = (): void => {
        cancelAnimationFrame(frame);
        last = 0;
        if (visible && !document.hidden) frame = requestAnimationFrame(animate);
    };
    const observer = new IntersectionObserver(
        ([entry]) => {
            visible = entry.isIntersecting;
            updateVisibility();
        },
        { threshold: 0.2 },
    );
    observer.observe(root);
    media.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        media.removeEventListener("change", syncMotion);
        document.removeEventListener("visibilitychange", updateVisibility);
    };
});
</script>

<div class="collaboration-demo" bind:this={root}>
  <div class="scenario-controls">
    <div
      class="scenario-tabs"
      role="tablist"
      aria-label="Collaboration scenarios"
      bind:this={tablist}
    >
      {#each scenarios as scenario, index}
        <button
          type="button"
          role="tab"
          id={`scenario-tab-${index}`}
          aria-controls="collaboration-panel"
          aria-selected={active === index}
          tabindex={active === index ? 0 : -1}
          onclick={() => select(index)}
          onkeydown={(event) => keyboard(event, index)}
        >
          {scenario.label}
          <span class="progress-track" aria-hidden="true"
            ><span
              style:transform={`scaleX(${active === index ? (reduced ? 1 : elapsed / duration) : 0})`}
            ></span></span
          >
        </button>
      {/each}
    </div>
    {#if !reduced}
      <button
        type="button"
        class="playback"
        onclick={() => (playing = !playing)}
        aria-label={playing ? "Pause demo" : "Play demo"}
      >
        {#if playing}<Pause size={16} />{:else}<Play size={16} />{/if}
      </button>
    {/if}
  </div>
  <div
    id="collaboration-panel"
    role="tabpanel"
    aria-labelledby={`scenario-tab-${active}`}
    tabindex="0"
    class="demo-panel"
    onfocusin={() => (playing = false)}
  >
    {#each [0, 1] as person}
      {@const isYou = person === 0}
      {@const selected = version(person)}
      {@const showComment = active === 0 && phase > (isYou ? 2700 : 1200)}
      {@const scrolled =
        active === 2 && (isYou ? following && phase > 3400 : phase > 2900)}
      <div class="app-window" class:your-window={isYou}>
        <div class="window-title">
          <span class="window-dots" aria-hidden="true"
            ><i></i><i></i><i></i></span
          ><span>{isYou ? "You" : "Rena"}</span>
          {#if active === 2 && isYou}
            <button class="follow-control" onclick={toggleFollow}
              aria-label={following ? "Stop following Rena" : "Follow Rena"}
              aria-pressed={following}>{following ? "Following Rena" : "Follow Rena"}</button>
          {/if}
        </div>
        <div class="app-workspace">
          <div class="writing-area" class:follow-scene={active === 2}>
            <div class="document-viewport">
              <div class="document" class:scrolled>
                <p>
                  The lighthouse <span
                    class:revision-highlight={active === 1}
                    class:comment-highlight={showComment}
                    >{selected === 1 ? "swept its beam" : "cast its beam"}</span
                  > across the water, indifferent to the storm.
                </p>
                <p>
                  On the other shore, someone was still awake. She wondered if
                  they could see the same light from there.
                </p>
                <p>
                  Every night she left a letter by the window. Every morning,
                  the sea was a little closer.
                </p>
                <p class="last-passage">
                  Tonight, a light answered.<span
                    class:remote-cursor={active === 2 && scrolled}
                    aria-hidden="true"
                  ></span>
                </p>
              </div>
            </div>
            {#if active !== 2}
              <div class="annotation-column">
                {#if active === 0}
                  <div
                    class="arriving-comment"
                    class:arrived={showComment}
                    inert={!showComment}
                  >
                    <CommentCard active={true} selectedText="cast its beam">
                      {#snippet thread()}
                        <div class="thread">
                          <span class="thread-avatar">R</span>
                          <div>
                            <strong>Rena <small>just now</small></strong>
                            <p>Could we try “swept” here?</p>
                          </div>
                        </div>
                      {/snippet}
                    </CommentCard>
                  </div>
                {:else}
                  <RevisionCard
                    revisionId={`demo-${person}`}
                    active={true}
                    versions={[
                      {
                        id: "original",
                        index: 0,
                        label: "Original",
                        text: "cast its beam",
                        active: selected === 0,
                      },
                      {
                        id: "swept",
                        index: 1,
                        label: "Swept",
                        text: "swept its beam",
                        active: selected === 1,
                      },
                    ]}
                    onSelectVersion={(item) =>
                      chooseVersion(person, item.index)}
                  >
                    {#snippet editor()}<div class="revision-editor">
                        {selected === 1 ? "swept its beam" : "cast its beam"}
                      </div>{/snippet}
                  </RevisionCard>
                {/if}
              </div>
            {/if}
          </div>

        </div>
      </div>
    {/each}
  </div>
  <p class="scenario-caption">{scenarios[active].caption}</p>
</div>

<style>
  .collaboration-demo {
    width: 100%;
  }
  .scenario-controls {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 24px;
  }
  .scenario-tabs {
    display: flex;
    flex: 1;
    gap: 28px;
  }
  .scenario-tabs > button {
    position: relative;
    flex: 1;
    padding: 14px 0;
    text-align: left;
    color: var(--text-soft);
    font-size: 14px;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .scenario-tabs > button[aria-selected="true"] {
    color: var(--text-strong);
  }
  .progress-track {
    position: absolute;
    height: 2px;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--border-strong);
    overflow: hidden;
  }
  .progress-track > span {
    display: block;
    height: 100%;
    background: var(--accent-blue);
    transform-origin: left;
  }
  .playback {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    color: var(--text-soft);
    background: transparent;
    cursor: pointer;
  }
  button:focus-visible,
  .demo-panel:focus-visible {
    outline: 2px solid var(--accent-blue);
    outline-offset: 4px;
  }
  .demo-panel {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .app-window {
    min-width: 0;
    overflow: hidden;
    border-radius: 12px;
    box-shadow: 0 16px 40px rgba(var(--shadow-color), 0.1);
    border: 1px solid #cfd2d7;
    color-scheme: light;
    color: #24272c;
  }
  .window-title {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 35px;
    background: #f0f1f3;
    border-bottom: 1px solid #d5d8dd;
    font-size: 11px;
    font-weight: 500;
    position: relative;
  }
  .follow-control {
    position: absolute;
    right: 10px;
    border: 0;
    background: transparent;
    color: #245b9e;
    font-size: 10px;
    cursor: pointer;
  }
  .follow-control[aria-pressed="true"] { font-weight: 600; }
  .window-dots {
    display: flex;
    gap: 5px;
    position: absolute;
    left: 12px;
  }
  .window-dots i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #c4c7cd;
  }
  .app-workspace {
    background: #e5e7eb;
    padding: 18px 12px 12px;
  }
  .writing-area {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 12px;
    height: 324px;
  }
  .document-viewport {
    background: white;
    border-radius: 5px;
    box-shadow: 0 8px 15px #0000000d;
    overflow: hidden;
  }
  .document {
    padding: 18px 14px 36px;
    transition: transform 1200ms cubic-bezier(0.3, 0, 0.2, 1);
  }
  .document p {
    font:
      14px/1.65 Georgia,
      serif;
    color: #141414;
    text-indent: 1.5em;
    margin: 0 0 24px;
  }
  .document .last-passage {
    margin-top: 35px;
  }
  .revision-highlight {
    background: #dbc3fb;
    border-bottom: 1px solid #a855f7;
  }
  .comment-highlight {
    background: #fef2cd;
  }
  .annotation-column {
    padding-top: 25px;
    min-width: 0;
  }
  .arriving-comment {
    opacity: 0;
    transform: translateY(12px);
    transition:
      opacity 500ms,
      transform 500ms;
  }
  .arriving-comment.arrived {
    opacity: 1;
    transform: none;
  }
  .thread {
    display: flex;
    gap: 7px;
    font-family: Inter, sans-serif;
  }
  .thread-avatar {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    background: #fff9;
    border-radius: 50%;
    font-size: 9px;
    box-shadow: 0 2px 4px #00000010;
  }
  .thread strong {
    font-size: 10px;
    font-weight: 600;
  }
  .thread small {
    font-size: 8px;
    color: #777;
    font-weight: 400;
  }
  .thread p {
    margin-top: 5px;
    font-size: 11px;
    line-height: 1.6;
    color: #4b5059;
  }
  .revision-editor {
    margin: 0 10px 10px;
    padding: 12px;
    min-height: 110px;
    border-radius: 8px;
    background: #ffffffb3;
    font:
      14px/1.6 Georgia,
      serif;
    color: #141414;
  }
  .follow-scene {
    grid-template-columns: 1fr;
    padding: 0 24px;
  }
  .follow-scene .document {
    padding: 22px 28px 90px;
  }
  .follow-scene .document p {
    font-size: 16px;
    margin-bottom: 35px;
  }
  .follow-scene .document.scrolled {
    transform: translateY(-165px);
  }
  .remote-cursor {
    border-left: 2px solid #cf9554;
    margin-left: 3px;
    position: relative;
  }
  .remote-cursor::after {
    content: "Rena";
    position: absolute;
    left: -2px;
    top: -18px;
    padding: 1px 5px;
    border-radius: 3px;
    background: #cf9554;
    color: #fff;
    font:
      9px Inter,
      sans-serif;
  }
  .scenario-caption {
    text-align: center;
    margin-top: 24px;
    color: var(--text-soft);
    font-size: 13px;
    line-height: 1.7;
  }
  @media (max-width: 1000px) {
    .writing-area {
      grid-template-columns: 1fr;
      height: 415px;
      grid-template-rows: 225px 178px;
    }
    .annotation-column {
      padding: 0;
    }
    .revision-editor {
      min-height: 45px;
    }
    .follow-scene {
      grid-template-rows: 1fr;
    }
    .follow-scene .document.scrolled {
      transform: translateY(-135px);
    }
  }
  @media (max-width: 650px) {
    .scenario-controls {
      gap: 10px;
      margin-bottom: 18px;
    }
    .scenario-tabs {
      gap: 12px;
    }
    .scenario-tabs > button {
      font-size: 13px;
      line-height: 1.5;
      min-height: 61px;
    }
    .demo-panel {
      grid-template-columns: 1fr;
      gap: 18px;
    }
    .writing-area {
      height: 295px;
      grid-template-rows: 150px 133px;
    }
    .app-workspace {
      padding-top: 12px;
    }
    .follow-scene {
      grid-template-rows: 1fr;
    }
    .follow-scene .document.scrolled {
      transform: translateY(-195px);
    }
    .scenario-caption {
      text-align: left;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .arriving-comment,
    .document {
      transition: none;
    }
  }
</style>
