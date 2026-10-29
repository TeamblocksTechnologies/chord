<script lang="ts">
  import { MODE_LABELS } from "../domain/labels.ts";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import NotesPanel from "./NotesPanel.svelte";
  import { hasNotes } from "../domain/notes.ts";
  import TopBar from "#platform/renderer/TopBar.svelte";
  import { formatDuration } from "#shared/domain/format";
  import { applicationName, findDevices, findDisplays, sources } from "./sources.svelte.ts";
  import { activeCameraIds, activeMicrophoneIds, recorder } from "./recorder.svelte.ts";
  import { withShortcut } from "#features/settings/renderer/shortcuts.svelte";

  let setup = $derived(recorder.target!.setup);
  let project = $derived(recorder.project);
  let notes = $derived(recorder.target!.notes);

  let summary = $derived.by(() => {
    const parts: string[] = [];
    if (setup.recordsScreen) {
      parts.push(MODE_LABELS[setup.mode]);
      if (setup.mode === "window" && setup.allowedApps.length > 0) {
        parts[0] += `: ${setup.allowedApps.map(applicationName).join(", ")}`;
      } else if (setup.mode !== "window" && sources.displays.length > 1) {
        for (const display of findDisplays(setup.displayIds)) parts.push(display.name);
      }
    }
    for (const camera of findDevices(sources.cameras, activeCameraIds(setup)))
      parts.push(camera.name);
    for (const mic of findDevices(sources.microphones, activeMicrophoneIds(setup)))
      parts.push(mic.name);
    if (setup.systemAudio) parts.push("System audio");
    return parts;
  });

  // Pausing and marks are global shortcuts, registered by the main process for the length of the recording.
  function onKeyDown(event: KeyboardEvent) {
    if (
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLInputElement ||
      document.querySelector("dialog:modal")
    )
      return;
    if (event.key === "Escape" && recorder.phase === "countdown") recorder.cancel();
  }
</script>

<svelte:window onkeydown={onKeyDown} />

<TopBar>
  {#snippet title()}
    <span class="text-glass-500">{project?.name ?? "Quick recording"}</span>
  {/snippet}
</TopBar>

<div class="flex min-h-0 flex-1">
  <div class="flex flex-1 flex-col items-center justify-center px-8 pb-10">
    {#if recorder.phase === "countdown"}
      <div class="text-xs font-medium text-glass-500">Starting in</div>
      {#key recorder.countdown}
        <div
          class="mt-2 animate-[pop_1s_ease-out] text-8xl font-semibold text-neutral-50 tabular-nums"
        >
          {recorder.countdown}
        </div>
      {/key}
      <button
        class="mt-10 h-9 rounded-lg border border-glass-800 px-4 text-sm text-glass-400 transition hover:border-glass-600 hover:text-neutral-100"
        onclick={() => recorder.cancel()}
      >
        Cancel <span class="ml-1 text-glass-600">Esc</span>
      </button>
    {:else}
      <div class="flex items-center gap-2 text-xs font-medium">
        {#if recorder.phase === "recording"}
          <span class="size-2 animate-pulse rounded-full bg-white"></span>
          <span class="text-neutral-100">Recording</span>
        {:else}
          <span class="size-2 rounded-full bg-amber-400"></span>
          <span class="text-amber-300">Paused</span>
        {/if}
      </div>
      <div
        class={[
          "mt-3 text-7xl font-semibold tracking-tight tabular-nums transition",
          recorder.phase === "paused" ? "text-glass-500" : "text-neutral-50",
        ]}
      >
        {formatDuration(recorder.elapsed)}
      </div>
      <div
        class="mt-4 flex max-w-lg flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-glass-500"
      >
        {#each summary as part, i (i)}
          <span>{part}</span>
        {/each}
      </div>

      <div class="mt-12 flex items-center gap-3">
        <button
          class="flex size-12 items-center justify-center rounded-lg border border-glass-800 text-glass-300 transition hover:border-glass-600 hover:text-neutral-50"
          onclick={() => (recorder.phase === "recording" ? recorder.pause() : recorder.resume())}
          title={withShortcut(
            recorder.phase === "recording" ? "Pause" : "Resume",
            "pauseRecording",
          )}
          aria-label={recorder.phase === "recording" ? "Pause" : "Resume"}
        >
          <Icon name={recorder.phase === "recording" ? "pause" : "play"} class="size-4" />
        </button>
        <button
          class="flex h-14 items-center gap-3 rounded-lg bg-white pr-7 pl-5 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200 active:scale-[0.98]"
          onclick={() => recorder.stop()}
        >
          <span class="size-3.5 rounded-[3px] bg-neutral-950"></span>
          Finish recording
        </button>
        <button
          class="relative flex size-12 items-center justify-center rounded-lg border border-glass-800 text-glass-300 transition hover:border-glass-600 hover:text-neutral-50"
          onclick={() => recorder.addMark()}
          title={withShortcut("Add mark", "addMark")}
          aria-label="Add mark"
        >
          <Icon name="bookmark" class="size-4" />
          {#if recorder.markCount > 0}
            <span
              class="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-glass-700 text-[10px] font-semibold text-neutral-100"
            >
              {recorder.markCount}
            </span>
          {/if}
        </button>
      </div>
    {/if}
  </div>

  {#if hasNotes(notes)}
    <aside class="flex w-96 shrink-0 flex-col border-l border-glass-900 bg-glass-900/30 pt-2">
      <NotesPanel
        class="flex-1"
        pages={notes}
        page={recorder.page}
        phase={recorder.phase}
        onpage={(page) => recorder.setPage(page)}
      />
    </aside>
  {/if}
</div>

<style>
  @keyframes -global-pop {
    from {
      transform: scale(1.25);
      opacity: 0;
    }
    30% {
      transform: scale(1);
      opacity: 1;
    }
  }
</style>
