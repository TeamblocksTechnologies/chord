<script lang="ts">
  // The recording's floating controls. Compact, it shows a small camera preview (when one is on) above the status
  // dot and timer; open, the controls and the same source cells as Home and the toolbar, editing the recording in
  // progress.
  import { resolveCamera } from "../domain/quality.ts";
  import type { ShortcutId } from "#features/settings/domain/shortcuts";
  import { ISLAND, islandSize, showsCamera } from "../contracts/island.ts";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import { primaryCamera } from "./controls/shared.ts";
  import RecordingControls from "./controls/RecordingControls.svelte";
  import { desktop } from "#platform/renderer/desktop.svelte";
  import { formatDuration } from "#shared/domain/format";
  import { withShortcut } from "#features/settings/renderer/shortcuts.svelte";
  import { cameraPreview, holdStream } from "./preview.ts";
  import { windowDrag } from "./windowDrag.ts";

  const recording = window.chord.desktop.recording;
  let phase = $derived(desktop.recording.phase);
  let mode = $derived(desktop.island.mode);
  let setup = $derived(desktop.live);
  let camera = $derived(setup ? primaryCamera(setup) : undefined);
  let cameraSize = $derived(
    camera && setup
      ? resolveCamera(camera, setup.quality, setup.cameraQuality[camera.id])
      : undefined,
  );
  let laser = $derived(desktop.recording.laser);
  let clicks = $derived(desktop.recording.clicks);
  let keys = $derived(desktop.recording.keys);

  // One stream for the camera's whole time on, so opening and closing don't restart it.
  let video = $state<HTMLVideoElement>();
  let cameraStatus = $state<"starting" | "live" | "unavailable">("starting");
  $effect(() => {
    if (!camera || !video) return;
    const element = video;
    cameraStatus = "starting";
    return holdStream(
      cameraPreview(camera, cameraSize),
      (stream) => {
        element.srcObject = stream;
        cameraStatus = "live";
      },
      () => (cameraStatus = "unavailable"),
    );
  });

  const status = $derived(
    phase === "countdown" ? "countdown" : phase === "paused" ? "paused" : "recording",
  );
  let open = $derived(mode === "open");
  let corner = $derived(desktop.island.corner);
  let showCamera = $derived(showsCamera(mode, desktop.island));
  let tools = $derived(desktop.island.tools);
  let size = $derived(islandSize(mode, showCamera, tools));
</script>

