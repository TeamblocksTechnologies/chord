<script lang="ts">
  import {
    settingsButton as button,
    settingsLabel as label,
    settingsRow as row,
  } from "@teamblocks.dev/chord-ui/settingsStyles";
  import { onDestroy } from "svelte";
  import { LiveList } from "#shared/renderer/liveList.svelte";
  import ModelOption from "@teamblocks.dev/chord-ui/ModelOption.svelte";
  import LevelBar from "@teamblocks.dev/chord-ui/LevelBar.svelte";
  import ModelDownloadActions from "@teamblocks.dev/chord-ui/ModelDownloadActions.svelte";
  import Select from "@teamblocks.dev/chord-ui/Select.svelte";
  import SettingsSection from "@teamblocks.dev/chord-ui/SettingsSection.svelte";
  import Toggle from "@teamblocks.dev/chord-ui/Toggle.svelte";
  import { desktop, updatePreferences } from "#platform/renderer/desktop.svelte";
  import { formatBytes } from "#shared/domain/format";
  import { TranscriptionTest } from "./transcriptionTest.svelte.ts";
  import {
    TRANSCRIPTION_MODELS,
    type ModelState,
    type TranscriptionModelId,
  } from "../domain/transcription.ts";

  const catalogue = new LiveList<ModelState>(
    () => window.chord.desktop.models.list(),
    (receive) => window.chord.desktop.models.onChange(receive),
  );
  const test = new TranscriptionTest();
  onDestroy(() => test.dispose());
  const models = $derived(
    TRANSCRIPTION_MODELS.map((model) => ({
      ...model,
      state: catalogue.list.find((state) => state.id === model.id),
    })),
  );
  const transcriptionModel = $derived(desktop.preferences.transcriptionModel);
  const languageNames = new Intl.DisplayNames(undefined, { type: "language" });

  /** A model's languages and download size, as far as they're known. Apple Speech's language has its own menu. */
  function modelDetails(model: (typeof models)[number]): string[] {
    return [model.languages, model.size && formatBytes(model.size)].filter((part): part is string =>
      Boolean(part),
    );
  }

  const appleLocales = $derived(
    models.find((model) => model.id === "apple-speech")?.state?.locales,
  );
  const languageName = (locale: string) => languageNames.of(locale) ?? locale;
  const appleLanguages = $derived(
    appleLocales
      ? [
          {
            value: "system",
            label: appleLocales.system ? `System (${languageName(appleLocales.system)})` : "System",
          },
          ...appleLocales.supported
            .map((locale) => ({ value: locale, label: languageName(locale) }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        ]
      : [],
  );

  function removeModel(id: TranscriptionModelId) {
    if (transcriptionModel === id) updatePreferences({ transcriptionModel: null });
    void window.chord.desktop.models.remove(id);
  }
</script>

<SettingsSection title="Models">
  <div role="radiogroup" aria-label="Transcription model">
    {#each models as model (model.id)}
      {@const status = model.state?.status}
      <ModelOption
        name={model.name}
        details={modelDetails(model)}
        chosen={transcriptionModel === model.id}
        disabled={status?.state !== "downloaded"}
        error={model.state?.error}
        onselect={() => updatePreferences({ transcriptionModel: model.id })}
      >
        {#if model.id === "apple-speech" && appleLanguages.length > 0}
          <div class="flex w-52 max-w-full shrink-0">
            <Select
              label="Apple Speech language"
              compact
              disabled={status?.state === "downloading"}
              options={appleLanguages}
              bind:value={
                () => desktop.preferences.appleSpeechLocale ?? "system",
                (value) =>
                  updatePreferences({ appleSpeechLocale: value === "system" ? null : value })
              }
            />
          </div>
        {/if}
        <ModelDownloadActions
          name={model.name}
          {status}
          ondownload={() => void window.chord.desktop.models.download(model.id)}
          oncancel={model.id === "apple-speech"
            ? undefined
            : () => void window.chord.desktop.models.cancel(model.id)}
          onremove={model.id === "apple-speech" ? undefined : () => removeModel(model.id)}
        />
      </ModelOption>
    {/each}
  </div>
  <div class={row}>
    <span class={label}>Auto-transcribe microphone audio</span>
    <Toggle
      label="Auto-transcribe microphone audio"
      disabled={!transcriptionModel}
      bind:checked={
        () => !!transcriptionModel && desktop.preferences.autoTranscribe,
        (autoTranscribe) => updatePreferences({ autoTranscribe })
      }
    />
  </div>
  {#if transcriptionModel}
    {@const result = test.result?.model === transcriptionModel ? test.result : null}
    <div class={row}>
      <span class={label}>Test transcription</span>
      {#if test.phase === "recording"}
        <div class="w-28 shrink-0"><LevelBar level={test.level} /></div>
        <button class={button} onclick={() => test.stop()}>Stop</button>
      {:else if test.phase === "transcribing"}
        <span class="shrink-0 text-xs text-glass-400">Transcribing…</span>
      {:else}
        <button class={button} onclick={() => void test.start(transcriptionModel)}>Test</button>
      {/if}
    </div>
    {#if result}
      <p
        class={[
          "mb-3 rounded-lg bg-black/20 px-3 py-2 text-xs select-text",
          "error" in result
            ? "text-amber-300"
            : result.text
              ? "text-neutral-100"
              : "text-glass-500",
        ]}
      >
        {"error" in result ? result.error : result.text || "No speech heard"}
      </p>
    {/if}
  {/if}
</SettingsSection>
