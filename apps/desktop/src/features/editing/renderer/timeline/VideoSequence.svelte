<script lang="ts">
  import { projectEdits } from "#features/editing/renderer/edits";
  import { onDestroy, untrack } from "svelte";
  import { recordedPiece, toRecorded } from "../../domain/cuts.ts";
  import type { Piece } from "#project-document/domain/recording";
  import { formatDuration } from "#shared/domain/format";
  import type { Player } from "#media-engine/renderer/player.svelte";
  import {
    layersOf,
    lengthOf,
    marksOf,
    splitAt,
    toRecording,
    type Part,
  } from "#media-engine/renderer/timeline";
  import { clipSourcePath } from "#media-engine/renderer/clipSource";
  import type { NoiseState } from "#features/audio-processing/contracts/noiseReduction";
  import { audioSources } from "#media-engine/renderer/audioSources";
  import { WaveformCache } from "#media-engine/renderer/waveform";

  import { RECORDING_DRAG_TYPE, type WorkspaceSelection } from "../selection.ts";
  import type { Project } from "#project-document/domain/recording";
  import AudioWaveform from "./AudioWaveform.svelte";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import MenuAction from "@teamblocks.dev/chord-ui/MenuAction.svelte";
  import { openContextMenu, type MenuEntry } from "@teamblocks.dev/chord-ui/contextMenu.svelte";
  import { mac, pressed, shortcutLabel } from "#features/settings/renderer/shortcuts.svelte";
  import { bindingLabel } from "#features/settings/domain/shortcuts";
  import RecordingActions from "../RecordingActions.svelte";
  import TimelineRuler from "./TimelineRuler.svelte";
  import TimelineFooter from "./TimelineFooter.svelte";
  import { TIMELINE_END_PAD as END_PAD, TimelineViewport } from "./viewport.svelte.ts";

  /**
   * The project's video as a sequence: clips of its recordings, one after another on one track, never overlapping.
   * Pressing a clip selects it, and its menu cuts it in two at the playhead when that's over it. Dragging a clip moves
   * it elsewhere in the order, and dragging its ends trims it, moving what's after it along. Recordings dragged in from
   * the sidebar go in where they're dropped, and double-clicking a clip edits its recording there.
   */
  let {
    player,
    project,
    noiseStates = {},
    selected = $bindable(null),
    onopen,
    ondeleteRecording,
  }: {
    player: Player;
    project: Project;
    selected?: WorkspaceSelection | null;
    /** The main process's noise reduction state by recording folder, for the waveform of what plays. */
    noiseStates?: Record<string, NoiseState>;
    /** Opens a recording on its own, at `time` on its own timeline. */
    onopen?: (recordingId: string, time: number) => void;
    ondeleteRecording?: (recordingId: string) => void;
  } = $props();

  /** How far the pointer moves before a press on a clip is a drag, in pixels. */
  const DRAG_THRESHOLD = 3;
  /** The shortest clip trimming or cutting leaves, in seconds. */
  const SHORTEST_CLIP = 0.2;
  /** A clip's two ends, which trim it. */
  const SIDES = ["start", "end"] as const;
  /** Each recording's clips share a color, so where they came from shows at a glance. */
  const COLORS = [
    { clip: "border-sky-400/50 bg-sky-500/25 text-sky-50", waveform: "text-sky-600/50" },
    {
      clip: "border-violet-400/50 bg-violet-500/25 text-violet-50",
      waveform: "text-violet-600/50",
    },
    {
      clip: "border-emerald-400/50 bg-emerald-500/25 text-emerald-50",
      waveform: "text-emerald-600/50",
    },
    { clip: "border-amber-400/50 bg-amber-500/25 text-amber-50", waveform: "text-amber-600/50" },
    { clip: "border-rose-400/50 bg-rose-500/25 text-rose-50", waveform: "text-rose-600/50" },
    { clip: "border-teal-400/50 bg-teal-500/25 text-teal-50", waveform: "text-teal-600/50" },
  ];

  const waveforms = new WaveformCache();
  /** The waveform is of the audio that plays: a track's cleaned copy when noise reduction is on. */
  const sourceOf = $derived(audioSources(project.recordings, noiseStates));
  onDestroy(() => waveforms.dispose());

  /** A press on a clip: moving it in the order, or trimming one of its ends. */
  interface Press {
    type: "move" | "start" | "end";
    part: Part;
    clientX: number;
    moved: boolean;
  }

  let width = $state(0);
  const timeline = new TimelineViewport({
    player: () => player,
    width: () => width,
    horizontal: true,
    clampSeek: true,
  });
  const scale = $derived(timeline.scale);
  const scrollLeft = $derived(timeline.scrollLeft);
  const x = timeline.x;
  const timeAt = timeline.timeAt;
  let press: Press | null = null;
  /** The clips while one is dragged, in order; saved when the drag ends. */
  let draft = $state<Part[] | null>(null);
  /** The clip being moved and where it is, following the pointer, in pixels. */
  let floating = $state<{ pieceId: string; left: number } | null>(null);
  /** The clip end under the pointer or being dragged, so it's clear which clip a trim changes. */
  let edge = $state<{ pieceId: string; side: "start" | "end" } | null>(null);
  /** Where a recording dragged from the sidebar would go in, as an index into the clips. */
  let dropIndex = $state<number | null>(null);

  let clips = $derived(laidOut(draft ?? player.parts));
  let total = $derived(clips.reduce((sum, part) => sum + lengthOf(part), 0));
  /** Marks added while recording, where the clips play them; a clip being moved takes its marks along. */
  let marks = $derived(
    marksOf(clips).map((mark) => {
      const moving =
        floating?.pieceId === mark.pieceId
          ? clips.find((part) => part.pieceId === mark.pieceId)
          : undefined;
      return {
        ...mark,
        left: x(mark.time) + (moving && floating ? floating.left - x(moving.offset) : 0),
      };
    }),
  );
  let ready = $derived(!player.loading);
  let selectedId = $derived(selected?.type === "piece" ? selected.pieceId : undefined);
  /** Recordings that can go in the video. */
  let recordings = $derived(
    project.recordings.flatMap((recording, index) =>
      recording.directory ? [{ recording, index }] : [],
    ),
  );
  // A drag's result shows until the player has it, so the clips don't jump back for a moment.
  $effect(() => {
    void player.parts;
    untrack(() => {
      if (!press) draft = null;
    });
  });

  // A selected clip that's gone is no longer selected.
  $effect(() => {
    const current = selected;
    if (current?.type === "piece" && !player.parts.some((part) => part.pieceId === current.pieceId))
      selected = null;
  });

  /** `parts` one after another, in order. */
  function laidOut(parts: Part[]): Part[] {
    let offset = 0;
    return parts.map((part) => {
      const placed = { ...part, offset };
      offset += lengthOf(part);
      return placed;
    });
  }

  function labelOf(recordingId: string): string {
    return `Recording ${project.recordings.findIndex((recording) => recording.id === recordingId) + 1}`;
  }

  function colorOf(recordingId: string): (typeof COLORS)[number] {
    return COLORS[
      Math.max(
        0,
        project.recordings.findIndex((recording) => recording.id === recordingId),
      ) % COLORS.length
    ]!;
  }

  function partAt(time: number): Part | undefined {
    return clips.find((part) => time >= part.offset && time < part.offset + lengthOf(part));
  }

  /** Where something dropped at `time` goes in the order: before the first clip whose middle is after it. */
  function indexAt(parts: Part[], time: number): number {
    const index = parts.findIndex((part) => time < part.offset + lengthOf(part) / 2);
    return index < 0 ? parts.length : index;
  }

  // MARK: Saving

  /** Saves `parts`, in order, back on their recordings' own timelines, with what's cut from them in place. */
  function arrange(parts: Part[]): void {
    projectEdits.setPieces(project, parts.map(pieceOf));
  }

  function pieceOf(part: Part): Piece {
    const cuts =
      project.recordings.find((recording) => recording.id === part.recordingId)?.cuts ?? [];
    return recordedPiece<Piece>(
      {
        id: part.pieceId,
        recordingId: part.recordingId,
        start: part.start,
        end: part.end,
        ...(part.cameraLayout && { cameraLayout: part.cameraLayout }),
        ...(part.layout && { layout: part.layout }),
      },
      cuts,
      part.timeline.duration,
    );
  }

  /** Puts a whole recording in at `index` in the order. */
  function insert(recordingId: string, index = clips.length): void {
    const pieces = clips.map(pieceOf);
    pieces.splice(index, 0, { id: crypto.randomUUID(), recordingId, start: 0, end: null });
    projectEdits.setPieces(project, pieces);
  }

  function remove(pieceId: string): void {
    if (selectedId === pieceId) selected = null;
    arrange(clips.filter((part) => part.pieceId !== pieceId));
  }

  /** Cuts the clip at `time` in two there. */
  function cut(time: number): void {
    const part = partAt(time);
    const parts = part && splitAt(clips, part.pieceId, time, crypto.randomUUID(), SHORTEST_CLIP);
    if (parts) arrange(parts);
  }

  // MARK: Clips

  /** Pressing a clip selects it, ready to move it or, on one of its ends, trim it. */
  function onClipDown(event: PointerEvent & { currentTarget: HTMLElement }, part: Part): void {
    if (
      event.button !== 0 ||
      !ready ||
      scale <= 0 ||
      (event.target as HTMLElement).closest("button, [role=menu]")
    )
      return;
    selected = { type: "piece", pieceId: part.pieceId };
    event.currentTarget.setPointerCapture(event.pointerId);
    const side = (event.target as HTMLElement).dataset.edge as "start" | "end" | undefined;
    press = { type: side ?? "move", part, clientX: event.clientX, moved: false };
  }

  function onClipMove(event: PointerEvent): void {
    if (!press || (!press.moved && Math.abs(event.clientX - press.clientX) < DRAG_THRESHOLD))
      return;
    press.moved = true;
    const shift = (event.clientX - press.clientX) / scale;
    const held = press.part;
    if (press.type === "move") {
      const others = laidOut(player.parts.filter((other) => other.pieceId !== held.pieceId));
      const left = Math.max(0, held.offset + shift);
      floating = { pieceId: held.pieceId, left: x(left) };
      // It goes in where the pointer is.
      const index = indexAt(others, timeAt(event));
      draft = [...others.slice(0, index), held, ...others.slice(index)];
      return;
    }
    // Trimming moves what's after the clip along; the clip's start stays where it is on the track.
    const trimmed =
      press.type === "start"
        ? { ...held, start: Math.min(Math.max(held.start + shift, 0), held.end - SHORTEST_CLIP) }
        : {
            ...held,
            end: Math.max(
              Math.min(held.end + shift, held.timeline.duration),
              held.start + SHORTEST_CLIP,
            ),
          };
    draft = player.parts.map((other) => (other.pieceId === held.pieceId ? trimmed : other));
  }

  function onClipUp(event: PointerEvent): void {
    const ended = press;
    const result = draft;
    press = null;
    floating = null;
    // The pointer had the clip, so the end it's left over lights up now.
    const over = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-edge]");
    const pieceId = over?.closest<HTMLElement>("[data-clip]")?.dataset.clip;
    edge = over && pieceId ? { pieceId, side: over.dataset.edge as "start" | "end" } : null;
    if (
      ended?.moved &&
      result &&
      (result.length !== player.parts.length || result.some((part, i) => part !== player.parts[i]))
    )
      arrange(result);
    else draft = null;
  }

  /** Pressing the track area off the clips clears the selection. */
  function onTrackDown(event: PointerEvent): void {
    if (
      event.button === 0 &&
      !(event.target as HTMLElement).closest("[data-clip], button, [aria-label='Track position']")
    )
      selected = null;
  }

  /** Edits the recording under the pointer there. */
  function onTrackDoubleClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest("button")) return;
    const time = timeAt(event);
    const part = partAt(time);
    if (!part) return;
    const cuts =
      project.recordings.find((recording) => recording.id === part.recordingId)?.cuts ?? [];
    onopen?.(
      part.recordingId,
      toRecorded(cuts, Math.min(Math.max(toRecording(part, time), part.start), part.end), "start"),
    );
  }

  /** A clip's actions, the same from its menu button and a right-click. */
  function clipActions(part: Part): MenuEntry[] {
    const time = player.time;
    const canSplit = !!splitAt(clips, part.pieceId, time, "", SHORTEST_CLIP);
    const recording = project.recordings.find((recording) => recording.id === part.recordingId);
    const reveal = clipSourcePath(recording?.directory ?? null, part);
    const present = () => clips.some((clip) => clip.pieceId === part.pieceId);
    return [
      ...(canSplit
        ? [
            {
              label: "Split at playhead",
              icon: "scissors",
              detail: shortcutLabel("split"),
              onselect: () => {
                if (present()) cut(time);
              },
            } satisfies MenuEntry,
          ]
        : []),
      {
        label: "Edit recording",
        icon: "pencil",
        onselect: () =>
          onopen?.(part.recordingId, toRecorded(recording?.cuts ?? [], part.start, "start")),
      },
      "separator",
      {
        label: "Remove from video",
        icon: "minus",
        detail: bindingLabel("Backspace", mac),
        onselect: () => {
          if (present()) remove(part.pieceId);
        },
      },
      "separator",
      {
        label: "Show in folder",
        icon: "folder",
        disabled: !reveal,
        onselect: () => {
          if (reveal) void window.chord.desktop.recording.reveal(reveal);
        },
      },
      ...(ondeleteRecording
        ? ([
            "separator",
            {
              label: "Delete recording",
              icon: "trash",
              destructive: true,
              onselect: () => ondeleteRecording(part.recordingId),
            },
          ] satisfies MenuEntry[])
        : []),
    ];
  }

  function onContextMenu(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest("[role=menu]")) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-clip]");
    const part = element && clips.find((clip) => clip.pieceId === element.dataset.clip);
    if (!part) return;
    selected = { type: "piece", pieceId: part.pieceId };
    openContextMenu(event, clipActions(part));
  }

  // MARK: Dropping recordings

  function onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes(RECORDING_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    dropIndex = scale > 0 ? indexAt(clips, timeAt(event)) : clips.length;
  }

  function onDragLeave(event: DragEvent): void {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null))
      dropIndex = null;
  }

  function onDrop(event: DragEvent): void {
    const recordingId = event.dataTransfer?.getData(RECORDING_DRAG_TYPE);
    const index = dropIndex;
    dropIndex = null;
    if (!recordingId || !project.recordings.some((recording) => recording.id === recordingId))
      return;
    event.preventDefault();
    insert(recordingId, index ?? clips.length);
  }

  /** Where the dropped recording goes in, in pixels. */
  let dropX = $derived(dropIndex === null ? null : x(clips[dropIndex]?.offset ?? total));

  function onKeyDown(event: KeyboardEvent): void {
    if (!timeline.acceptsShortcut(event)) return;
    const command = event.metaKey || event.ctrlKey;
    if (pressed(event, "split")) cut(player.time);
    else if (command || !selectedId) return;
    else if (event.key === "Backspace" || event.key === "Delete") remove(selectedId);
    else if (event.key === "Escape") selected = null;
    else return;
    event.preventDefault();
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#snippet recordingItems(close: () => void)}
  {#each recordings as { recording, index } (recording.id)}
    <MenuAction
      detail={formatDuration(recording.duration)}
      onclick={() => {
        insert(recording.id);
        close();
      }}>Recording {index + 1}</MenuAction
    >
  {/each}
{/snippet}

<div
  class="flex h-full min-h-0 flex-col"
  data-tracks
  data-sequence
  role="group"
  aria-label="Video tracks"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={timeline.viewport}
    bind:clientWidth={width}
    class="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-none bg-glass-900 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    onscroll={timeline.onScroll}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    {@attach timeline.wheel}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="relative flex h-full min-w-full flex-col"
      onpointerdown={onTrackDown}
      style:width={`${x(Math.max(total, player.duration)) + END_PAD}px`}
    >
      <TimelineRuler
        {timeline}
        {marks}
        {ready}
        duration={total}
        class="relative h-7 shrink-0 border-b border-glass-800 select-none"
      >
        {#if clips.length}
          <div
            class="pointer-events-none absolute top-0 z-20 -ml-[5px] h-2.5 w-[11px] rounded-b-sm bg-white"
            style:left={`${x(player.time)}px`}
          ></div>
        {/if}
      </TimelineRuler>

      <!-- Clips are selected, moved and trimmed with the pointer; their menu cuts them at the playhead. -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        bind:this={timeline.content}
        class="relative mt-3 h-16 shrink-0 select-none"
        ondblclick={onTrackDoubleClick}
        oncontextmenu={onContextMenu}
        role="list"
        aria-label="Video"
        data-sequence-track
      >
        {#each clips as part (part.pieceId)}
          {@const moving = floating?.pieceId === part.pieceId}
          {@const left = floating && moving ? floating.left : x(part.offset)}
          {@const clipWidth = lengthOf(part) * scale}
          {@const label = labelOf(part.recordingId)}
          {@const color = colorOf(part.recordingId)}
          <div
            role="listitem"
            class={[
              "group/recording absolute inset-y-0 flex overflow-hidden rounded-md border text-[11px]",
              color.clip,
              selectedId === part.pieceId && "ring-2 ring-white/70 ring-inset",
              edge?.pieceId === part.pieceId && "brightness-125",
              // Only a reorder slides the other clips over; a trim moves them with the pointer.
              moving
                ? "z-10 cursor-grabbing opacity-90 shadow-lg shadow-black/50"
                : floating && "transition-[left] duration-150",
            ]}
            style:left={`${left + 1}px`}
            style:width={`${Math.max(clipWidth - 2, 4)}px`}
            title={`${label}  ${formatDuration(lengthOf(part))}`}
            onpointerdown={(event) => onClipDown(event, part)}
            onpointermove={onClipMove}
            onpointerup={onClipUp}
            onpointercancel={onClipUp}
            data-clip={part.pieceId}
            data-recording={part.recordingId}
          >
            <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div class="flex h-5 shrink-0 items-center gap-1 bg-black/20 px-2" data-clip-handle>
                <span class="clip-label min-w-0 flex-1 truncate font-medium">{label}</span>
                {#if ondeleteRecording && clipWidth > 40}
                  <RecordingActions {label} entries={() => clipActions(part)} side="top" compact />
                {/if}
              </div>
              <div class="relative min-h-0 flex-1">
                {#each layersOf(part).filter((layer) => layer.kind === "microphone" || layer.kind === "systemAudio") as layer (`${layer.kind}:${layer.index}`)}
                  {#each layer.blocks as block, i (i)}
                    {@const blockLeft = x(block.start - part.offset)}
                    {@const blockWidth = x(block.end - block.start)}
                    <div
                      class="pointer-events-none absolute inset-y-0"
                      style:left={`${blockLeft}px`}
                      style:width={`${blockWidth}px`}
                    >
                      <AudioWaveform
                        class={color.waveform}
                        cache={waveforms}
                        url={sourceOf(part.recordingId, layer.kind, layer.index, block.url)}
                        sourceStart={block.sourceStart}
                        duration={block.end - block.start}
                        width={blockWidth}
                        from={Math.max(0, scrollLeft - left - blockLeft)}
                        to={Math.min(blockWidth, scrollLeft + width - left - blockLeft)}
                      />
                    </div>
                  {/each}
                {/each}
                <span
                  class="clip-label pointer-events-none absolute inset-x-0 bottom-0 truncate px-2 pb-1.5 tabular-nums opacity-70"
                  >{formatDuration(lengthOf(part))}</span
                >
              </div>
            </div>
            {#if clipWidth > 16}
              {#each SIDES as side (side)}
                {@const active = edge?.pieceId === part.pieceId && edge.side === side}
                <!-- The end under the pointer lights up, so it's clear which of two clips side by side a trim changes. -->
                <div
                  class={[
                    "absolute inset-y-0 z-10 flex w-1.5 cursor-ew-resize",
                    side === "start" ? "left-0 justify-start" : "right-0 justify-end",
                  ]}
                  onpointerenter={() => {
                    if (!press) edge = { pieceId: part.pieceId, side };
                  }}
                  onpointerleave={() => {
                    if (!press && active) edge = null;
                  }}
                  data-edge={side}
                  data-edge-active={active || undefined}
                >
                  <div
                    class={[
                      "pointer-events-none h-full w-1 bg-white transition-opacity",
                      side === "start" ? "rounded-l-md" : "rounded-r-md",
                      active ? "opacity-100" : "opacity-0",
                    ]}
                  ></div>
                </div>
              {/each}
            {/if}
          </div>
        {/each}
        {#if dropX !== null && clips.length}
          <div
            class="pointer-events-none absolute -inset-y-1 z-20 -ml-px w-0.5 rounded bg-primary"
            style:left={`${dropX}px`}
            data-drop-indicator
          ></div>
        {/if}
        {#if clips.length === 0 && ready}
          <div
            class={[
              "absolute inset-0 flex items-center gap-3 rounded-md border border-dashed px-3",
              dropIndex !== null ? "border-primary bg-primary/10" : "border-glass-700",
            ]}
            data-sequence-empty
          >
            <span class="shrink-0 text-xs text-glass-400">Drop a recording here</span>
            <div class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
              {#each recordings as { recording, index } (recording.id)}
                <button
                  class="flex h-7 shrink-0 items-center gap-2 rounded-md bg-glass-800 px-2.5 text-xs text-neutral-200 hover:bg-glass-700"
                  onclick={() => insert(recording.id)}
                  aria-label={`Add recording ${index + 1} to the video`}
                >
                  <Icon name="plus" class="size-3 text-glass-400" />
                  Recording {index + 1}
                  <span class="text-glass-500 tabular-nums"
                    >{formatDuration(recording.duration)}</span
                  >
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      {#if clips.length}
        <div
          class="pointer-events-none absolute inset-y-0 left-0 z-30 w-px bg-white"
          style:transform={`translateX(${x(player.time)}px)`}
          data-playhead
        ></div>
      {/if}
    </div>
  </div>
  <TimelineFooter label="Add recording" disabled={!recordings.length}>
    {#snippet children({ close })}{@render recordingItems(close)}{/snippet}
  </TimelineFooter>
</div>

<style>
  .clip-label {
    text-shadow: 0 1px 2px rgb(0 0 0 / 70%);
  }
</style>
