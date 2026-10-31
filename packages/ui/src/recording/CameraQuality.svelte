<script lang="ts">
  // Each recorded camera's orientation, size, and frame rate, from what it reports, starting from the shared preset.
  import {
    ORIENTATIONS,
    cameraOrientations,
    formatFor,
    formatSize,
    formatsIn,
    frameRates,
    orientation,
    resolveCamera,
    sizeName,
  } from "#ui/model/quality.ts";
  import type { RecordingSetup } from "#ui/model/setup.ts";
  import MenuItem from "#ui/MenuItem.svelte";
  import Segmented from "#ui/Segmented.svelte";
  import PresetSwitch from "./PresetSwitch.svelte";
  import QualityRow from "./QualityRow.svelte";
  import { choosePreset, selectedCameras, setCameraQuality } from "./controls.ts";

  let { setup }: { setup: RecordingSetup } = $props();

  let cameras = $derived(selectedCameras(setup));
</script>

<PresetSwitch
  value={setup.quality}
  custom={cameras.some((c) => setup.cameraQuality[c.id])}
  onchange={(preset) => choosePreset(setup, preset, { cameraIds: cameras.map((c) => c.id) })}
/>
{#each cameras as camera (camera.id)}
  {@const quality = resolveCamera(camera, setup.quality, setup.cameraQuality[camera.id])}
  {#if cameras.length > 1}<div class="mt-2 truncate px-2.5 text-xs text-glass-500">
      {camera.name}
    </div>{/if}
  {#if quality}
    {@const format = camera.formats.find(
      (f) => f.width === quality.width && f.height === quality.height,
    )!}
    {@const orientations = cameraOrientations(camera)}
    <div class="mt-1.5">
      {#if orientations.length > 1}
        <div class="px-1 pb-1">
          <Segmented
            label="Orientation"
            fill
            bind:value={
              () => orientation(format),
              (wanted) => {
                const next = formatFor(camera, quality, wanted);
                if (next)
                  setCameraQuality(setup, camera, { width: next.width, height: next.height });
              }
            }
            options={ORIENTATIONS.filter((o) => orientations.includes(o.value))}
          />
        </div>
      {/if}
      {#each formatsIn(camera, orientation(format)) as option (`${option.width}x${option.height}`)}
        <MenuItem
          selected={option.width === format.width && option.height === format.height}
          detail={sizeName(option)}
          onclick={() =>
            setCameraQuality(setup, camera, { width: option.width, height: option.height })}
        >
          <span class="tabular-nums">{formatSize(option)}</span>
        </MenuItem>
      {/each}
      <QualityRow label="Frame rate">
        <Segmented
          label="Frame rate"
          bind:value={() => quality.fps, (fps) => setCameraQuality(setup, camera, { fps })}
          options={frameRates(format).map((fps) => ({ value: fps, label: String(fps) }))}
        />
      </QualityRow>
    </div>
  {/if}
{/each}
