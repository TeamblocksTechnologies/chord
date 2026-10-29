<script lang="ts">
  import type { Backgrounds } from "./backgrounds.svelte.ts";
  import { desktop } from "#platform/renderer/desktop.svelte";
  import { settings as settingsDialog } from "#features/settings/renderer/settings.svelte";
  import type { Recording } from "#project-document/domain/recording";
  import BackgroundReplacementControls from "./BackgroundReplacementControls.svelte";
  import Toggle from "@teamblocks.dev/chord-ui/Toggle.svelte";
  import ProgressBar from "@teamblocks.dev/chord-ui/ProgressBar.svelte";

  let { recording, backgrounds }: { recording: Recording; backgrounds: Backgrounds } = $props();
  const job = $derived(recording.directory ? backgrounds.states[recording.directory] : undefined);
  const busy = $derived(job?.phase === "queued" || job?.phase === "processing");
  const settings = $derived(job?.result?.settings);
  const button =
    "h-8 rounded-md bg-glass-800 px-3 text-xs text-neutral-100 hover:bg-glass-700 disabled:opacity-50";
</script>

{#if recording.directory}
  {@const directory = recording.directory}
  <section class="flex flex-col gap-3 p-3" aria-label="Camera background">
    <div class="flex h-5 items-center justify-between gap-2">
      <h3 class="text-xs font-medium text-neutral-100">Background removal</h3>
      {#if settings && !busy}<Toggle
          label="Remove camera background"
          bind:checked={
            () => settings.enabled, (enabled) => backgrounds.update(directory, { enabled })
          }
        />{/if}
    </div>
    {#if busy}
      <ProgressBar value={job?.progress ?? 0} label="Background removal progress" />
      <button class={button} onclick={() => void window.chord.desktop.background.cancel(directory)}
        >Cancel</button
      >
    {:else if !desktop.preferences.backgroundModel}
      <button class={button} onclick={() => settingsDialog.open("background")}
        >Set up in settings</button
      >
    {:else if !settings}
      <button class={button} disabled={!job} onclick={() => void backgrounds.run(directory)}
        >Process</button
      >
    {:else if settings.enabled}
      <BackgroundReplacementControls
        value={settings}
        fill
        showReplacementLabel={false}
        onchange={(patch) => backgrounds.update(directory, patch)}
      />
    {/if}
    {#if job?.error}<p class="text-xs text-amber-300" role="alert">{job.error}</p>{/if}
  </section>
{/if}
