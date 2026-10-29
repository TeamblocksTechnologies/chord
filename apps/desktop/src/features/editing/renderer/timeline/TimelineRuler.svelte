<script lang="ts">
  import type { Snippet } from "svelte";
  import type { TimelineViewport } from "./viewport.svelte.ts";
  import { rulerTicks } from "#media-engine/renderer/ruler";
  import { marksOf } from "#media-engine/renderer/timeline";
  import RulerMark from "./RulerMark.svelte";

  let {
    timeline,
    duration,
    marks,
    ready,
    pinned = false,
    class: className,
    children,
  }: {
    timeline: TimelineViewport;
    duration: number;
    marks: (ReturnType<typeof marksOf>[number] & { left?: number })[];
    ready: boolean;
    pinned?: boolean;
    class: string;
    children: Snippet;
  } = $props();
  const offset = $derived(pinned ? timeline.scrollLeft : 0);
  const ticks = $derived(rulerTicks(timeline.scale, duration, timeline.scrollLeft, timeline.width));
</script>

<div
  class={className}
  role="group"
  aria-label="Track position"
  onpointerdown={(event) => timeline.startScrub(event, ready)}
  onpointermove={timeline.moveScrub}
  onpointerup={timeline.endScrub}
  onpointercancel={timeline.endScrub}
  {@attach (node) => (pinned ? timeline.wheel(node) : undefined)}
>
  {#each ticks as { index, x, label } (index)}
    <div
      class={["absolute bottom-0 w-px bg-glass-700", label ? "h-2.5" : "h-1.5"]}
      style:left={`${x - offset}px`}
    ></div>
    {#if label}<span
        class="absolute top-1 pl-1 text-[10px] text-glass-500 tabular-nums"
        style:left={`${x - offset}px`}>{label}</span
      >{/if}
  {/each}
  {#each marks as mark, index (`${mark.pieceId}:${mark.id}`)}
    <RulerMark
      {mark}
      number={index + 1}
      left={mark.left ?? timeline.x(mark.time) - offset}
      onseek={(time) => void timeline.player.seek(time)}
    />
  {/each}
  {@render children()}
</div>
