<script lang="ts">
  import type { DisplaySource } from "@teamblocks.dev/chord-recorder-protocol";
  import type { Snippet } from "svelte";
  import { desktop } from "#platform/renderer/desktop.svelte";
  import { excludedApps } from "#features/settings/domain/preferences";
  import { PermissionError } from "#platform/renderer/helper";
  import { screenPreviews } from "./screenPreview.ts";
  import type { RecordingSetup } from "#project-document/domain/recording";

  let {
    display,
    setup,
    overlay,
  }: {
    display: DisplaySource;
    setup: Pick<RecordingSetup, "background" | "hiddenApps" | "showsSystemUI">;
    overlay?: Snippet;
  } = $props();

  let canvas: HTMLCanvasElement;
  let status = $state<"starting" | "live" | "unavailable">("starting");
  let message = $state("");

  $effect(() => {
    status = "starting";
    let closed = false;
    let decoding = false;
    const stop = screenPreviews.watch(
      {
        displayId: display.id,
        background: setup.background,
        showsSystemUI: setup.showsSystemUI,
        excludedBundleIds: excludedApps(setup.hiddenApps, desktop.preferences.hiddenApps),
        showsCursor: desktop.preferences.showsCursor,
      },
      async (image) => {
        // Keep at most one decode in flight, and never paint frames from an earlier set of filters.
        if (decoding) return;
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
    "display-preview relative w-full overflow-hidden rounded-lg border border-glass-800",
    status === "starting" ? "bg-black" : "bg-glass-900",
  ]}
  style:aspect-ratio={display.width / display.height}
>
  <canvas
    bind:this={canvas}
    class={["size-full transition-opacity", status !== "live" && "opacity-0"]}
    aria-label={`${display.name} preview`}
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
