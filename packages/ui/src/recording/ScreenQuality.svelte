<script lang="ts">
  // The screen's resolution, frame rate, and HDR, starting from the shared preset.
  import { resolveScreen } from "#ui/model/quality.ts";
  import type { RecordingSetup } from "#ui/model/setup.ts";
  import Segmented from "#ui/Segmented.svelte";
  import Toggle from "#ui/Toggle.svelte";
  import PresetSwitch from "./PresetSwitch.svelte";
  import QualityRow from "./QualityRow.svelte";
  import { choosePreset, setScreenQuality } from "./controls.ts";

  let { setup }: { setup: RecordingSetup } = $props();

  let quality = $derived(resolveScreen(setup.quality, setup.screenQuality));
</script>

<PresetSwitch
  value={setup.quality}
  custom={setup.screenQuality !== null}
  onchange={(preset) => choosePreset(setup, preset, { screen: true })}
/>
<div class="mt-1.5">
  <QualityRow label="Resolution">
    <Segmented
      label="Resolution"
      bind:value={() => quality.scale, (scale) => setScreenQuality(setup, { scale })}
      options={[
        { value: 1, label: "Full" },
        { value: 0.5, label: "Half" },
      ]}
    />
  </QualityRow>
  <QualityRow label="Frame rate">
    <Segmented
      label="Frame rate"
      bind:value={() => quality.fps, (fps) => setScreenQuality(setup, { fps })}
      options={[
        { value: 30, label: "30" },
        { value: 60, label: "60" },
      ]}
    />
  </QualityRow>
  <!-- Transparent frames are SDR. -->
  {#if setup.mode !== "window" && setup.background === "desktop"}
    <QualityRow label="HDR">
      <Toggle
        label="HDR"
        bind:checked={() => quality.hdr, (hdr) => setScreenQuality(setup, { hdr })}
      />
    </QualityRow>
  {/if}
</div>
