<script lang="ts">
  // Cameras stay dimmed and unpreviewed while off. Selecting a device switches them on; deselecting keeps their power state.
  import { resolveCamera } from "../../domain/quality.ts";
  import { desktop } from "#platform/renderer/desktop.svelte";
  import { cameraPreview } from "../preview.ts";
  import { sources } from "../sources.svelte.ts";
  import type { RecordingSetup } from "#project-document/domain/recording";
  import MenuItem from "@teamblocks.dev/chord-ui/MenuItem.svelte";
  import VideoPreview from "../VideoPreview.svelte";
  import CameraQuality from "./CameraQuality.svelte";
  import DrillBack from "./DrillBack.svelte";
  import DrillRow from "./DrillRow.svelte";
  import { primaryCamera, qualityLabel, selectedCameras, toggled } from "./shared.ts";

  let { setup }: { setup: RecordingSetup } = $props();

  // The popup renders only while open, so this resets to the device list each time.
  let view = $state<"main" | "quality" | "preview">("main");
  let cameras = $derived(selectedCameras(setup));
  let primary = $derived(primaryCamera(setup));
</script>

{#if view === "quality" && cameras.length > 0}
  <DrillBack label="Camera" onback={() => (view = "main")} />
  <CameraQuality {setup} />
{:else if view === "preview" && cameras.length > 1}
  <DrillBack label="Camera" onback={() => (view = "main")} />
  <div class="px-2.5 pb-1 text-xs text-glass-500">Previewed camera</div>
  {#each cameras as camera (camera.id)}
    <MenuItem
      selected={camera.id === primary?.id}
      detail={camera.isDefault ? "Default" : undefined}
      onclick={() => (setup.primaryCameraId = camera.id)}
    >
      {camera.name}
    </MenuItem>
  {/each}
{:else}
  <div class={["transition-opacity", !setup.cameraEnabled && "opacity-50"]}>
    {#each sources.cameras as camera (camera.id)}
      <MenuItem
        selected={setup.cameraIds.includes(camera.id)}
        multiple
        detail={camera.isDefault ? "Default" : undefined}
        onclick={() => {
          setup.cameraIds = toggled(setup.cameraIds, camera.id);
          if (setup.cameraIds.includes(camera.id)) setup.cameraEnabled = true;
        }}
      >
        {camera.name}
        {#snippet preview()}
          {#if setup.cameraEnabled}
            {@const size = resolveCamera(camera, setup.quality, setup.cameraQuality[camera.id])}
            <VideoPreview
              open={cameraPreview(camera, size)}
              aspect={size ? size.width / size.height : undefined}
              mirrored={desktop.preferences.cameraMirrored}
            />
          {/if}
        {/snippet}
      </MenuItem>
    {:else}
      <div class="px-2.5 py-1.5 text-sm text-glass-500">No cameras connected</div>
    {/each}
    {#if cameras.length > 0}
      <div class="-mx-1 my-1 h-px bg-glass-800"></div>
      <DrillRow
        icon="sliders"
        label="Quality"
        detail={qualityLabel(
          setup,
          cameras.some((c) => setup.cameraQuality[c.id]),
        )}
        onclick={() => (view = "quality")}
      />
      {#if cameras.length > 1}
        <DrillRow
          icon="camera"
          label="Preview"
          detail={primary?.name ?? ""}
          onclick={() => (view = "preview")}
        />
      {/if}
    {/if}
  </div>
{/if}
