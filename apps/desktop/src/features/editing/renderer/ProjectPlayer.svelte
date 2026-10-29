<script lang="ts" module>
  /**
   * The preview's own volume, speed and shape, kept while the player is rebuilt. They don't change what's exported.
   */
  const preview = $state({ volume: 1, muted: false, rate: 1, shape: "Original" });
  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
  /** Shapes the stage can be shown at. Original is the recording's own; Fill takes whatever space there is. */
  const SHAPES: { label: string; aspect?: number }[] = [
    { label: "Original" },
    { label: "Fill" },
    { label: "16:9", aspect: 16 / 9 },
    { label: "4:3", aspect: 4 / 3 },
    { label: "1:1", aspect: 1 },
    { label: "4:5", aspect: 4 / 5 },
    { label: "9:16", aspect: 9 / 16 },
  ];
</script>

<script lang="ts">
  import { projectEdits } from "./edits.ts";
  import { onDestroy, onMount, untrack } from "svelte";
  import { on } from "svelte/events";
  import { pointerDrag } from "@teamblocks.dev/chord-ui/pointerDrag";
  import type { BackgroundState } from "#features/background-removal/contracts/backgroundRemoval";
  import { cameraBackgrounds } from "#media-engine/renderer/background";
  import { recordingBackdrops, type FeedPlacement } from "#media-engine/renderer/stage";
  import type { FeedFraming } from "../domain/clipLayout.ts";
  import { ClipLayoutEditor } from "./layout/clipLayoutEditor.ts";
  import {
    DEFAULT_CAPTION_SETTINGS,
    type CaptionLength,
    type CaptionSettings,
    type CaptionStyle,
    type TranscriptionState,
  } from "#features/transcription/domain/captions";
  import { editedAnnotations, type Cut } from "../domain/cuts.ts";
  import { audioGain, audioLevel } from "../domain/audioSettings.ts";
  import type { NoiseState } from "#features/audio-processing/contracts/noiseReduction";
  import { audioSources } from "#media-engine/renderer/audioSources";
  import { editedVisualLayers, visualLayersOf } from "../domain/visualLayers.ts";
  import type { TranscriptCut, TranscriptPlayback } from "#media-engine/renderer/transcript";
  import { projectCaptions } from "#media-engine/renderer/captions";
  import type { ExportSource } from "#features/exporting/renderer/exporter";
  import { videoPieces as projectVideoPieces, videoSource } from "#media-engine/renderer/source";
  import { renderStill } from "#features/exporting/renderer/still";
  import { formatDuration } from "#shared/domain/format";
  import { CutEditor } from "./transcript/cutEditor.svelte.ts";
  import { Player, type PlayerPiece } from "#media-engine/renderer/player.svelte";
  import type { Part } from "#media-engine/renderer/timeline";
  import { projectFolder, totalDuration } from "#project-document/renderer/projects.svelte";
  import type { Project } from "#project-document/domain/recording";
  import type { EditorView, WorkspaceSelection } from "./selection.ts";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import Menu from "@teamblocks.dev/chord-ui/Menu.svelte";
  import MenuAction from "@teamblocks.dev/chord-ui/MenuAction.svelte";
  import MenuItem from "@teamblocks.dev/chord-ui/MenuItem.svelte";
  import PanelResize from "@teamblocks.dev/chord-ui/PanelResize.svelte";
  import ProjectTracks from "./timeline/ProjectTracks.svelte";
  import { pressed, shortcutLabel } from "#features/settings/renderer/shortcuts.svelte";
  import VideoSequence from "./timeline/VideoSequence.svelte";
  import Slider from "@teamblocks.dev/chord-ui/Slider.svelte";

  /**
   * Plays what `view` shows: the project's video, pieces of its recordings placed on one timeline, or one recording on
   * its own on its original timeline, skipping cuts unless sought into. `current` is the recording playing. `expanded` gives the video the whole editor,
   * with the tracks hidden.
   */
  let {
    project,
    view,
    initialTime = 0,
    selected = $bindable(null),
    current = $bindable(null),
    playback = $bindable({ parts: [], time: 0, ready: false }),
    expanded = $bindable(false),
    transcripts = {},
    backgroundStates = {},
    noiseStates = {},
    captions = $bindable(true),
    onrecord,
    onopen,
    onvideo,
    ondeleteRecording,
    onframe,
  }: {
    project: Project;
    view: EditorView;
    selected?: WorkspaceSelection | null;
    playback?: TranscriptPlayback;
    transcripts?: Record<string, TranscriptionState>;
    backgroundStates?: Record<string, BackgroundState>;
    noiseStates?: Record<string, NoiseState>;
    captions?: boolean;
    current?: string | null;
    expanded?: boolean;
    onrecord?: () => void;
    /** Where the video first opens, on the project's edited timeline. */
    initialTime?: number;
    /** Opens a recording on its own, at `time` on its own timeline. */
    onopen?: (recordingId: string, time: number) => void;
    /** Goes back to the video from a recording on its own. */
    onvideo?: () => void;
    ondeleteRecording?: (recordingId: string) => void;
    /** A frame was saved to the project's Exports folder. */
    onframe?: () => void;
  } = $props();

  /** The stage's `border`, in pixels. It's laid out around the video, so it's drawn within the panel, never over its edges. */
  const BORDER = 1;
  /** How far the arrow keys skip, in seconds. */
  const SKIP = 5;
  let workspaceHeight = $state(600);
  let videoHeight = $state<number | null>(null);
  let stageWidth = $state(480);
  let stageHeight = $state(300);
  let videoMin = $derived(Math.min(180, Math.max(88, workspaceHeight * 0.45)));
  let videoMax = $derived(Math.max(videoMin, workspaceHeight - 140));
  let videoDefault = $derived(Math.min(360, workspaceHeight * 0.44));
  let videoSize = $derived(Math.min(Math.max(videoHeight ?? videoDefault, videoMin), videoMax));

  const layoutEditor = new ClipLayoutEditor(() => project);

  let screen: HTMLVideoElement;
  let canvas: HTMLCanvasElement;
  let camera: HTMLVideoElement;
  let audio: HTMLAudioElement;
  let player = $state<Player | null>(null);
  const cutEditor = new CutEditor({
    project: () => project,
    player: () => player,
    recordingId: () => (view.type === "recording" ? view.recordingId : undefined),
  });

  const recordings = $derived(
    new Map(project.recordings.map((recording) => [recording.id, recording])),
  );
  /** The recording being edited on its own. */
  const editing = $derived(
    view.type === "recording" ? recordings.get(view.recordingId) : undefined,
  );
  /** Each recording's effects where they play in the video, once its cuts close up. */
  const videoAnnotations = $derived(
    new Map(
      project.recordings.map((recording) => [
        recording.id,
        editedAnnotations(recording.annotations, recording.cuts ?? []),
      ]),
    ),
  );
  const videoLayers = $derived(
    new Map(
      project.recordings.map((recording) => [
        recording.id,
        editedVisualLayers(visualLayersOf(recording), recording.cuts ?? []),
      ]),
    ),
  );
  const captionSettings = $derived<CaptionSettings>(project.captions ?? DEFAULT_CAPTION_SETTINGS);
  const CAPTION_STYLES: { value: CaptionStyle; label: string }[] = [
    { value: "lines", label: "Lines" },
    { value: "highlight", label: "Highlight" },
    { value: "word", label: "Word" },
  ];
  const CAPTION_LENGTHS: { value: CaptionLength; label: string }[] = [
    { value: "short", label: "Short" },
    { value: "medium", label: "Medium" },
    { value: "long", label: "Long" },
  ];

  /** What the video plays: the edit, each piece with its recording's cuts left out. */
  function videoPieces(): PlayerPiece[] {
    return projectVideoPieces(project);
  }

  /** What the player plays for `view`. A recording on its own plays whole, as recorded, skipping what's cut. */
  function arrangement(): PlayerPiece[] {
    return view.type === "video"
      ? videoPieces()
      : editing
        ? [{ id: editing.id, recordingId: editing.id, start: 0, end: null }]
        : [];
  }

  function updateCaptions(patch: Partial<CaptionSettings>): void {
    projectEdits.setCaptions(project, { ...captionSettings, ...patch });
  }

  let lead = $derived(player?.lead);
  let aspect = $derived.by(() => {
    if (preview.shape === "Fill" && stageWidth > BORDER * 2 && stageHeight > BORDER * 2) {
      return (stageWidth - BORDER * 2) / (stageHeight - BORDER * 2);
    }
    return (
      SHAPES.find((shape) => shape.label === preview.shape)?.aspect ?? player?.aspect ?? 16 / 9
    );
  });

  $effect(() => {
    player?.frame(aspect);
  });

  $effect(() => {
    current = player?.part?.recordingId ?? null;
  });

  $effect(() => {
    playback = {
      parts: view.type === "recording" ? cutEditor.keptParts : (player?.parts ?? []),
      time: player?.time ?? 0,
      ready: !!player && !player.loading && !player.error,
      canUndoCut: cutEditor.canUndo,
      timeline: editing ? player?.timeline(editing.id) : undefined,
    };
  });

  $effect(() => {
    if (!player) return;
    player.volume = preview.volume;
    player.muted = preview.muted;
    player.rate = preview.rate;
  });

  // A recording on its own skips what's cut from it as it plays.
  $effect(() => {
    if (player) player.skips = editing ? $state.snapshot(editing.cuts ?? []) : [];
  });

  $effect(() => {
    if (player) {
      player.audioLevels = (recordingId, kind, index) =>
        audioLevel(recordings.get(recordingId)?.audio, kind, index);
      player.audioGains = (recordingId, kind, index) =>
        audioGain(recordings.get(recordingId)?.audio, kind, index);
      player.audioSources = audioSources(project.recordings, noiseStates);
    }
  });

  // While the video plays, effects show where they are once cuts close up. A recording's own tracks set them while
  // it's edited, as they're drawn there.
  $effect(() => {
    const annotations = videoAnnotations;
    const layers = videoLayers;
    if (player && view.type === "video")
      player.annotations = (recordingId) => annotations.get(recordingId);
    if (player && view.type === "video") player.layers = (recordingId) => layers.get(recordingId);
  });

  // A recording on its own shows every feed it recorded; the video shows each piece's layout.
  $effect(() => {
    if (player) player.showsEveryFeed = view.type === "recording";
  });

  /**
   * The feed under the pointer, while the clip on the stage is the one selected: it's moved by dragging it there and
   * zoomed by scrolling over it. `at` is the pointer in canvas pixels.
   */
  function feedAt(
    event: MouseEvent,
  ):
    | { pieceId: string; part: Part; placement: FeedPlacement; at: { x: number; y: number } }
    | undefined {
    const part = player?.part;
    if (
      view.type !== "video" ||
      selected?.type !== "piece" ||
      !part ||
      part.pieceId !== selected.pieceId
    )
      return;
    const bounds = canvas.getBoundingClientRect();
    const at = {
      x: ((event.clientX - bounds.left) * canvas.width) / bounds.width,
      y: ((event.clientY - bounds.top) * canvas.height) / bounds.height,
    };
    // Later feeds are drawn over earlier ones, so the last one under the pointer is the one seen.
    const placement = player!.placements.findLast(
      ({ frame }) =>
        at.x >= frame.x &&
        at.x <= frame.x + frame.width &&
        at.y >= frame.y &&
        at.y <= frame.y + frame.height,
    );
    return placement && { pieceId: part.pieceId, part, placement, at };
  }
  function feedOf(pieceId: string, part: Part, id: string): FeedFraming {
    return layoutEditor.feed(pieceId, part.timeline.video ?? [], id);
  }
  function reframe(pieceId: string, part: Part, id: string, patch: Partial<FeedFraming>): void {
    layoutEditor.updateFeed(pieceId, part.timeline.video ?? [], id, patch);
  }
  /**
   * The focal point that puts an image `length` long at `position` in a cell from `start` that's `room` long. An image
   * the cell's length can't move along it, so it keeps `fallback`.
   */
  const focal = (
    position: number,
    start: number,
    room: number,
    length: number,
    fallback: number,
  ) =>
    Math.abs(room - length) < 1
      ? fallback
      : Math.min(Math.max((position - start) / (room - length), 0), 1);

  /** Set once a press moves a feed, so letting go doesn't also play or pause. */
  let moved = false;
  let dragging = $state(false);
  let grabbable = $state(false);
  const grab = pointerDrag((event) => {
    moved = false;
    const target = event.button === 0 ? feedAt(event) : undefined;
    if (!target) return;
    const {
      pieceId,
      part,
      placement: { id, cell, image },
    } = target;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    dragging = true;
    return {
      move: (_event, delta) => {
        const dx = delta.x * scale,
          dy = delta.y * scale;
        if (!moved && Math.hypot(dx, dy) < 3 * scale) return;
        moved = true;
        // The image follows the pointer, as far as its frame lets it.
        const feed = feedOf(pieceId, part, id);
        reframe(pieceId, part, id, {
          x: focal(image.x + dx, cell.x, cell.width, image.width, feed.x),
          y: focal(image.y + dy, cell.y, cell.height, image.height, feed.y),
        });
      },
      end: () => {
        dragging = false;
      },
    };
  });
  /** Zooms the feed under the pointer, keeping the point under it in place. */
  function zoom(event: WheelEvent): void {
    const target = feedAt(event);
    if (!target) return;
    event.preventDefault();
    const {
      pieceId,
      part,
      placement: { id, cell, image, framing },
      at,
    } = target;
    const feed = feedOf(pieceId, part, id);
    const scale = Math.min(Math.max(feed.scale * Math.exp(-event.deltaY * 0.002), 1), 3);
    if (scale === feed.scale) return;
    // Measured from the frame last drawn, which may not show the latest zoom yet.
    const grow = scale / framing.scale;
    const [width, height] = [image.width * grow, image.height * grow];
    reframe(pieceId, part, id, {
      scale,
      x: focal(at.x - (at.x - image.x) * grow, cell.x, cell.width, width, feed.x),
      y: focal(at.y - (at.y - image.y) * grow, cell.y, cell.height, height, feed.y),
    });
  }

  /** What the player last played, and for which view. */
  let arranged = "";
  let shown = "";
  /** Where the video was, to go back to after editing a recording. */
  let videoTime = untrack(() => initialTime);
  // Edits play at once. Going to another view starts it from the start, or where it was asked to open.
  $effect(() => {
    const pieces = JSON.stringify(arrangement());
    const key = view.type === "video" ? "video" : view.recordingId;
    if (!player || player.loading || (pieces === arranged && key === shown)) return;
    const switched = key !== shown;
    if (switched && shown === "video") videoTime = untrack(() => player!.time);
    arranged = pieces;
    shown = key;
    const time = view.type === "recording" ? (view.time ?? 0) : videoTime;
    untrack(async () => {
      if (switched) player!.pause();
      await player!.arrange(JSON.parse(pieces));
      if (switched) await player!.seek(time);
    });
  });

  onMount(() => {
    const created = new Player({ screen, canvas, camera, audio });
    arranged = JSON.stringify(arrangement());
    shown = view.type === "video" ? "video" : view.recordingId;
    player = created;
    const recordings = project.recordings.flatMap(({ id, directory }) =>
      directory ? [{ id, directory }] : [],
    );
    if (project.recordings.length > 0)
      void created.load(
        recordings,
        JSON.parse(arranged),
        window.chord.desktop.recording.load,
        view.type === "recording" ? (view.time ?? 0) : videoTime,
      );
    else created.loading = false;
    return () => created.destroy();
  });

  $effect(() => {
    if (player) player.backgrounds = cameraBackgrounds(project.recordings, backgroundStates);
  });
  $effect(() => {
    if (player) player.backdrops = recordingBackdrops(project.recordings);
  });

  $effect(() => {
    if (!player) return;
    player.captionStyle = project.captions?.style ?? DEFAULT_CAPTION_SETTINGS.style;
    player.captions = captions
      ? projectCaptions(player.parts, project.recordings, transcripts, project.captions)
      : [];
  });

  export async function seekTranscript(time: number): Promise<void> {
    if (player && !player.loading) await player.seek(time);
  }

  export function toggleTranscript(): void {
    if (player && !player.loading) player.toggle();
  }

  /** Cuts stretches of the recording being edited, on session time, as one edit. */
  export async function cutTranscript(recordingId: string, ranges: TranscriptCut[]): Promise<void> {
    cutEditor.cut(recordingId, ranges);
  }

  /** Puts cut transcript words back where they were spoken. */
  export async function restoreTranscript(
    recordingId: string,
    start: number,
    end: number,
  ): Promise<void> {
    cutEditor.restore(recordingId, start, end);
  }

  /** Replaces what's cut from a recording, as an edit that can be undone. */
  export function recut(recordingId: string, cuts: Cut[]): void {
    cutEditor.recut(recordingId, cuts);
  }

  export function undoTranscriptCut(): void {
    cutEditor.undo();
  }

  /** The video, to export, whichever view is shown. Null until there's something loaded to export. */
  export function exportSource(): ExportSource | null {
    if (!player || player.loading || player.error) return null;
    const { parts, duration } = player.sequence(videoPieces());
    if (parts.length === 0) return null;
    return videoSource(
      $state.snapshot(project) as Project,
      { parts, duration, aspect: player.aspect },
      transcripts,
      backgroundStates,
      $state.snapshot(noiseStates),
    );
  }

  /** Where the playhead is on the video's timeline, which exports use; null while a recording plays on its own. */
  export function videoPlayhead(): number | null {
    return player && !player.loading && view.type === "video" ? player.time : null;
  }

  /** The frame action under way, while its still is drawn and saved or copied. */
  let framing = $state<"copy" | "save" | null>(null);
  /** Whether the last frame was just saved or copied, shown on its button for a moment. */
  let framed = $state(false);
  let frameError = $state("");
  let frameTimer: ReturnType<typeof setTimeout> | undefined;
  /** A frame can be taken wherever the video leads with a picture. */
  const canFrame = $derived(
    !!player &&
      !player.loading &&
      !player.error &&
      !!player.part &&
      (lead === "screen" || lead === "camera"),
  );

  /**
   * Saves or copies a still of the frame showing now, shaped as the preview is and at the leading video's pixels. The
   * moment is taken as asked, so it's that frame even if the video plays on while the still is drawn.
   */
  async function takeFrame(action: "copy" | "save"): Promise<void> {
    if (!player || !canFrame || framing) return;
    const source = player.source();
    const time = player.time;
    framing = action;
    framed = false;
    frameError = "";
    clearTimeout(frameTimer);
    try {
      const png = await renderStill(source, time, aspect, captions);
      if (action === "copy") {
        await window.chord.desktop.export.copyFrame(png);
      } else {
        await window.chord.desktop.export.saveFrame(
          projectFolder(project),
          project.name,
          time,
          png,
        );
        onframe?.();
      }
      framed = true;
      frameTimer = setTimeout(() => (framed = false), 1500);
    } catch (failure) {
      console.error("[frame]", failure);
      frameError = failure instanceof Error ? failure.message : String(failure);
      frameTimer = setTimeout(() => (frameError = ""), 5000);
    } finally {
      framing = null;
    }
  }

  onDestroy(() => clearTimeout(frameTimer));

  /** With nothing recorded yet, an empty state takes the whole editor in place of the video. */
  let empty = $derived(project.recordings.length === 0);
  let unplayable = $derived(!player?.parts.length || player.loading);
  let silent = $derived(preview.muted || preview.volume === 0);
  /** The captions button only appears once something is transcribed. */
  let transcribed = $derived(
    Object.values(transcripts).some((state) => state.transcript?.cues.length),
  );

  /** Escape leaves the expanded video, caught before it would leave the project. */
  function onEscape(event: KeyboardEvent) {
    if (
      event.key !== "Escape" ||
      !expanded ||
      event.defaultPrevented ||
      document.querySelector("dialog:modal")
    )
      return;
    expanded = false;
    event.preventDefault();
  }

  function onKeyDown(event: KeyboardEvent) {
    const frame = pressed(event, "copyFrame")
      ? "copy"
      : pressed(event, "saveFrame")
        ? "save"
        : null;
    if (frame) {
      const target = event.target;
      const typing =
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable) ||
        (target instanceof HTMLInputElement && target.type !== "range");
      if (typing || event.defaultPrevented || document.querySelector("dialog:modal")) return;
      event.preventDefault();
      void takeFrame(frame);
      return;
    }
    if (!player?.parts.length || event.defaultPrevented || document.querySelector("dialog:modal"))
      return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.closest("[data-inspector]") || target instanceof HTMLSelectElement)
    )
      return;
    if (
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    )
      return;
    if (target instanceof HTMLInputElement && target.type !== "range") return;
    // Other sliders keep the arrows to change their own value.
    const skips =
      !(target instanceof HTMLInputElement) || target.hasAttribute("data-playback-position");
    if (
      pressed(event, "playPause") &&
      !(target instanceof HTMLButtonElement && event.code === "Space")
    )
      player.toggle();
    else if (!skips) return;
    else if (pressed(event, "skipBack")) void player.seek(player.time - SKIP);
    else if (pressed(event, "skipForward")) void player.seek(player.time + SKIP);
    else return;
    event.preventDefault();
  }
