<script lang="ts" module>
  import { afterExit } from "@teamblocks.dev/chord-ui/dialog";
  import { defaultExportSettings } from "./settings.ts";

  /** The settings last exported with, kept for the next export. */
  const chosen = $state(defaultExportSettings());
</script>

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { exportVideo, type ExportSource } from "./exporter.ts";
  import { estimateGifSize, exportGif } from "./gif.ts";
  import { captionCues } from "#media-engine/renderer/captions";
  import { type ExportFile, openExportFile } from "./file.ts";
  import {
    EXPORT_ASPECTS,
    EXPORT_FRAME_RATES,
    EXPORT_RESOLUTIONS,
    FILE_TYPES,
    GIF_FRAME_RATES,
    GIF_LONGEST,
    GIF_WIDTHS,
    VIDEO_FORMATS,
    type ExportRange,
    aspectOf,
    exportSize,
    frameCount,
    gifSize,
    isVideoFormat,
  } from "./settings.ts";
  import {
    formatBytes,
    formatDuration,
    formatTimecode,
    parseTimecode,
  } from "#shared/domain/format";
  import { projectFolder } from "#project-document/renderer/projects.svelte";
  import type { Project } from "#project-document/domain/recording";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import Segmented from "@teamblocks.dev/chord-ui/Segmented.svelte";
  import Select from "@teamblocks.dev/chord-ui/Select.svelte";
  import Toggle from "@teamblocks.dev/chord-ui/Toggle.svelte";
  import ProgressBar from "@teamblocks.dev/chord-ui/ProgressBar.svelte";

  let {
    project,
    source,
    playhead = null,
    onexported,
    onclose,
  }: {
    project: Project;
    source: ExportSource;
    /** Where the playhead is on the video's timeline, if it's showing, for the range. */
    playhead?: number | null;
    /** A video was saved to the project's Exports folder. */
    onexported: () => void;
    onclose: () => void;
  } = $props();

  const TITLES = {
    settings: "Export video",
    exporting: "Exporting video",
    done: "Video exported",
    failed: "Export failed",
  };
  const GIF_TITLES = { ...TITLES, exporting: "Exporting GIF", done: "GIF exported" };
  const ENDS = [
    ["start", "Start"],
    ["end", "End"],
  ] as const;
  /** The shortest range, so there's always a frame to export. */
  const SHORTEST = 0.1;
  const row = "flex min-h-11 items-center gap-3 border-t border-glass-800 py-2";
  const label = "flex-1 text-xs font-medium text-neutral-100";

  let dialog: HTMLDialogElement;
  let phase = $state<"settings" | "exporting" | "done" | "failed">("settings");
  /** Frames done, from 0 to 1; null until the first is, while the recordings are opened. */
  let progress = $state<number | null>(null);
  let percent = $derived(Math.floor((progress ?? 0) * 100));
  /** Seconds left, once there's enough done to tell. */
  let remaining = $state<number | null>(null);
  let saved = $state<string | null>(null);
  let error = $state("");
  let controller: AbortController | null = null;

  let gif = $derived(chosen.format === "gif");
  let format = $derived(isVideoFormat(chosen.format) ? VIDEO_FORMATS[chosen.format] : null);
  let aspect = $derived(aspectOf(chosen.aspect, source.aspect));
  let size = $derived(
    gif ? gifSize(aspect, chosen.gifWidth) : exportSize(aspect, chosen.resolution),
  );

  /** Whether only part of the project is exported, and which part; the whole project otherwise. */
  let ranged = $state(false);
  const whole = (): ExportRange => ({ start: 0, end: source.duration });
  let range = $state(whole());
  /** A GIF of a project longer than a GIF can be needs a range. */
  let needsRange = $derived(gif && source.duration > GIF_LONGEST);
  let exported = $derived(ranged ? range : whole());
  let length = $derived(exported.end - exported.start);
  let frames = $derived(frameCount(length, chosen.gifFrameRate));

  // Choosing GIF for a long project starts a range at the playhead, as long as a GIF can be; a range already chosen is cut to fit.
  $effect(() => {
    if (!gif) return;
    if (needsRange && !ranged) {
      const start = Math.max(0, Math.min(playhead ?? 0, source.duration - GIF_LONGEST));
      range = { start, end: start + GIF_LONGEST };
      ranged = true;
    } else if (ranged && range.end - range.start > GIF_LONGEST) {
      range = { ...range, end: range.start + GIF_LONGEST };
    }
  });

  /** Moves one end of the range, keeping it in the project, at least the shortest, and, for a GIF, no longer than one can be. */
  function setRange(end: "start" | "end", time: number) {
    const longest = gif ? GIF_LONGEST : Infinity;
    if (end === "start") {
      const start = Math.min(Math.max(time, 0), source.duration - SHORTEST);
      range = { start, end: Math.min(Math.max(range.end, start + SHORTEST), start + longest) };
    } else {
      const to = Math.max(Math.min(time, source.duration), SHORTEST);
      range = { start: Math.max(Math.min(range.start, to - SHORTEST), to - longest), end: to };
    }
  }

  /** The text typed for each end, until it's read back when the field is left. */
  function typed(end: "start" | "end", event: Event & { currentTarget: HTMLInputElement }) {
    const time = parseTimecode(event.currentTarget.value);
    if (time !== null) setRange(end, time);
    event.currentTarget.value = formatTimecode(range[end]);
  }

  /** About how big the GIF will be, measured from a few short stretches of it; null while it's measured. */
  let estimate = $state<number | null>(null);
  $effect(() => {
    if (!gif || phase !== "settings") return;
    const settings = $state.snapshot(chosen);
    const within = { ...exported };
    estimate = null;
    const abort = new AbortController();
    // Waits for the settings to stop changing.
    const timer = setTimeout(() => {
      estimateGifSize(source, settings, within, abort.signal).then(
        (bytes) => (estimate = bytes),
        (failure) => {
          if (!abort.signal.aborted) console.error("[export] estimate", failure);
        },
      );
    }, 400);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  });

  onMount(() => dialog.showModal());
  onDestroy(() => controller?.abort());

  async function start() {
    const abort = (controller = new AbortController());
    phase = "exporting";
    progress = null;
    remaining = null;
    /** When the first frame was done: time left is told from there, as getting ready takes a while. */
    let first: { time: number; done: number } | null = null;
    let file: ExportFile | null = null;
    try {
      const path = await window.chord.desktop.export.create(
        projectFolder(project),
        project.name,
        format?.extension ?? "gif",
      );
      file = await openExportFile(path);
      const within = ranged ? $state.snapshot(range) : null;
      await (format ? exportVideo : exportGif)(source, $state.snapshot(chosen), file.writable, {
        range: within,
        signal: abort.signal,
        onProgress(done, total) {
          progress = done / total;
          first ??= { time: performance.now(), done };
          const elapsed = (performance.now() - first.time) / 1000;
          remaining = elapsed > 2 ? ((total - done) * elapsed) / (done - first.done) : null;
        },
      });
      // A GIF has no sound, so no transcript.
      if (format)
        await window.chord.desktop.export.captions(
          path,
          captionCues($state.snapshot(source.captions ?? []), within ?? undefined),
        );
      await file.close(true);
      saved = path;
      phase = "done";
      onexported();
    } catch (failure) {
      await file?.close(false).catch(() => {});
      if (abort.signal.aborted) {
        phase = "settings";
      } else {
        console.error("[export]", failure);
        error = failure instanceof Error ? failure.message : String(failure);
        phase = "failed";
      }
    } finally {
      if (controller === abort) controller = null;
    }
  }

  /** Escape or a backdrop click stops an export before the dialog can close. */
  function oncancel(event: Event) {
    if (phase !== "exporting") return;
    event.preventDefault();
    controller?.abort();
  }
