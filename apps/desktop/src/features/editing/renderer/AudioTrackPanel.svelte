<script lang="ts">
  import { projectEdits } from "./edits.ts";
  import {
    audioTrackKey,
    audioTrackSettings,
    type AudioTrackSettings,
  } from "../domain/audioSettings.ts";
  import { settings as settingsDialog } from "#features/settings/renderer/settings.svelte";
  import type { NoiseStates } from "#features/audio-processing/renderer/noise.svelte";
  import { NoiseEngines } from "#features/audio-processing/renderer/noiseEngines.svelte";
  import type { Project, Recording } from "#project-document/domain/recording";
  import Toggle from "@teamblocks.dev/chord-ui/Toggle.svelte";
  import SliderField from "@teamblocks.dev/chord-ui/SliderField.svelte";
  import ProgressBar from "@teamblocks.dev/chord-ui/ProgressBar.svelte";

  let {
    project,
    recording,
    kind,
    index = 0,
    noise,
  }: {
    project: Project;
    recording: Recording;
    kind: "microphone" | "systemAudio";
    index?: number;
    noise: NoiseStates;
  } = $props();
  const key = $derived(audioTrackKey(kind, index));
  const settings = $derived(audioTrackSettings(recording.audio, kind, index));
  /** Leveling as the person set it, even while the gain it needs isn't measured yet. */
  const wantsLevel = $derived(recording.audio?.[key]?.leveled === true);
  const label = $derived(
    `${kind === "microphone" ? "Microphone" : "System audio"}${index ? ` ${index + 1}` : ""}`,
  );
  const engines = new NoiseEngines();
  const track = $derived(
    recording.directory ? noise.states[recording.directory]?.tracks[key] : undefined,
  );
  const busy = $derived(track?.phase === "queued" || track?.phase === "processing");
  const failed = $derived(track?.phase === "failed" && !track.result ? track.error : undefined);

  let measuring = $state(false);
  let problem = $state<string | null>(null);
  const button =
    "h-7 shrink-0 rounded-md bg-glass-800 px-2.5 text-xs text-neutral-100 hover:bg-glass-700 disabled:opacity-50";

  function update(patch: Partial<AudioTrackSettings>): void {
    // Patch what is stored now: a measurement can finish after other edits.
    projectEdits.setAudio(project, recording, kind, index, patch);
  }

  // Noise reduction that failed with nothing to fall back on is turned off again, leaving the reason shown.
  $effect(() => {
    if (failed && settings.denoised) update({ denoised: false });
  });

  async function reduce(on: boolean): Promise<void> {
    problem = null;
    const directory = recording.directory;
    if (!directory) return;
    if (!on) {
      update({ denoised: false });
      if (busy) void noise.cancel(directory, kind, index);
      // Leveling may have been set while the cleaned copy played, and the original needs its own gain.
      if (!(await noise.ensureLevel(recording, kind, index))) problem = "Nothing to level";
      return;
    }
    update({ denoised: true });
    await noise.start(directory, kind, index);
  }

  async function level(on: boolean): Promise<void> {
    problem = null;
    if (!on) return update({ leveled: false });
    const clean = settings.denoised && !!track?.result;
    const measured = clean
      ? settings.denoisedLevelGain && settings.denoisedLevelFor === track?.result?.id
      : settings.levelGain;
    // While the cleaned copy is made, leveling is asked for now and measured on the copy once it's there.
    if (measured || (settings.denoised && busy)) return update({ leveled: true });
    if (!recording.directory || measuring) return;
    measuring = true;
    try {
      const gain = await window.chord.desktop.recording.levelAudio(
        recording.directory,
        kind,
        index,
        clean,
      );
      if (gain === null) problem = "Nothing to level";
      else
        update({
          leveled: true,
          ...(clean
            ? { denoisedLevelGain: gain, denoisedLevelFor: track?.result?.id }
            : { levelGain: gain }),
        });
    } catch {
      problem = "Couldn't measure this audio";
    } finally {
      measuring = false;
    }
  }
</script>

<section class="flex flex-col gap-3 border-b border-glass-800 p-3" aria-label={`${label} controls`}>
  <SliderField
    label="Volume"
    ariaLabel={`${label} volume`}
    value={settings.volume}
    min={0}
    max={1}
    step={0.01}
    scale={100}
    suffix="%"
    onchange={(volume) => update({ volume })}
  />
  <div class="flex items-center justify-between gap-3 text-xs text-glass-400">
    Reduce noise
    <span class="flex items-center gap-2">
      {#if engines.loaded && !engines.usable && !settings.denoised}
        <button class={button} onclick={() => settingsDialog.open("audio")}
          >Set up in settings</button
        >
      {:else}
        {#if failed}<span role="alert" class="max-w-40 truncate text-amber-300" title={failed}
            >{failed}</span
          >{/if}
        <Toggle
          label={`Reduce noise in ${label.toLowerCase()}`}
          disabled={!recording.directory || !engines.loaded}
          bind:checked={() => settings.denoised, reduce}
        />
      {/if}
    </span>
  </div>
  {#if busy}
    <div class="flex items-center gap-2">
      <ProgressBar
        class="flex-1"
        value={track?.progress ?? 0}
        label={`Reducing noise in ${label.toLowerCase()}`}
      />
      <button
        class={button}
        onclick={() => recording.directory && void noise.cancel(recording.directory, kind, index)}
        >Cancel</button
      >
    </div>
  {/if}
  <div class="flex items-center justify-between gap-3 text-xs text-glass-400">
    Level audio
    <span class="flex items-center gap-2">
      {#if measuring}<span>Measuring</span>{:else if problem}<span role="alert">{problem}</span
        >{/if}
      <Toggle
        label={`Level ${label.toLowerCase()}`}
        disabled={measuring || (!recording.directory && !settings.levelGain)}
        bind:checked={() => wantsLevel || measuring, level}
      />
    </span>
  </div>
  <div class="flex items-center justify-between gap-3 text-xs text-glass-400">
    Mute
    <Toggle
      label={`Mute ${label.toLowerCase()}`}
      bind:checked={() => settings.muted, (muted) => update({ muted })}
    />
  </div>
</section>
