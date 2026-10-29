<script lang="ts">
  import { rulerLabel } from "#media-engine/renderer/ruler";
  import type { TimelineMark } from "#media-engine/renderer/timeline";

  /** A mark added while recording, on a ruler. Pressing it moves the playhead there. */
  let {
    mark,
    number,
    left,
    onseek,
  }: {
    mark: TimelineMark;
    /** Its place among the marks shown, from 1. */
    number: number;
    /** Where it is in the ruler, in pixels. */
    left: number;
    onseek: (time: number) => void;
  } = $props();

  const name = $derived(
    mark.kind === "mark"
      ? `Mark ${number}`
      : `${mark.kind.charAt(0).toUpperCase()}${mark.kind.slice(1)}`,
  );
</script>

<button
  class="group/mark absolute bottom-0 z-10 flex h-4 w-3 -translate-x-1/2 cursor-pointer items-end justify-center outline-none"
  style:left={`${left}px`}
  title={`${name} at ${rulerLabel(mark.time)}${mark.note ? `\n${mark.note}` : ""}`}
  aria-label={`Go to ${name.toLowerCase()} at ${rulerLabel(mark.time)}`}
  onpointerdown={(event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onseek(mark.time);
  }}
  onclick={(event) => {
    if (event.detail === 0) onseek(mark.time);
  }}
  data-mark={mark.id}
>
  <!-- A bookmark: square top, pointed bottom, with its point on the mark's time. -->
  <svg
    class="h-3 w-2.5 text-primary transition-colors group-hover/mark:text-primary-hover group-focus-visible/mark:text-primary-hover"
    viewBox="0 0 10 12"
    aria-hidden="true"
  >
    <path
      d="M2 .5h6A1.5 1.5 0 0 1 9.5 2v5.75L5 11.36.5 7.75V2A1.5 1.5 0 0 1 2 .5z"
      fill="currentColor"
      class="stroke-blue-400"
      stroke-width="1"
      stroke-linejoin="round"
    />
  </svg>
</button>