</script>

<dialog
  bind:this={dialog}
  closedby="any"
  class="m-auto w-[26rem] max-w-[calc(100%-2rem)] overflow-visible rounded-xl border border-glass-800 bg-popover p-5 text-neutral-200 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 backdrop:bg-black/50"
  aria-labelledby="export-title"
  {oncancel}
  onclose={afterExit(onclose)}
>
  <h2 id="export-title" class="text-sm font-medium text-neutral-100">
    {(gif ? GIF_TITLES : TITLES)[phase]}
  </h2>

  {#if phase === "settings"}
    <div class="mt-3">
      <div class={row}>
        <span class={label}>File type</span>
        <div class="w-36">
          <Select compact label="File type" options={FILE_TYPES} bind:value={chosen.format} />
        </div>
      </div>
      <div class={row}>
        <span class={label}>Aspect ratio</span>
        <div class="w-36">
          <Select
            compact
            label="Aspect ratio"
            options={EXPORT_ASPECTS}
            bind:value={chosen.aspect}
          />
        </div>
      </div>
      {#if gif}
        <div class={row}>
          <span class={label}>Width</span>
          <Segmented label="Width" options={GIF_WIDTHS} bind:value={chosen.gifWidth} />
        </div>
        <div class={row}>
          <span class={label}>Frame rate</span>
          <Segmented
            label="Frame rate"
            options={GIF_FRAME_RATES}
            bind:value={chosen.gifFrameRate}
          />
        </div>
        <div class={row}>
          <span class={label}>Loop</span>
          <Toggle label="Loop" bind:checked={chosen.loop} />
        </div>
      {:else}
        <div class={row}>
          <span class={label}>Resolution</span>
          <Segmented
            label="Resolution"
            options={EXPORT_RESOLUTIONS}
            bind:value={chosen.resolution}
          />
        </div>
        <div class={row}>
          <span class={label}>Frame rate</span>
          <Segmented
            label="Frame rate"
            options={EXPORT_FRAME_RATES}
            bind:value={chosen.frameRate}
          />
        </div>
      {/if}
      <div class={row}>
        <span class={label}>Burn in captions</span>
        <Toggle
          label="Burn in captions"
          disabled={!source.captions?.length}
          bind:checked={() => chosen.captions ?? false, (value) => (chosen.captions = value)}
        />
      </div>
      {#if format?.transparency}
        <div class={row}>
          <span class={label}>Transparent background</span>
          <Toggle label="Transparent background" bind:checked={chosen.transparent} />
        </div>
      {/if}
      <div class={row}>
        <span class={label}>Range</span>
        <Toggle label="Range" disabled={needsRange} bind:checked={ranged} />
      </div>
      {#if ranged}
        {#each ENDS as [end, name] (end)}
          <div class={row}>
            <span class={label}>{name}</span>
            {#if playhead !== null}
              <button
                class="h-7 rounded-md px-2.5 text-xs text-glass-400 hover:bg-glass-800 hover:text-neutral-100"
                onclick={() => setRange(end, playhead!)}>Set to playhead</button
              >
            {/if}
            <input
              class="h-7 w-20 rounded-md border border-glass-800 bg-transparent px-2 text-right text-xs text-neutral-100 tabular-nums outline-none focus:border-glass-600"
              aria-label={`${name} time`}
              value={formatTimecode(range[end])}
              spellcheck="false"
              onchange={(event) => typed(end, event)}
              onkeydown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </div>
        {/each}
      {/if}
      {#if format}
        <p class="py-2 text-xs text-glass-500">
          Transcript, SRT and VTT files are saved alongside the video.
        </p>
      {/if}
    </div>
    <div class="mt-4 flex items-center gap-2">
      <div
        class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 text-xs text-glass-500 tabular-nums"
        data-export-summary
      >
        <span>{size.width} × {size.height}</span>
        {#if ranged}<span>{formatDuration(Math.round(length))}</span>{/if}
        {#if gif}
          <span>{frames} frames</span>
          <span>{estimate === null ? "Estimating size" : `About ${formatBytes(estimate)}`}</span>
        {/if}
      </div>
      <button
        class="h-8 rounded-md px-3 text-xs text-glass-400 hover:bg-glass-800 hover:text-neutral-100"
        onclick={() => dialog.close()}>Cancel</button
      >
      <button
        class="h-8 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-hover"
        onclick={start}>Export</button
      >
    </div>
  {:else if phase === "exporting"}
    <ProgressBar class="mt-4" value={progress} label="Export progress" />
    <div class="mt-2 flex items-center gap-3 text-xs text-glass-400 tabular-nums">
      <span class="flex-1">{progress === null ? "Preparing" : `${percent}%`}</span>
      {#if remaining !== null}<span>{formatDuration(Math.ceil(remaining))} left</span>{/if}
    </div>
    <div class="mt-4 flex justify-end">
      <button
        class="h-8 rounded-md px-3 text-xs text-glass-400 hover:bg-glass-800 hover:text-neutral-100"
        onclick={() => controller?.abort()}>Cancel</button
      >
    </div>
  {:else if phase === "done"}
    <p class="mt-2 truncate text-xs text-glass-400">{saved?.split("/").at(-1)}</p>
    <div class="mt-4 flex items-center justify-end gap-2">
      <button
        class="flex h-8 items-center gap-1.5 rounded-md px-3 text-xs text-glass-300 hover:bg-glass-800 hover:text-neutral-100"
        onclick={() => saved && void window.chord.desktop.export.reveal(saved)}
      >
        <Icon name="folder" class="size-3.5" />
        Show in Finder
      </button>
      <button
        class="h-8 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-hover"
        onclick={() => dialog.close()}>Done</button
      >
    </div>
  {:else}
    <p class="mt-2 text-xs text-red-400">{error}</p>
    <div class="mt-4 flex items-center justify-end gap-2">
      <button
        class="h-8 rounded-md px-3 text-xs text-glass-400 hover:bg-glass-800 hover:text-neutral-100"
        onclick={() => dialog.close()}>Close</button
      >
      <button
        class="h-8 rounded-lg bg-glass-800 px-4 text-xs font-medium text-neutral-100 hover:bg-glass-700"
        onclick={() => (phase = "settings")}>Back</button
      >
    </div>
  {/if}
</dialog>
