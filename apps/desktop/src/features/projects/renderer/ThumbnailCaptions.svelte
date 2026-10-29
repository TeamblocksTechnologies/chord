<script lang="ts">
  import type { CaptionStyle } from "#features/transcription/domain/captions";
  import type { ThumbnailCaption } from "../contracts/thumbnails.ts";
  import { drawCaption } from "#media-engine/renderer/stage";

  /**
   * The caption showing at `at` in the video, drawn over its thumbnail as the video draws it. `clearance` raises it
   * clear of what's along the thumbnail's bottom, in CSS pixels.
   */
  let {
    captions,
    style,
    at,
    clearance = 0,
  }: {
    captions: ThumbnailCaption[];
    style: CaptionStyle;
    at: number;
    clearance?: number;
  } = $props();

  /** The smallest the caption's text gets, in CSS pixels, however small the thumbnail. */
  const MIN_SIZE = 10;
  const accent =
    getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim() ||
    "#155dfc";

  let canvas: HTMLCanvasElement;
  let width = $state(0);
  let height = $state(0);
  const line = $derived(captions.find((caption) => at >= caption.start && at < caption.end));

  $effect(() => {
    const ratio = devicePixelRatio;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (line && canvas.width > 0 && canvas.height > 0)
      drawCaption(context, line, at, style, accent, {
        minSize: MIN_SIZE * ratio,
        clearance: clearance * ratio,
      });
  });
</script>

<div
  class="pointer-events-none absolute inset-0"
  bind:clientWidth={width}
  bind:clientHeight={height}
>
  <canvas bind:this={canvas} class="size-full"></canvas>
</div>