{#snippet dot()}
  {#if status === "countdown"}
    <span class="text-sm font-semibold text-neutral-50 tabular-nums"
      >{desktop.recording.countdown}</span
    >
  {:else}
    <span
      class={[
        "size-2.5 shrink-0 rounded-full",
        status === "paused" ? "bg-amber-400" : "animate-pulse bg-white",
      ]}
    ></span>
  {/if}
{/snippet}

{#snippet timer()}
  {@render dot()}
  {#if status === "countdown"}
    <span class="text-xs font-medium text-glass-400">Starting</span>
  {:else}
    <span
      class={[
        "text-sm font-semibold tabular-nums",
        status === "paused" ? "text-glass-400" : "text-neutral-50",
      ]}
    >
      {formatDuration(desktop.recording.elapsed)}
    </span>
  {/if}
{/snippet}

{#snippet iconButton(
  icon: "pause" | "play" | "bookmark",
  label: string,
  shortcut: ShortcutId,
  onclick: () => void,
  badge?: number,
)}
  <button
    class="relative flex size-8 items-center justify-center rounded-md text-glass-300 transition hover:bg-glass-800 hover:text-neutral-50"
    aria-label={label}
    title={withShortcut(label, shortcut)}
    {onclick}
  >
    <Icon name={icon} class="size-4" />
    {#if badge}
      <span
        class="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-glass-700 text-[9px] font-semibold text-neutral-100"
        >{badge}</span
      >
    {/if}
  </button>
{/snippet}

<!--
  The window is the open island's size plus room for its dropdowns; the surface grows and shrinks inside it from the
  pinned corner, and the open island drags by anything that isn't a control.
-->
<div class="relative h-screen w-screen text-neutral-100 antialiased select-none">
  <div
    data-island={mode}
    data-menu-anchor
    class={["overlay-surface island-surface absolute overflow-hidden", !open && "island-closing"]}
    style:width={`${size.width}px`}
    style:height={`${size.height}px`}
    style:left={corner.horizontal === "left" ? "0" : undefined}
    style:right={corner.horizontal === "right" ? "0" : undefined}
    style:top={corner.vertical === "top" ? "0" : undefined}
    style:bottom={corner.vertical === "bottom" ? "0" : undefined}
    aria-label="Recording controls"
    role="group"
    {@attach windowDrag(() => open)}
  >
    <!-- Sized by the main process for the camera being on, so it keeps its space even while the device is missing. -->
    {#if showCamera}
      <div
        class="island-morph absolute top-0 left-0 overflow-hidden bg-black"
        style:width={`${size.width}px`}
        style:height={`${open ? ISLAND.openCameraHeight : ISLAND.compactCamera.height}px`}
      >
        <video
          bind:this={video}
          class={[
            "size-full object-cover transition-opacity",
            desktop.preferences.cameraMirrored && "-scale-x-100",
            cameraStatus !== "live" && "opacity-0",
          ]}
          autoplay
          muted
          playsinline
        ></video>
        {#if !camera || cameraStatus === "unavailable"}
          <div
            class={[
              "absolute inset-0 flex items-center justify-center px-2 text-center text-glass-500",
              open ? "text-xs" : "text-[10px]",
            ]}
          >
            {camera ? "Preview unavailable" : "Camera disconnected"}
          </div>
        {:else if cameraStatus === "starting"}
          <div class="skeleton absolute inset-0" aria-hidden="true"></div>
        {/if}
      </div>
    {/if}

    <!-- Compact: the dot and timer under the camera, fading out as the island opens. -->
    <div
      class="island-fade absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 px-3"
      style:height={`${ISLAND.compactBar}px`}
      style:opacity={open ? 0 : 1}
      aria-hidden={open}
    >
      {@render timer()}
    </div>

    <!-- Open: the controls and source cells at full size, revealed as the surface grows. -->
    <div
      class={[
        "island-fade absolute bottom-0 flex flex-col",
        corner.horizontal === "left" ? "left-0" : "right-0",
      ]}
      style:width={`${ISLAND.openWidth}px`}
      style:height={`${ISLAND.bar + ISLAND.cells + (tools ? ISLAND.tools : 0)}px`}
      style:opacity={open ? 1 : 0}
      inert={!open}
    >
      <div class="flex shrink-0 items-center gap-2 px-3" style:height={`${ISLAND.bar}px`}>
        {@render timer()}

        <div class="ml-auto flex items-center gap-1">
          {#if status === "countdown"}
            <button
              class="h-8 rounded-md px-3 text-xs text-glass-300 hover:bg-glass-800 hover:text-neutral-50"
              onclick={() => recording.cancel()}
            >
              Cancel
            </button>
          {:else}
            {@render iconButton(
              "bookmark",
              "Add mark",
              "addMark",
              () => recording.addMark(),
              desktop.recording.markCount,
            )}
            {#if status === "paused"}
              {@render iconButton("play", "Resume", "pauseRecording", () => recording.resume())}
            {:else}
              {@render iconButton("pause", "Pause", "pauseRecording", () => recording.pause())}
            {/if}
            <button
              class="ml-1 flex h-8 items-center gap-2 rounded-md bg-white pr-3 pl-2.5 text-xs font-semibold text-neutral-950 transition hover:bg-neutral-200 active:scale-[0.98]"
              onclick={() => recording.stop()}
            >
              <span class="size-2.5 rounded-[2px] bg-neutral-950"></span>
              Finish
            </button>
          {/if}
        </div>
      </div>

      <!-- Sources are only shown to be changed: they appear once the island is opened. -->
      {#if setup}
        <div class="shrink-0 px-1.5 pb-1.5" style:height={`${ISLAND.cells}px`}>
          <RecordingControls
            {setup}
            layout="island"
            side={corner.vertical === "bottom" ? "top" : "bottom"}
          />
        </div>
      {/if}

      <!-- Annotation tools for use during the recording. -->
      {#if tools}
        <div
          class="flex shrink-0 items-center gap-1 px-3"
          style:height={`${ISLAND.tools}px`}
          role="toolbar"
          aria-label="Annotation tools"
        >
          <button
            class={[
              "flex size-8 items-center justify-center rounded-md transition",
              laser
                ? "bg-white/15 text-neutral-50"
                : "text-glass-300 hover:bg-glass-800 hover:text-neutral-50",
            ]}
            aria-pressed={laser}
            aria-label={`Laser pointer ${laser ? "on" : "off"}`}
            title={laser ? "Turn laser pointer off" : "Turn laser pointer on"}
            disabled={status === "countdown"}
            onclick={() => recording.setLaser(!laser)}
          >
            <Icon name="laser" class="size-4" />
          </button>
          <button
            class={[
              "flex size-8 items-center justify-center rounded-md transition",
              clicks
                ? "bg-white/15 text-neutral-50"
                : "text-glass-300 hover:bg-glass-800 hover:text-neutral-50",
            ]}
            aria-pressed={clicks}
            aria-label={`Click highlights ${clicks ? "on" : "off"}`}
            title={clicks ? "Turn click highlights off" : "Turn click highlights on"}
            disabled={status === "countdown"}
            onclick={() => recording.setClicks(!clicks)}
          >
            <Icon name="click" class="size-4" />
          </button>
          <button
            class={[
              "flex size-8 items-center justify-center rounded-md transition",
              keys
                ? "bg-white/15 text-neutral-50"
                : "text-glass-300 hover:bg-glass-800 hover:text-neutral-50",
            ]}
            aria-pressed={keys}
            aria-label={`Keyboard shortcuts ${keys ? "on" : "off"}`}
            title={keys ? "Turn keyboard shortcuts off" : "Turn keyboard shortcuts on"}
            disabled={status === "countdown"}
            onclick={() => recording.setKeys(!keys)}
          >
            <Icon name="keyboard" class="size-4" />
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>
