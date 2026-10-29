<script lang="ts">
  import ModelOption from "@teamblocks.dev/chord-ui/ModelOption.svelte";
  import ModelDownloadActions from "@teamblocks.dev/chord-ui/ModelDownloadActions.svelte";
  import SettingsSection from "@teamblocks.dev/chord-ui/SettingsSection.svelte";
  import { desktop, updatePreferences } from "#platform/renderer/desktop.svelte";
  import { formatBytes } from "#shared/domain/format";
  import { NoiseEngines } from "./noiseEngines.svelte.ts";
  import {
    DEEP_FILTER_DOWNLOAD,
    NOISE_ENGINES,
    type NoiseEngineId,
  } from "../contracts/noiseReduction.ts";

  const noise = new NoiseEngines();
  const engines = $derived(
    NOISE_ENGINES.map((engine) => ({
      ...engine,
      state: noise.list.find((state) => state.id === engine.id),
    })),
  );

  function removeEngine(id: NoiseEngineId) {
    if (desktop.preferences.noiseEngine === id) updatePreferences({ noiseEngine: null });
    void window.chord.desktop.noiseEngines.remove(id);
  }
</script>

<SettingsSection title="Noise reduction">
  <div role="radiogroup" aria-label="Noise reduction engine">
    {#each engines as engine (engine.id)}
      {@const status = engine.state?.status}
      <ModelOption
        name={engine.name}
        details={engine.id === "deepfilternet3"
          ? [engine.detail, formatBytes(DEEP_FILTER_DOWNLOAD.size)]
          : [engine.detail]}
        chosen={noise.usable === engine.id}
        disabled={status?.state !== "ready"}
        error={status?.state === "unavailable" ? status.reason : engine.state?.error}
        onselect={() => updatePreferences({ noiseEngine: engine.id })}
      >
        {#if engine.id === "deepfilternet3"}
          <ModelDownloadActions
            name={engine.name}
            {status}
            downloadUnavailable
            ondownload={() => void window.chord.desktop.noiseEngines.download(engine.id)}
            oncancel={() => void window.chord.desktop.noiseEngines.cancel(engine.id)}
            onremove={() => removeEngine(engine.id)}
          />
        {/if}
      </ModelOption>
    {/each}
  </div>
</SettingsSection>
