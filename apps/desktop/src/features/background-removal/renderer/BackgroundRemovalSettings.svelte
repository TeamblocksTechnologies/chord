<script lang="ts">
  import {
    settingsLabel as label,
    settingsRow as rowClass,
  } from "@teamblocks.dev/chord-ui/settingsStyles";
  import { LiveList } from "#shared/renderer/liveList.svelte";
  import ModelOption from "@teamblocks.dev/chord-ui/ModelOption.svelte";
  import SettingsSection from "@teamblocks.dev/chord-ui/SettingsSection.svelte";
  import Toggle from "@teamblocks.dev/chord-ui/Toggle.svelte";
  import BackgroundReplacementControls from "./BackgroundReplacementControls.svelte";
  import ModelDownloadActions from "@teamblocks.dev/chord-ui/ModelDownloadActions.svelte";
  import { desktop, updatePreferences } from "#platform/renderer/desktop.svelte";
  import { formatBytes } from "#shared/domain/format";
  import {
    BACKGROUND_MODELS,
    type BackgroundModelId,
    type BackgroundModelState,
  } from "../contracts/backgroundRemoval.ts";

  const catalogue = new LiveList<BackgroundModelState>(
    () => window.chord.desktop.backgroundModels.list(),
    (receive) => window.chord.desktop.backgroundModels.onChange(receive),
  );
  const models = $derived(
    BACKGROUND_MODELS.map((model) => ({
      ...model,
      state: catalogue.list.find((state) => state.id === model.id),
    })),
  );
  const backgroundModel = $derived(desktop.preferences.backgroundModel);

  function removeModel(id: BackgroundModelId) {
    if (backgroundModel === id)
      updatePreferences({ backgroundModel: null, autoRemoveBackground: false });
    void window.chord.desktop.backgroundModels.remove(id);
  }
</script>

<SettingsSection title="Models">
  <div role="radiogroup" aria-label="Background removal model">
    {#each models as model (model.id)}
      {@const status = model.state?.status}
      <ModelOption
        name={model.name}
        details={[model.subject, formatBytes(model.size)]}
        chosen={backgroundModel === model.id}
        disabled={status?.state !== "downloaded"}
        error={model.state?.error}
        onselect={() => updatePreferences({ backgroundModel: model.id })}
      >
        <ModelDownloadActions
          name={model.name}
          {status}
          ondownload={() => void window.chord.desktop.backgroundModels.download(model.id)}
          oncancel={() => void window.chord.desktop.backgroundModels.cancel(model.id)}
          onremove={() => removeModel(model.id)}
        />
      </ModelOption>
    {/each}
  </div>
  <div class={rowClass}>
    <span class={label}>Remove the background after each recording with a camera</span>
    <Toggle
      label="Remove the background after each recording with a camera"
      disabled={!backgroundModel}
      bind:checked={
        () => !!backgroundModel && desktop.preferences.autoRemoveBackground,
        (autoRemoveBackground) => updatePreferences({ autoRemoveBackground })
      }
    />
  </div>
</SettingsSection>

<SettingsSection title="Default background">
  <div class={rowClass}>
    <span class={label}>Preview</span>
    <svg
      viewBox="0 0 320 180"
      role="img"
      aria-label={desktop.preferences.backgroundReplacement === "color"
        ? `Background preview with color ${desktop.preferences.backgroundColor}`
        : `Background preview with blur ${desktop.preferences.backgroundBlur}`}
      class="aspect-video w-40 max-w-full shrink-0 overflow-hidden rounded-md border border-glass-700"
    >
      {#if desktop.preferences.backgroundReplacement === "color"}
        <defs>
          <pattern
            id="background-preview-checker"
            width="16"
            height="16"
            patternUnits="userSpaceOnUse"
          >
            <rect width="16" height="16" fill="#343434" />
            <path d="M0 0h8v8H0zM8 8h8v8H8z" fill="#4b4b4b" />
          </pattern>
        </defs>
        <rect width="320" height="180" fill="url(#background-preview-checker)" />
        <rect width="320" height="180" fill={desktop.preferences.backgroundColor} />
      {:else}
        <!-- Scale the 1080p blur radius to this illustration; only the background softens. -->
        <g style:filter={`blur(${(desktop.preferences.backgroundBlur * 180) / 1080}px)`}>
          <rect x="-40" y="-40" width="400" height="260" fill="#c9ccd0" />
          <rect x="28" y="24" width="68" height="84" fill="#eef0f2" />
          <rect x="-40" y="132" width="400" height="88" fill="#9da2aa" />
        </g>
      {/if}
      <path
        d="M78 180c2-22 9-35 28-42l28-10c8-3 12-6 12-12v-8
          c-7-4-12-11-14-21-4 0-6-5-7-10s0-8 4-7l1 1V59
          c0-17 12-27 30-27 17 0 30 10 30 27v12l1-1
          c4-1 5 2 4 7s-3 10-7 10c-2 10-7 17-14 21v8
          c0 6 4 9 12 12l28 10c19 7 26 20 28 42"
        fill="#171717"
        stroke={desktop.preferences.backgroundReplacement === "color" ? "#737373" : "none"}
        stroke-width="1"
        stroke-linejoin="round"
      />
    </svg>
  </div>
  <BackgroundReplacementControls
    id="background"
    value={{
      replacement: desktop.preferences.backgroundReplacement,
      blur: desktop.preferences.backgroundBlur,
      color: desktop.preferences.backgroundColor,
    }}
    onchange={(patch) =>
      updatePreferences({
        ...(patch.replacement !== undefined && { backgroundReplacement: patch.replacement }),
        ...(patch.blur !== undefined && { backgroundBlur: patch.blur }),
        ...(patch.color !== undefined && { backgroundColor: patch.color }),
      })}
  >
    {#snippet row(name, controls)}
      <div class={rowClass}>
        <span class={label}>{name}</span>
        {@render controls()}
      </div>
    {/snippet}
  </BackgroundReplacementControls>
</SettingsSection>
