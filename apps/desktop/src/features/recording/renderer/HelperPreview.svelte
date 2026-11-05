<script lang="ts">
  import type { ScreenPreview } from "@teamblocks.dev/chord-recorder-protocol";
  import type { Snippet } from "svelte";
  import { PermissionError } from "#platform/renderer/helper";
  import { screenPreviews } from "./screenPreview.ts";

  /** Frames are asked for in steps of this many pixels wide, so small layout changes don't restart the preview. */
  const WIDTH_STEP = 80;

  let {
    request,
    fps = 24,
    aspect,
    label,
    fit = "fill",
    black = false,
    class: className,
    overlay,
  }: {
    /** What the helper captures. A new request restarts the preview. */
    request: Omit<ScreenPreview, "id" | "maxWidth" | "fps">;
    fps?: number;
    /** Width over height of the frame's box. */
    aspect: number;
    label: string;
    /** `contain` letterboxes frames whose shape differs from the box, as a window's may. */
    fit?: "fill" | "contain";
    /** Black behind the frame, for frames on black, so any letterboxing matches them. */
    black?: boolean;
    class?: string;
    /** Drawn over the live frame, sized to the box. */
    overlay?: Snippet;
  } = $props();

  let canvas: HTMLCanvasElement;
  let boxWidth = $state(0);
  // The size it's shown at in CSS pixels, not device pixels: a preview only confirms what's captured, so it's worth
  // a little sharpness on Retina screens for a quarter of the pixels to capture, encode, and decode.
  let maxWidth = $derived(Math.ceil(boxWidth / WIDTH_STEP) * WIDTH_STEP);
  let status = $state<"starting" | "live" | "unavailable">("starting");
  let message = $state("");

  $effect(() => {
    status = "starting";
    // Not laid out yet.
    if (maxWidth === 0) return;
    let closed = false;
    // The newest frame waiting while one decodes. Older waiting frames are dropped, but never the newest: the helper
    // doesn't resend a frame while nothing changes, so a dropped last frame would leave an older one showing.
    let waiting: Uint8Array | undefined;
    let decoding = false;
    const paint = async (image: Uint8Array) => {
      decoding = true;
      try {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(image)]));
        try {
          if (closed) return;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas unavailable");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          // Resetting the canvas clears the previous frame, preserving transparent pixels in the next one.
          context.drawImage(bitmap, 0, 0);
          status = "live";
        } finally {
          bitmap.close();
        }
      } catch {
        if (!closed) {
          status = "unavailable";
          message = "Preview unavailable";
        }
      } finally {
        decoding = false;
      }
      const next = waiting;
      waiting = undefined;
      if (next && !closed) void paint(next);
    };
    const stop = screenPreviews.watch(
      { ...request, maxWidth, fps },
      (image) => {
        if (decoding) waiting = image;
        else void paint(image);
      },
      (error) => {
        status = "unavailable";
        message = error instanceof PermissionError ? error.message : "Preview unavailable";
      },
    );
    return () => {
      closed = true;
      stop();
    };
  });
</script>

<div
  class={[
    "relative w-full overflow-hidden rounded-lg border border-glass-800",
    status === "starting" || black ? "bg-black" : "bg-glass-900",
    className,
  ]}
  style:aspect-ratio={aspect}
  bind:clientWidth={boxWidth}
>
  <canvas
    bind:this={canvas}
    class={[
      "size-full transition-opacity",
      fit === "contain" && "object-contain",
      status !== "live" && "opacity-0",
    ]}
    aria-label={label}
  ></canvas>
  {#if overlay && status === "live"}{@render overlay()}{/if}
  {#if status === "starting"}
    <div class="skeleton absolute inset-0" aria-label="Loading preview" role="status"></div>
  {:else if status === "unavailable"}
    <div
      class="absolute inset-0 flex items-center justify-center bg-black px-4 text-center text-xs text-glass-500"
    >
      {message}
    </div>
  {/if}
</div>