</script>

<svelte:window onkeydown={onKeyDown} onkeydowncapture={onEscape} />

{#snippet frameItems(close: () => void)}
  {#each [{ action: "copy", label: "Copy frame", keys: shortcutLabel("copyFrame") }, { action: "save", label: "Save frame", keys: shortcutLabel("saveFrame") }] as const as item (item.action)}
    <MenuAction
      detail={item.keys}
      onclick={() => {
        close();
        void takeFrame(item.action);
      }}>{item.label}</MenuAction
    >
  {/each}
{/snippet}

{#snippet captionItems()}
  <MenuItem multiple selected={captions} onclick={() => (captions = !captions)}>Captions</MenuItem>
  {#if captions}
    <div class="px-2 pt-1.5 pb-0.5 text-[11px] text-glass-500">Style</div>
    {#each CAPTION_STYLES as { value, label } (value)}
      <MenuItem
        selected={captionSettings.style === value}
        onclick={() => updateCaptions({ style: value })}>{label}</MenuItem
      >
    {/each}
    {#if captionSettings.style !== "word"}
      <div class="px-2 pt-1.5 pb-0.5 text-[11px] text-glass-500">Line length</div>
      {#each CAPTION_LENGTHS as { value, label } (value)}
        <MenuItem
          selected={captionSettings.length === value}
          onclick={() => updateCaptions({ length: value })}>{label}</MenuItem
        >
      {/each}
    {/if}
  {/if}
{/snippet}

<div
  class="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
  bind:clientHeight={workspaceHeight}
>
  <section
    class={[
      "flex min-h-0 min-w-0 flex-col overflow-hidden",
      expanded || empty ? "flex-1" : "shrink-0",
    ]}
    style:height={expanded || empty ? undefined : `${videoSize}px`}
    aria-label="Video panel"
  >
    {#if empty}
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h2 class="text-sm font-medium text-neutral-100">No recordings yet</h2>
        <button
          class="flex h-8 items-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-semibold text-white transition hover:bg-primary-hover active:scale-[0.98]"
          onclick={() => onrecord?.()}
        >
          <Icon name="plus" class="size-3.5" />
          New recording
        </button>
      </div>
    {/if}
    <!-- Kept while empty, hidden, so the player has its elements. -->
    <div class={["flex min-h-0 flex-1", empty && "hidden"]}>
      <div
        class="flex min-h-0 min-w-0 flex-1 items-center justify-center"
        bind:clientWidth={stageWidth}
        bind:clientHeight={stageHeight}
      >
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          class={[
            "relative box-content shrink-0 overflow-hidden border border-white/10 bg-black shadow-lg shadow-black/20",
            dragging ? "cursor-grabbing" : grabbable && "cursor-grab",
          ]}
          style:aspect-ratio={aspect}
          style:width={`min(calc(100% - ${BORDER * 2}px), ${(stageHeight - BORDER * 2) * aspect}px)`}
          onclick={() => {
            if (!moved) player?.toggle();
            moved = false;
          }}
          {@attach grab}
          onpointermove={(event) => {
            if (!dragging) grabbable = !!feedAt(event);
          }}
          onpointerleave={() => (grabbable = false)}
          {@attach (element) => on(element, "wheel", zoom, { passive: false })}
          data-player
        >
          <!-- Frame sources for the canvas: in the document so they keep decoding, but not shown. -->
          <video
            bind:this={screen}
            class="pointer-events-none absolute size-px opacity-0"
            muted
            playsinline
            preload="auto"
          ></video>
          <video
            bind:this={camera}
            class="pointer-events-none absolute size-px opacity-0"
            muted
            playsinline
            preload="auto"
          ></video>
          <audio bind:this={audio} preload="auto"></audio>
          <canvas bind:this={canvas} class="absolute inset-0 size-full"></canvas>
          {#if lead === "microphone" || lead === "systemAudio"}
            <div class="absolute inset-0 flex items-center justify-center text-glass-600">
              <Icon
                name={lead === "microphone" ? "mic" : "speaker"}
                class="size-10"
                strokeWidth={1.5}
              />
            </div>
          {/if}
          {#if player?.error}
            <div
              class="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-glass-400"
            >
              {player.error}
            </div>
          {:else if player?.loading}
            <div class="absolute inset-0 flex items-center justify-center text-sm text-glass-500">
              Loading…
            </div>
          {/if}
        </div>
      </div>
    </div>

    <div class={["flex h-10 shrink-0 items-center gap-2 px-3 pb-1", empty && "hidden"]}>
      <button
        class="flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-100 transition hover:bg-glass-800 disabled:opacity-40"
        disabled={unplayable}
        onclick={() => player?.toggle()}
        aria-label={player?.playing ? "Pause" : "Play"}
      >
        <Icon name={player?.playing ? "pause" : "play"} class="size-4" />
      </button>
      <Slider
        neutral
        class="min-w-0 flex-1 @max-[360px]:hidden"
        min={0}
        max={player?.duration ?? 0}
        step="0.01"
        value={player?.time ?? 0}
        disabled={unplayable}
        aria-label="Playback position"
        data-playback-position
        oninput={(event) => {
          if (!player) return;
          player.scrubbing = true;
          void player.seek(event.currentTarget.valueAsNumber);
        }}
        onchange={() => player && (player.scrubbing = false)}
      />
      <span class="hidden flex-1 @max-[360px]:block"></span>
      <span class="shrink-0 text-xs text-glass-400 tabular-nums">
        {formatDuration(player?.time ?? 0)}<span class="@max-[400px]:hidden">
          / {formatDuration(
            player && !player.loading ? player.duration : totalDuration(project),
          )}</span
        >
      </span>
      <div class="flex shrink-0 items-center @max-[480px]:hidden">
        <button
          class="flex size-7 shrink-0 items-center justify-center rounded-md text-glass-300 transition hover:bg-glass-800 hover:text-neutral-100"
          onclick={() => {
            if (silent) Object.assign(preview, { muted: false, volume: preview.volume || 1 });
            else preview.muted = true;
          }}
          aria-label={silent ? "Unmute" : "Mute"}
        >
          <Icon
            name={silent ? "speakerOff" : preview.volume < 0.5 ? "speakerLow" : "speaker"}
            class="size-4"
          />
        </button>
        <Slider
          neutral
          class="w-16 @max-[520px]:hidden"
          min={0}
          max={1}
          step="0.01"
          value={preview.muted ? 0 : preview.volume}
          aria-label="Volume"
          oninput={(event) =>
            Object.assign(preview, { muted: false, volume: event.currentTarget.valueAsNumber })}
        />
      </div>
      {#if transcribed}
        <div class="@max-[480px]:hidden">
          <Menu side="top" align="end" class="min-w-40">
            {#snippet trigger({ toggle, open })}
              <button
                class={[
                  "flex size-7 shrink-0 items-center justify-center rounded-md transition hover:bg-glass-800 hover:text-neutral-100",
                  open && "bg-glass-800",
                  captions || open ? "text-neutral-100" : "text-glass-500",
                ]}
                onclick={toggle}
                aria-label="Captions"
                aria-haspopup="menu"
                aria-expanded={open}
              >
                <Icon name="captions" class="size-4" />
              </button>
            {/snippet}
            {#snippet children()}
              {@render captionItems()}
            {/snippet}
          </Menu>
        </div>
      {/if}
      <div class="@max-[480px]:hidden">
        <Menu side="top" align="end" class="min-w-32">
          {#snippet trigger({ toggle, open })}
            <button
              class={[
                "flex h-7 min-w-10 shrink-0 items-center justify-center rounded-md px-1.5 text-xs tabular-nums transition hover:bg-glass-800 hover:text-neutral-100",
                open ? "bg-glass-800 text-neutral-100" : "text-glass-300",
              ]}
              onclick={toggle}
              aria-label="Playback speed"
              aria-haspopup="menu"
              aria-expanded={open}
            >
              {preview.rate}×
            </button>
          {/snippet}
          {#snippet children({ close })}
            {#each RATES as rate (rate)}
              <MenuItem
                selected={preview.rate === rate}
                onclick={() => {
                  preview.rate = rate;
                  close();
                }}>{rate}×</MenuItem
              >
            {/each}
          {/snippet}
        </Menu>
      </div>
      <div class="@max-[480px]:hidden">
        <Menu side="top" align="end" class="min-w-32">
          {#snippet trigger({ toggle, open })}
            <button
              class={[
                "flex h-7 min-w-10 shrink-0 items-center justify-center rounded-md px-1.5 text-xs tabular-nums transition hover:bg-glass-800 hover:text-neutral-100",
                open ? "bg-glass-800 text-neutral-100" : "text-glass-300",
              ]}
              onclick={toggle}
              aria-label="Aspect ratio"
              aria-haspopup="menu"
              aria-expanded={open}
            >
              {preview.shape}
            </button>
          {/snippet}
          {#snippet children({ close })}
            {#each SHAPES as shape (shape.label)}
              <MenuItem
                selected={preview.shape === shape.label}
                onclick={() => {
                  preview.shape = shape.label;
                  close();
                }}>{shape.label}</MenuItem
              >
            {/each}
          {/snippet}
        </Menu>
      </div>
      <div class="hidden shrink-0 @max-[480px]:block">
        <Menu side="top" align="end" class="max-h-72 min-w-44">
          {#snippet trigger({ toggle, open })}
            <button
              class={[
                "flex size-7 items-center justify-center rounded-md transition hover:bg-glass-800 hover:text-neutral-100",
                open ? "bg-glass-800 text-neutral-100" : "text-glass-300",
              ]}
              onclick={toggle}
              aria-label="More controls"
              aria-haspopup="menu"
              aria-expanded={open}
            >
              <Icon name="more" class="size-4" />
            </button>
          {/snippet}
          {#snippet children({ close })}
            <MenuItem
              multiple
              selected={silent}
              onclick={() => {
                if (silent) Object.assign(preview, { muted: false, volume: preview.volume || 1 });
                else preview.muted = true;
              }}>Mute</MenuItem
            >
            {#if transcribed}
              <div role="separator" class="mx-2 my-[5px] h-px bg-glass-800"></div>
              {@render captionItems()}
            {/if}
            <div role="separator" class="mx-2 my-[5px] h-px bg-glass-800"></div>
            {#each RATES as rate (rate)}
              <MenuItem selected={preview.rate === rate} onclick={() => (preview.rate = rate)}
                >{rate}×</MenuItem
              >
            {/each}
            <div role="separator" class="mx-2 my-[5px] h-px bg-glass-800"></div>
            {#each SHAPES as shape (shape.label)}
              <MenuItem
                selected={preview.shape === shape.label}
                onclick={() => (preview.shape = shape.label)}>{shape.label}</MenuItem
              >
            {/each}
            {#if canFrame && !framing}
              <div role="separator" class="mx-2 my-[5px] h-px bg-glass-800"></div>
              {@render frameItems(close)}
            {/if}
          {/snippet}
        </Menu>
      </div>
      {#if frameError}
        <span
          class="max-w-48 min-w-0 truncate text-xs text-red-400 @max-[480px]:hidden"
          role="alert"
          title={frameError}>{frameError}</span
        >
      {/if}
      <div class="@max-[480px]:hidden">
        <Menu side="top" align="end" class="min-w-44">
          {#snippet trigger({ toggle, open })}
            <button
              class={[
                "flex size-7 shrink-0 items-center justify-center rounded-md transition hover:bg-glass-800 hover:text-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent",
                open ? "bg-glass-800 text-neutral-100" : "text-glass-300",
              ]}
              disabled={!canFrame || !!framing}
              onclick={toggle}
              aria-label="Frame"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-busy={!!framing}
            >
              <Icon name={framed ? "check" : "photo"} class="size-4" />
            </button>
          {/snippet}
          {#snippet children({ close })}
            {@render frameItems(close)}
          {/snippet}
        </Menu>
      </div>
      <button
        class={[
          "flex size-7 shrink-0 items-center justify-center rounded-md transition hover:bg-glass-800 hover:text-neutral-100",
          expanded ? "text-neutral-100" : "text-glass-300",
        ]}
        onclick={() => (expanded = !expanded)}
        aria-label={expanded ? "Exit expanded video" : "Expand video"}
        aria-pressed={expanded}
      >
        <Icon name={expanded ? "collapse" : "expand"} class="size-4" />
      </button>
    </div>
  </section>

  {#if !expanded && !empty}
    <PanelResize
      orientation="horizontal"
      label="Video panel height"
      value={videoSize}
      min={videoMin}
      max={videoMax}
      defaultValue={videoDefault}
      onresize={(value) => (videoHeight = value)}
    />
  {/if}

  <!-- Hidden rather than removed when expanded, so the tracks keep their scroll and zoom. -->
  <section
    class={["@container min-h-0 min-w-0 flex-1 overflow-hidden", (expanded || empty) && "hidden"]}
    aria-label="Track panel"
  >
    {#if player}
      {#if view.type === "video"}
        <VideoSequence
          {player}
          {project}
          {noiseStates}
          bind:selected
          {onopen}
          {ondeleteRecording}
        />
      {:else}
        <ProjectTracks {player} {project} {view} bind:selected {onvideo} oncuts={recut} />
      {/if}
    {/if}
  </section>
</div>
