<script lang="ts">
  import type { Snippet } from "svelte";
  import { PermissionError } from "#platform/renderer/helper";
  import { holdStream, type PreviewSource } from "./preview.ts";

  let {
    open,
    mirrored = false,
    aspect = 16 / 9,
    overlay,
  }: {
    open: PreviewSource;
    mirrored?: boolean;
    /** Width over height. Portrait and square frames keep a landscape frame's height rather than its width. */
    aspect?: number;
    /** Drawn over the live frame, sized to it. */
    overlay?: Snippet;
  } = $props();

  let video: HTMLVideoElement;
  let status = $state<"starting" | "live" | "unavailable">("starting");
  let message = $state("");

  $effect(() => {
    status = "starting";
    return holdStream(
      open,
      (stream) => {
        video.srcObject = stream;
        status = "live";
      },
      (error) => {
        status = "unavailable";
        // Permission hints are worth showing; Chromium's own errors aren't.
        message = error instanceof PermissionError ? error.message : "Preview unavailable";
      },
    );
  });
</script>

<div
  class={[
    "relative overflow-hidden rounded-lg border border-glass-800 bg-black",
    aspect < 1.2 ? "mx-auto h-40" : "w-full",
  ]}
  style:aspect-ratio={aspect}
>
  <video
    bind:this={video}
    class={[
      "size-full object-cover transition-opacity",
      mirrored && "-scale-x-100",
      status !== "live" && "opacity-0",
    ]}
    autoplay
    muted
    playsinline
  ></video>
  {#if overlay && status === "live"}{@render overlay()}{/if}
  {#if status === "starting"}
    <div class="skeleton absolute inset-0" aria-label="Loading preview" role="status"></div>
  {:else if status === "unavailable"}
    <div
      class="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-glass-500"
    >
      {message}
    </div>
  {/if}
</div>
