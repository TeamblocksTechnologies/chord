<script lang="ts" module>
  import { projectEdits } from "#features/editing/renderer/edits";
  /** Whether dragged edges snap, kept while the app runs. */
  let snapping = $state(true);
</script>

<script lang="ts">
  import type { TrackKind } from "@teamblocks.dev/chord-recorder-protocol";
  import { onDestroy } from "svelte";
  import { noAnnotations, normalizeSpans, type AnnotationSpan } from "../../domain/annotations.ts";
  import { audioTrackSettings } from "../../domain/audioSettings.ts";
  import { cutEdgeBounds, moveCutEdge as moveEdge, type Cut } from "../../domain/cuts.ts";
  import {
    isAnnotationLayer,
    visualLayersOf,
    type AnnotationLayer,
    type EffectKind,
    type VisualLayer,
  } from "../../domain/visualLayers.ts";
  import {
    recordingTrackSections,
    type TrackRow,
    type TrackSection,
  } from "#media-engine/renderer/recordingTracks";
  import { appName } from "#features/recording/renderer/apps.svelte";
  import { formatDuration } from "#shared/domain/format";
  import type { Player } from "#media-engine/renderer/player.svelte";
  import { ANNOTATION_TOOLS, annotationTracksOf } from "#media-engine/renderer/annotations";
  import {
    groupLayersOf,
    lengthOf,
    marksOf,
    snap,
    spanBlocks,
    toProject,
    toRecording,
    type Block,
    type Part,
  } from "#media-engine/renderer/timeline";
  import { rulerLabel } from "#media-engine/renderer/ruler";
  import type { Project } from "#project-document/domain/recording";
  import {
    isSelectedTrack,
    selectedRecording,
    selectedTrack,
    selectedTrackIndex,
    selectedLayerId,
    type EditorView,
    type SelectedTrack,
    type WorkspaceSelection,
  } from "../selection.ts";
  import { WaveformCache } from "#media-engine/renderer/waveform";
  import AudioWaveform from "./AudioWaveform.svelte";
  import Icon, { type IconName } from "@teamblocks.dev/chord-ui/Icon.svelte";
  import MenuEntries from "@teamblocks.dev/chord-ui/MenuEntries.svelte";
  import { openContextMenu, type MenuEntry } from "@teamblocks.dev/chord-ui/contextMenu.svelte";
  import TimelineRuler from "./TimelineRuler.svelte";
  import TimelineFooter from "./TimelineFooter.svelte";
  import { TIMELINE_END_PAD as END_PAD, TimelineViewport } from "./viewport.svelte.ts";
  import { mac, pressed, withShortcut } from "#features/settings/renderer/shortcuts.svelte";
  import { bindingLabel } from "#features/settings/domain/shortcuts";

  /**
   * A recording on its own, on its own timeline. Its tracks are grouped by Screen, Camera, Microphone and System audio,
   * with annotations under Screen.
   * Cut overlays span all sections. Effect spans can be drawn, moved, resized
   * and removed if its mouse and keys were recorded. Edges snap to the playhead, marks, cuts' ends, effects' ends and presses.
   */
  let {
    player,
    project,
    view,
    selected = $bindable(null),
    onvideo,
    oncuts,
  }: {
    player: Player;
    project: Project;
    view: EditorView;
    selected?: WorkspaceSelection | null;
    /** Goes back to the video. */
    onvideo?: () => void;
    /** Replaces what's cut from a recording on its own. */
    oncuts?: (recordingId: string, cuts: Cut[]) => void;
  } = $props();

  const KINDS: Record<TrackKind, { label: string; icon: IconName; block: string; text: string }> = {
    screen: {
      label: "Screen",
      icon: "monitor",
      block: "border-sky-400/40 bg-sky-500/20",
      text: "text-sky-100",
    },
    camera: {
      label: "Camera",
      icon: "camera",
      block: "border-violet-400/40 bg-violet-500/20",
      text: "text-violet-100",
    },
    microphone: {
      label: "Microphone",
      icon: "mic",
      block: "border-emerald-400/40 bg-emerald-500/20",
      text: "text-emerald-100",
    },
    systemAudio: {
      label: "System audio",
      icon: "speaker",
      block: "border-amber-400/40 bg-amber-500/20",
      text: "text-amber-100",
    },
  };

  const EFFECTS = {
    laser: {
      ...ANNOTATION_TOOLS.laser,
      block: "border-rose-400/50 bg-rose-500/25",
      selected: "ring-rose-300",
    },
    clicks: {
      ...ANNOTATION_TOOLS.clicks,
      block: "border-blue-400/50 bg-blue-500/25",
      selected: "ring-blue-300",
    },
    keys: {
      ...ANNOTATION_TOOLS.keys,
      block: "border-fuchsia-400/50 bg-fuchsia-500/20",
      selected: "ring-fuchsia-300",
    },
    cursor: {
      ...ANNOTATION_TOOLS.cursor,
      block: "border-teal-400/50 bg-teal-500/20",
      selected: "ring-teal-300",
    },
  };
  /** How far the pointer moves before a press on an effect's layer is a drag, in pixels. */
  const DRAG_THRESHOLD = 3;
  /** The shortest span a drag makes, in seconds. */
  const SHORTEST_SPAN = 0.1;
  /** How close a dragged edge comes to something before it snaps there, in pixels. */
  const SNAP_DISTANCE = 8;

  /** A press on an effect's layer: drawing a span, or moving one or one of its edges. */
  type Drag = {
    kind: EffectKind;
    layerId: string;
    part: Part;
    /** Where the press was, on the recording's timeline. */
    from: number;
    clientX: number;
    moved: boolean;
    /** Where its edges snap, on the project's timeline. */
    targets: number[];
  } & ({ type: "draw" } | { type: "move" | "start" | "end"; index: number; span: AnnotationSpan });

  let viewportWidth = $state(0);
  let labelWidth = $state(0);
  let width = $derived(viewportWidth - labelWidth);
  const timeline = new TimelineViewport({
    player: () => player,
    width: () => width,
    labelWidth: () => labelWidth,
    resetKey: () => (view.type === "video" ? "video" : view.recordingId),
  });
  const scale = $derived(timeline.scale);
  const scrollLeft = $derived(timeline.scrollLeft);
  const x = timeline.x;
  const timeAt = timeline.timeAt;
  let drag: Drag | null = null;
  /** An effect's spans in one recording while they're dragged; saved when the drag ends. */
  let draft = $state<{
    recordingId: string;
    kind: EffectKind;
    layerId: string;
    spans: AnnotationSpan[];
  } | null>(null);
  /** What a dragged edge has snapped to, on the project's timeline. */
  let snapLine = $state<number | null>(null);

  const waveforms = new WaveformCache();
  onDestroy(() => waveforms.dispose());

  /** A cut's end being dragged in a recording on its own. */
  let cutDrag: {
    index: number;
    edge: "start" | "end";
    cut: Cut;
    clientX: number;
    moved: boolean;
    targets: number[];
  } | null = null;
  /** The recording's cuts while one's end is dragged; saved when the drag ends. */
  let cutDraft = $state<Cut[] | null>(null);
  /** What's cut from a recording on its own, as shown. */
  let cuts = $derived(
    cutDraft ??
      (view.type === "recording"
        ? (recordingOf(view.recordingId)?.cuts ?? []).filter((cut) => cut.start < player.duration)
        : []),
  );
  let annotationTracks = $derived(annotationTracksOf(player.parts, project));
  let missingTracks = $derived(annotationTracks.filter((track) => !track.added));
  let groups = $derived.by(() => {
    const byRecording = new Map<string, Part[]>();
    for (const part of player.parts)
      byRecording.set(part.recordingId, [...(byRecording.get(part.recordingId) ?? []), part]);
    return [...byRecording].map(([recordingId, parts]) => {
      const pieces = parts.map((part) => ({ part, shown: part }));
      const shown = pieces.map((piece) => piece.shown);
      const layers = groupLayersOf(shown);
      const visual = visualsOf(recordingId);
      const sections: TrackSection[] = recordingTrackSections(layers, visual);
      return {
        recordingId,
        pieces,
        sections,
        layers,
        // The earliest piece, where a layer without spans says how to add them.
        first: shown.reduce((a, b) => (b.offset < a.offset ? b : a)),
        // Effects can be drawn over recordings with the screen leading and the mouse and keys recorded.
        effects: visual.filter(isAnnotationLayer),
      };
    });
  });
  let ready = $derived(player.parts.length > 0 && !player.loading);
  /** Marks added while recording, on the project's timeline. */
  let marks = $derived(marksOf(player.parts));
  /** The recording selected and which of its tracks' settings are open, shown here as the inspector shows them. */
  let selectedRecordingId = $derived(selectedRecording(project, selected)?.id);
  let openTrack = $derived(selectedTrack(selected));
  /** Where the timeline's content ends, including what's trimmed off the end of pieces. */
  let extent = $derived(
    Math.max(
      player.duration,
      ...groups.flatMap(({ pieces }) =>
        pieces.map(({ shown }) => toProject(shown, shown.timeline.duration)),
      ),
    ),
  );
  /** Fade all track content inside cuts, leaving the playhead and draggable edges clear. */
  let cutMask = $derived(
    cuts.length
      ? `linear-gradient(to right, #000 0px, ${cuts
          .flatMap((cut) => [
            `#000 ${x(cut.start)}px`,
            `rgb(0 0 0 / 0.2) ${x(cut.start)}px`,
            `rgb(0 0 0 / 0.2) ${x(cut.end)}px`,
            `#000 ${x(cut.end)}px`,
          ])
          .join(", ")}, #000 100%)`
      : "none",
  );
  // The player draws a recording's effects as they're edited.
  $effect(() => {
    player.layers = visualsOf;
  });

  /**
   * Scrubbing from the ruler keeps the selection. The clips area never moves the playhead except by dragging it: a
   * press on a track selects its clip with that track's settings open, as pressing the clip itself does, and anywhere
   * else clears the selection.
   */
  function onPointerDown(event: PointerEvent & { currentTarget: HTMLElement }, select = false) {
    if (event.button !== 0 || !ready || scale <= 0) return;
    if (select && !(event.target as HTMLElement).closest("[data-playhead]")) {
      const track = trackAt(event);
      if (track) selected = track;
      else if ((event.target as HTMLElement).closest("[data-layer]")) deselect();
      else clearSelection();
      return;
    }
    timeline.startScrub(event, ready);
  }

  function trackAt(event: PointerEvent): WorkspaceSelection | null {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-layer]");
    if (!row) return null;
    const time = timeAt(event);
    const part = player.parts.find(
      (part) =>
        part.recordingId === row.dataset.layerRecording &&
        time >= part.offset &&
        time <= part.offset + lengthOf(part),
    );
    if (!part) return null;
    const kind = row.dataset.layer!;
    const trackIndex = Number(row.dataset.layerIndex ?? 0);
    return {
      type: "recording",
      recordingId: part.recordingId,
      ...(isSelectedTrack(kind) && {
        track: kind,
        trackIndex,
        ...(row.dataset.visualLayer && { layerId: row.dataset.visualLayer }),
      }),
    };
  }

  /** Opens a track's settings for the recording on its own. */
  function selectTrack(
    recordingId: string,
    track?: SelectedTrack,
    trackIndex = 0,
    layerId?: string,
  ): void {
    selected = track
      ? { type: "recording", recordingId, track, trackIndex, ...(layerId && { layerId }) }
      : { type: "recording", recordingId };
  }

  function addTrack(kind: EffectKind): void {
    if (
      view.type !== "recording" ||
      !missingTracks.some((track) => track.kind === kind && track.available)
    )
      return;
    const recording = recordingOf(view.recordingId);
    if (!recording) return;
    const layer = projectEdits.addAnnotationTrack(project, recording, kind);
    selectTrack(recording.id, kind, 0, layer.id);
  }

  /** The effect tracks that can be added, the same from Add track and a right-click on empty space. */
  function addTrackEntries(): MenuEntry[] {
    if (!missingTracks.length) return [{ note: "All effect tracks added" }];
    return missingTracks.map(({ kind, available }) => ({
      label: EFFECTS[kind].label,
      icon: EFFECTS[kind].icon,
      disabled: !available,
      title: available ? undefined : "Requires a screen recording with mouse and keyboard data",
      onselect: () => addTrack(kind),
    }));
  }

  function onContextMenu(event: MouseEvent): void {
    if (view.type !== "recording" || !ready) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-cut-edge], [data-playhead], [role=menu]")) return;
    const recordingId = view.recordingId;
    const recording = recordingOf(recordingId);
    if (!recording) return;
    const row = target.closest<HTMLElement>(
      "[data-layer], [data-layer-label], [data-effect], [data-effect-label]",
    );
    const effect = row?.dataset.effectLayer
      ? visualLayersOf(recording).find((layer) => layer.id === row.dataset.effectLayer)
      : undefined;
    const kind = row?.dataset.layer ?? row?.dataset.layerLabel;
    const index = Number(row?.dataset.layerIndex ?? 0);
    const spanIndex = Number(target.closest<HTMLElement>("[data-span]")?.dataset.span ?? -1);
    const file =
      target.closest<HTMLElement>("[data-file]")?.dataset.file ??
      groups
        .find((group) => group.recordingId === recordingId)
        ?.layers.find((layer) => layer.kind === kind && layer.index === index)?.blocks[0]?.file;
    const reveal = recording.directory
      ? file
        ? `${recording.directory}/${file}`
        : recording.directory
      : undefined;
    // Actions run against the recording as it is then, and only while it's still the one being edited.
    const editing = () => view.type === "recording" && view.recordingId === recordingId;
    const revealEntry: MenuEntry = {
      label: "Show in folder",
      icon: "folder",
      disabled: !reveal,
      onselect: () => {
        if (reveal) void window.chord.desktop.recording.reveal(reveal);
      },
    };
    let entries: MenuEntry[];
    if (effect && isAnnotationLayer(effect)) {
      const current = () => {
        const layer = editing()
          ? visualLayersOf(recording).find((layer) => layer.id === effect.id)
          : undefined;
        return layer && isAnnotationLayer(layer) ? layer : undefined;
      };
      const throughout =
        effect.spans.length === 1 &&
        effect.spans[0]!.start === 0 &&
        effect.spans[0]!.end === player.duration;
      entries = [
        // A recording draws one cursor.
        ...(effect.kind === "cursor"
          ? []
          : [
              {
                label: "Duplicate track",
                onselect: () => {
                  const layer = current();
                  if (!layer) return;
                  const copy = projectEdits.duplicateAnnotationTrack(
                    project,
                    recording,
                    layer,
                    EFFECTS[layer.kind].label,
                  );
                  selectTrack(recordingId, copy.kind, 0, copy.id);
                },
              } satisfies MenuEntry,
            ]),
        {
          label: "Enable throughout recording",
          disabled: player.duration <= 0 || throughout,
          onselect: () => {
            const layer = current();
            if (!layer) return;
            save(recordingId, layer.id, [{ start: 0, end: player.duration }]);
            selectTrack(recordingId, layer.kind, 0, layer.id);
          },
        },
        ...(effect.spans[spanIndex]
          ? [
              {
                label: "Remove span",
                detail: bindingLabel("Backspace", mac),
                onselect: () => {
                  const layer = current();
                  if (!layer) return;
                  save(
                    recordingId,
                    layer.id,
                    layer.spans.filter((_, i) => i !== spanIndex),
                  );
                  selectTrack(recordingId, layer.kind, 0, layer.id);
                },
              } satisfies MenuEntry,
            ]
          : []),
        "separator",
        {
          label: "Remove track",
          destructive: true,
          onselect: () => {
            const layer = current();
            if (!layer) return;
            projectEdits.setVisualLayers(
              project,
              recording,
              visualLayersOf(recording).filter((item) => item.id !== layer.id),
            );
            selectTrack(recordingId, "screen");
          },
        },
        "separator",
        revealEntry,
      ];
    } else if (kind === "microphone" || kind === "systemAudio") {
      const muted = audioTrackSettings(recording.audio, kind, index).muted;
      entries = [
        {
          label: muted ? "Unmute" : "Mute",
          icon: muted ? "speaker" : "speakerOff",
          onselect: () => {
            if (!editing()) return;
            projectEdits.setAudio(project, recording, kind, index, { muted: !muted });
          },
        },
        "separator",
        revealEntry,
      ];
    } else if (kind === "screen" || kind === "camera") {
      entries = [
        {
          label: "Track settings",
          icon: "sliders",
          onselect: () => {
            if (editing()) selectTrack(recordingId, kind, index, row?.dataset.visualLayer);
          },
        },
        "separator",
        revealEntry,
      ];
    } else {
      if (target.closest("button, [data-span]")) return;
      entries = addTrackEntries();
    }
    openContextMenu(event, entries);
  }

  /** Clears what's selected. A recording on its own keeps the track whose settings are open. */
  function deselect(): void {
    if (view.type !== "recording") {
      selected = null;
      return;
    }
    const track = selectedTrack(selected);
    selected = {
      type: "recording",
      recordingId: view.recordingId,
      ...(track && {
        track,
        trackIndex: selectedTrackIndex(selected),
        layerId: selectedLayerId(selected),
      }),
    };
  }

  /** Clears everything selected, including the open track; a recording on its own stays selected. */
  function clearSelection(): void {
    selected =
      view.type === "recording" ? { type: "recording", recordingId: view.recordingId } : null;
  }

  // MARK: Cuts

  /** Cut edges stop at each other; meeting removes the cut when the edit is saved. */
  function cutBounds(index: number, edge: "start" | "end"): { min: number; max: number } {
    return cutEdgeBounds(cuts, index, edge, player.duration);
  }

  function moveCutEdge(index: number, edge: "start" | "end", time: number): Cut[] {
    return moveEdge(cuts, index, edge, time, player.duration);
  }

  function onCutDown(
    event: PointerEvent & { currentTarget: HTMLElement },
    index: number,
    edge: "start" | "end",
  ) {
    if (event.button !== 0 || !ready || scale <= 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const cut = cuts[index]!;
    const targets = [
      cut[edge === "start" ? "end" : "start"],
      player.time,
      ...cuts.flatMap((other, i) => (i === index ? [] : [other.start, other.end])),
    ];
    for (const effect of groups[0]?.effects ?? [])
      for (const span of effect.spans) targets.push(span.start, span.end);
    for (const mark of marks) targets.push(mark.time);
    cutDrag = { index, edge, cut, clientX: event.clientX, moved: false, targets };
  }

  function onCutMove(event: PointerEvent) {
    if (!cutDrag) return;
    if (!cutDrag.moved && Math.abs(event.clientX - cutDrag.clientX) < DRAG_THRESHOLD) return;
    cutDrag.moved = true;
    const wanted = cutDrag.cut[cutDrag.edge] + (event.clientX - cutDrag.clientX) / scale;
    const next = moveCutEdge(
      cutDrag.index,
      cutDrag.edge,
      wanted + snapped([wanted], cutDrag.targets),
    );
    keepSnapLine([next[cutDrag.index]![cutDrag.edge]]);
    cutDraft = next;
  }

  function onCutUp() {
    const draft = cutDraft;
    const ended = cutDrag;
    cutDrag = null;
    snapLine = null;
    if (ended?.moved && draft && view.type === "recording") oncuts?.(view.recordingId, draft);
    cutDraft = null;
  }

  function onCutKey(event: KeyboardEvent, index: number, edge: "start" | "end") {
    if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || view.type !== "recording")
      return;
    event.preventDefault();
    event.stopPropagation();
    const step = (event.shiftKey ? 1 : 0.1) * (event.key === "ArrowLeft" ? -1 : 1);
    oncuts?.(view.recordingId, moveCutEdge(index, edge, cuts[index]![edge] + step));
  }

  // MARK: Snapping

  /**
   * Where an effect's edge dragged in `part` snaps: the playhead, marks, cuts' ends, the recording's ends, other effects' ends
   * and recorded presses on layers that are shown.
   */
  function snapTargets(part: Part, except?: { layerId: string; index: number }): number[] {
    const targets = [
      player.time,
      ...cuts.flatMap((cut) => [cut.start, cut.end]),
      ...marks.map((mark) => mark.time),
    ];
    for (const other of player.parts) targets.push(other.offset, other.offset + lengthOf(other));
    const effects = groups.find((group) => group.recordingId === part.recordingId)?.effects ?? [];
    for (const layer of effects) {
      layer.spans.forEach((span, index) => {
        if (except?.layerId !== layer.id || except.index !== index)
          targets.push(toProject(part, span.start), toProject(part, span.end));
      });
      if (layer.kind !== "laser")
        for (const press of part.timeline.input?.[layer.kind] ?? [])
          targets.push(toProject(part, press.time));
    }
    return targets;
  }

  /** How far to move dragged `edges`, on the project's timeline, to snap; shows where they snap. */
  function snapped(edges: number[], targets: number[]): number {
    const found = snapping && scale > 0 ? snap(edges, targets, SNAP_DISTANCE / scale) : undefined;
    snapLine = found?.at ?? null;
    return found?.shift ?? 0;
  }

  /** Hides where edges snapped once limits have moved them off it. */
  function keepSnapLine(edges: number[]): void {
    const line = snapLine;
    if (line !== null && !edges.some((edge) => Math.abs(edge - line) < 1e-6)) snapLine = null;
  }

  // MARK: Effects

  function recordingOf(recordingId: string) {
    return project.recordings.find((recording) => recording.id === recordingId);
  }

  /** Visual sources and effects, including the span under the pointer. */
  function visualsOf(recordingId: string): VisualLayer[] {
    const recording = recordingOf(recordingId);
    if (!recording) return [];
    const layers = visualLayersOf(recording);
    return draft?.recordingId === recordingId
      ? layers.map((layer) =>
          layer.id === draft!.layerId ? { ...layer, spans: draft!.spans } : layer,
        )
      : layers;
  }

  function effectSpans(recordingId: string, layerId: string): AnnotationSpan[] {
    const layer = visualsOf(recordingId).find((layer) => layer.id === layerId);
    return layer && isAnnotationLayer(layer) ? layer.spans : [];
  }

  function layerLabel(layer: VisualLayer): string {
    return isAnnotationLayer(layer)
      ? (layer.name ?? EFFECTS[layer.kind].label)
      : KINDS[layer.kind].label;
  }

  function rowLabel(row: TrackRow): string {
    if (row.type === "effect") return layerLabel(row.layer);
    return row.layer.window ? appName(row.layer.window.bundleId) : KINDS[row.layer.kind].label;
  }

  /** Ticks for the recorded presses an effect would show in a part, in view. */
  function eventTicks(kind: EffectKind, part: Part): number[] {
    if (kind === "laser" || kind === "cursor" || scale <= 0 || !part.timeline.input) return [];
    const [from, to] = [scrollLeft / scale, (scrollLeft + width) / scale];
    return part.timeline.input[kind]
      .filter((press) => press.time >= part.start && press.time <= part.end)
      .map((press) => toProject(part, press.time))
      .filter((time) => time >= from && time <= to);
  }

  /** An effect's spans where they play, cut where cuts close up. */
  function effectRuns(layer: AnnotationLayer, pieces: Part[]) {
    return spanBlocks(
      pieces,
      (id) => ({ ...noAnnotations(), [layer.kind]: effectSpans(id, layer.id) }),
      layer.kind,
    ).map((span) => ({ ...span, ...blockBox(span.start, span.end) }));
  }

  /** Draw edges at their timestamps, so adjacent blocks meet without an artificial gap. */
  function blockBox(start: number, end: number): { left: number; width: number } {
    return { left: x(start), width: Math.max((end - start) * scale, 0) };
  }

  /** Fade trimmed regions of one rounded shape without introducing corners at the cuts. */
  function trimMask(blocks: { start: number; end: number; trimmed?: boolean }[]): string {
    if (!blocks.some((block) => block.trimmed)) return "none";
    const start = blocks[0]!.start;
    const duration = blocks.at(-1)!.end - start;
    return `linear-gradient(to right, ${blocks
      .flatMap((block) => {
        const color = block.trimmed ? "rgb(0 0 0 / 0.2)" : "#000";
        return [block.start, block.end].map(
          (time) => `${color} ${((time - start) / duration) * 100}%`,
        );
      })
      .join(", ")})`;
  }

  /** One outline and name for all the played and trimmed regions of a source clip. */
  function namedRuns(blocks: Block[]) {
    const runs: { file: string; left: number; width: number; mask: string; blocks: Block[] }[] = [];
    let joined: Block[] = [];
    for (const block of blocks) {
      joined.push(block);
      if (!block.joinsAfter) {
        runs.push({
          file: block.file,
          ...blockBox(joined[0]!.start, block.end),
          mask: trimMask(joined),
          blocks: joined,
        });
        joined = [];
      }
    }
    return runs;
  }

  /** How far a block starting at `left` runs off the view's left edge, so its name can stay in view. */
  function hiddenStart(left: number): number {
    return Math.max(0, scrollLeft - left);
  }

  function isSelectedSpan(recordingId: string, layerId: string, index: number): boolean {
    return (
      selected?.type === "span" &&
      selected.recordingId === recordingId &&
      selectedLayerId(selected) === layerId &&
      selected.index === index
    );
  }

  function onEffectDown(
    event: PointerEvent & { currentTarget: HTMLElement },
    layer: AnnotationLayer,
    pieces: Part[],
  ) {
    const { kind, id: layerId } = layer;
    if (event.button !== 0 || !ready || scale <= 0) return;
    const time = timeAt(event);
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-span]");
    // A span is edited in the piece it's drawn in; elsewhere, a press draws in the piece under it.
    const part = target
      ? pieces.find((piece) => piece.pieceId === target.dataset.spanPiece)
      : pieces.find((piece) => time >= piece.offset && time <= piece.offset + lengthOf(piece));
    // Elsewhere, the press clears the selection like anywhere else on the tracks.
    if (!part) {
      deselect();
      return;
    }
    const local = toRecording(part, time);
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = target ? Number(target.dataset.span) : -1;
    const base = {
      kind,
      layerId,
      part,
      clientX: event.clientX,
      moved: false,
      from: Math.min(Math.max(local, part.start), part.end),
      targets: snapTargets(part, { layerId, index }),
    };
    if (target) {
      const span = effectSpans(part.recordingId, layerId)[index]!;
      const edge = (event.target as HTMLElement).dataset.edge as "start" | "end" | undefined;
      selected = { type: "span", recordingId: part.recordingId, kind, layerId, index };
      drag = { ...base, type: edge ?? "move", index, span: { ...span } };
    } else {
      selectTrack(part.recordingId, kind, 0, layerId);
      drag = { ...base, type: "draw" };
    }
  }

  function onEffectMove(event: PointerEvent) {
    if (!drag) return;
    if (!drag.moved && Math.abs(event.clientX - drag.clientX) < DRAG_THRESHOLD) return;
    drag.moved = true;
    const { part, kind, layerId } = drag;
    const { duration } = part.timeline;
    const local = toRecording(part, timeAt(event));
    const stored = (
      visualLayersOf(recordingOf(part.recordingId)!).find(
        (layer) => layer.id === layerId,
      ) as AnnotationLayer
    ).spans;
    let span: AnnotationSpan;
    if (drag.type === "move") {
      const length = drag.span.end - drag.span.start;
      const wanted = drag.span.start + Math.min(Math.max(local, part.start), part.end) - drag.from;
      const shift = snapped(
        [toProject(part, wanted), toProject(part, wanted + length)],
        drag.targets,
      );
      const start = Math.min(Math.max(wanted + shift, 0), duration - length);
      span = { start, end: start + length };
    } else {
      const now = Math.min(
        Math.max(local + snapped([toProject(part, local)], drag.targets), part.start),
        part.end,
      );
      if (drag.type === "draw")
        span = { start: Math.min(drag.from, now), end: Math.max(drag.from, now) };
      else if (drag.type === "start")
        span = { start: Math.min(now, drag.span.end - SHORTEST_SPAN), end: drag.span.end };
      else span = { start: drag.span.start, end: Math.max(now, drag.span.start + SHORTEST_SPAN) };
    }
    keepSnapLine([toProject(part, span.start), toProject(part, span.end)]);
    const dragged = drag.type === "draw" ? -1 : drag.index;
    const others = stored.filter((_, i) => i !== dragged);
    draft = { recordingId: part.recordingId, kind, layerId, spans: [...others, span] };
  }

  function onEffectUp() {
    const ended = drag;
    drag = null;
    snapLine = null;
    if (!ended) return;
    // A press without a drag only selects a span.
    if (!ended.moved) return;
    if (!draft) return;
    const changed = draft.spans.at(-1)!;
    const spans = normalizeSpans(draft.spans, ended.part.timeline.duration);
    draft = null;
    save(ended.part.recordingId, ended.layerId, spans);
    const index = spans.findIndex((span) => span.end >= changed.start && span.start <= changed.end);
    if (index >= 0)
      selected = {
        type: "span",
        recordingId: ended.part.recordingId,
        kind: ended.kind,
        layerId: ended.layerId,
        index,
      };
    else deselect();
  }

  function save(recordingId: string, layerId: string, spans: AnnotationSpan[]): void {
    const recording = recordingOf(recordingId);
    if (!recording) return;
    // Keep the layer after its final span is removed.
    projectEdits.setVisualLayers(
      project,
      recording,
      visualLayersOf(recording).map((layer) =>
        layer.id === layerId ? { ...layer, spans } : layer,
      ),
    );
  }

  function removeSelected(): void {
    const current = selected;
    if (current?.type !== "span") return;
    deselect();
    const { recordingId, index } = current;
    const layerId = selectedLayerId(current)!;
    const spans = effectSpans(recordingId, layerId);
    save(
      recordingId,
      layerId,
      spans.filter((_, i) => i !== index),
    );
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!timeline.acceptsShortcut(event)) return;
    if (pressed(event, "snapping")) snapping = !snapping;
    else if (!selected || selected.type === "recording") return;
    else if (event.key === "Backspace" || event.key === "Delete") removeSelected();
    else if (event.key === "Escape") deselect();
    else return;
    event.preventDefault();
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if groups.length > 0}
  <div
    class="flex h-full min-h-0 flex-col"
    data-tracks
    role="group"
    aria-label="Recording tracks"
    oncontextmenu={onContextMenu}
  >
    <div class="flex shrink-0 bg-glass-900" data-track-header>
      <div
        bind:offsetWidth={labelWidth}
        class="flex h-9 w-36 shrink-0 items-center border-r border-b border-glass-800 p-1 @max-[360px]:w-10"
      >
        {#if onvideo}
          <button
            class="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pr-2.5 pl-1.5 text-[11px] font-medium text-glass-400 transition hover:bg-glass-800 hover:text-neutral-100"
            onclick={onvideo}
            aria-label="Back to video"
            title="Back to video"
            data-back-to-video
          >
            <Icon name="arrowLeft" class="size-3 shrink-0" />
            <span class="truncate @max-[360px]:sr-only">Video</span>
          </button>
        {/if}
      </div>
      <TimelineRuler
        {timeline}
        {marks}
        {ready}
        duration={player.duration}
        pinned
        class="relative h-9 min-w-0 flex-1 overflow-hidden border-b border-glass-800 select-none"
      >
        <div
          class="playhead absolute inset-y-0 left-0 z-20 w-px cursor-ew-resize touch-none bg-white"
          style:transform={`translateX(${x(player.time) - scrollLeft}px)`}
          title="Drag to adjust time"
        >
          <div class="absolute top-0 -left-[5px] h-2.5 w-[11px] rounded-b-sm bg-white"></div>
        </div>
      </TimelineRuler>
    </div>
    <!-- One scroll container lets recording headers stick across both the labels and timeline. -->
    <div
      bind:this={timeline.viewport}
      bind:clientWidth={viewportWidth}
      class="min-h-0 flex-1 overflow-x-auto overflow-y-auto overscroll-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onscroll={timeline.onScroll}
      {@attach timeline.wheel}
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex min-h-full w-max min-w-full bg-glass-900"
        onpointerdown={(event) => {
          if (event.button === 0 && event.target === event.currentTarget) clearSelection();
        }}
      >
        <div
          class="sticky left-0 z-30 w-36 shrink-0 border-r border-glass-800 bg-neutral-900 @max-[360px]:w-10"
        >
          {#each groups as { recordingId, sections } (recordingId)}
            <div>
              {#each sections as section, sectionIndex (section.id)}
                <div
                  class={sectionIndex > 0 ? "border-t border-glass-700/60" : undefined}
                  data-track-section-label={section.id}
                >
                  {#each section.rows as row (row.id)}
                    {@const numbered =
                      row.type === "effect" && row.layer.name?.match(/^(.*) (\d+)$/)}
                    {@const active =
                      selectedRecordingId === recordingId &&
                      openTrack === row.layer.kind &&
                      (row.type === "effect"
                        ? selectedLayerId(selected) === row.id
                        : selectedTrackIndex(selected) === row.layer.index)}
                    <div class="relative flex h-7">
                      <button
                        class={[
                          "flex h-7 min-w-0 flex-1 items-center gap-2 border-b border-glass-800/40 pr-3 text-left text-xs transition",
                          row.type === "effect" ? "pl-6 @max-[360px]:pl-3" : "pl-3",
                          active
                            ? "bg-glass-800 text-neutral-100"
                            : "text-glass-400 enabled:hover:bg-glass-800/60 enabled:hover:text-neutral-200",
                        ]}
                        title={(row.type === "media" && row.layer.window?.title) || rowLabel(row)}
                        aria-pressed={active}
                        onclick={() =>
                          selectTrack(
                            recordingId,
                            row.layer.kind,
                            row.type === "media" ? row.layer.index : 0,
                            row.type === "effect" ||
                              row.layer.kind === "screen" ||
                              row.layer.kind === "camera"
                              ? row.id
                              : undefined,
                          )}
                        data-layer-label={row.type === "media" ? row.layer.kind : undefined}
                        data-layer-index={row.type === "media" ? row.layer.index : undefined}
                        data-effect-label={row.type === "effect" ? row.layer.kind : undefined}
                        data-effect-layer={row.type === "effect" ? row.id : undefined}
                      >
                        <Icon
                          name={row.type === "effect"
                            ? EFFECTS[row.layer.kind].icon
                            : row.layer.window
                              ? "pin"
                              : KINDS[row.layer.kind].icon}
                          class="size-3.5 shrink-0"
                        />
                        <span class="truncate @max-[360px]:sr-only"
                          >{numbered ? numbered[1] : rowLabel(row)}{row.type === "media" &&
                          row.layer.index > 0 &&
                          !row.layer.window
                            ? ` ${row.layer.index + 1}`
                            : ""}</span
                        >
                        {#if numbered}<span
                            class="shrink-0 text-glass-500 tabular-nums @max-[360px]:sr-only"
                            >{numbered[2]}</span
                          >{/if}
                      </button>
                    </div>
                  {/each}
                </div>
              {/each}
            </div>
          {/each}
        </div>

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          bind:this={timeline.content}
          class="relative min-h-full shrink-0 select-none"
          style:width={`${x(extent) + END_PAD}px`}
          onpointerdown={(event) => onPointerDown(event, true)}
          onpointermove={timeline.moveScrub}
          onpointerup={timeline.endScrub}
          onpointercancel={timeline.endScrub}
        >
          {#each groups as { recordingId, pieces, sections, first } (recordingId)}
            {@const shownPieces = pieces.map(({ shown }) => shown)}
            <div style:mask-image={cutMask} data-track-content>
              {#each sections as section, sectionIndex (section.id)}
                <div
                  class={sectionIndex > 0 ? "border-t border-glass-700/60" : undefined}
                  data-track-section={section.id}
                >
                  {#each section.rows as row (row.id)}
                    {#if row.type === "media"}
                      {@const layer = row.layer}
                      {@const runs = namedRuns(layer.blocks)}
                      {@const active =
                        selectedRecordingId === recordingId &&
                        openTrack === layer.kind &&
                        selectedTrackIndex(selected) === layer.index}
                      <div
                        class={[
                          "relative h-7 border-b border-glass-800/40",
                          active && "bg-white/[0.04]",
                        ]}
                        data-visual-layer={layer.kind === "screen" || layer.kind === "camera"
                          ? row.id
                          : undefined}
                        data-layer={layer.kind}
                        data-layer-index={layer.index}
                        data-layer-recording={recordingId}
                      >
                        {#each runs as run, i (i)}
                          <div
                            class={[
                              "absolute inset-y-1 overflow-hidden rounded-md",
                              KINDS[layer.kind].text,
                            ]}
                            style:left={`${run.left}px`}
                            style:width={`${run.width}px`}
                            style:mask-image={run.mask}
                            data-clip-shape
                          >
                            <div
                              class={[
                                "pointer-events-none absolute inset-0 rounded-[inherit] border",
                                KINDS[layer.kind].block,
                                active && "ring-1 ring-white/40 ring-inset",
                              ]}
                            ></div>
                            {#each run.blocks as block (block.sourceStart)}
                              {@const { left: blockLeft, width: blockWidth } = blockBox(
                                block.start,
                                block.end,
                              )}
                              <div
                                class={[
                                  "absolute inset-y-0 overflow-hidden",
                                  block.trimmed && "pointer-events-none",
                                ]}
                                style:left={`${blockLeft - run.left}px`}
                                style:width={`${blockWidth}px`}
                                title={`${block.file}  ${formatDuration(block.end - block.start)}`}
                                data-file={block.trimmed ? undefined : block.file}
                                data-trimmed={block.trimmed ? block.file : undefined}
                              >
                                {#if layer.kind === "microphone" || layer.kind === "systemAudio"}
                                  <AudioWaveform
                                    class={layer.kind === "systemAudio"
                                      ? "text-amber-600/50"
                                      : "text-emerald-600/50"}
                                    cache={waveforms}
                                    url={block.url}
                                    sourceStart={block.sourceStart}
                                    duration={block.end - block.start}
                                    width={blockWidth}
                                    from={Math.max(0, scrollLeft - blockLeft)}
                                    to={Math.min(blockWidth, scrollLeft + width - blockLeft)}
                                  />
                                {/if}
                              </div>
                            {/each}
                          </div>
                        {/each}
                        {#each runs as run, i (i)}
                          <div
                            class={[
                              "pointer-events-none absolute inset-y-1 z-10 overflow-hidden px-2 text-[11px] leading-5",
                              KINDS[layer.kind].text,
                            ]}
                            style:left={`${run.left}px`}
                            style:width={`${run.width}px`}
                            style:mask-image={run.mask}
                          >
                            <span
                              class="clip-label block truncate"
                              style:margin-left={`${hiddenStart(run.left)}px`}>{run.file}</span
                            >
                          </div>
                        {/each}
                      </div>
                    {:else}
                      {@const effect = row.layer}
                      {@const kind = effect.kind}
                      {@const spans = effectRuns(effect, shownPieces)}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div
                        class="relative h-7 border-b border-glass-800/40"
                        onpointerdown={(event) =>
                          onEffectDown(
                            event,
                            effect,
                            pieces.map(({ part }) => part),
                          )}
                        onpointermove={onEffectMove}
                        onpointerup={onEffectUp}
                        onpointercancel={onEffectUp}
                        data-effect={kind}
                        data-effect-layer={effect.id}
                        data-visual-layer={effect.id}
                      >
                        {#each shownPieces as shown (shown.pieceId)}
                          <div
                            class="absolute inset-y-1 cursor-crosshair rounded-md bg-white/[0.03]"
                            style:left={`${x(shown.offset)}px`}
                            style:width={`${Math.max(lengthOf(shown) * scale, 4)}px`}
                          ></div>
                        {/each}
                        {#if spans.length === 0}
                          <span
                            class="pointer-events-none absolute inset-y-0 flex items-center px-3 text-[10px] whitespace-nowrap text-glass-500"
                            style:left={`${x(first.offset)}px`}
                          >
                            Drag to enable {layerLabel(effect).toLowerCase()}
                          </span>
                        {/if}
                        {#each effectRuns(effect, shownPieces) as run (`${run.pieceId}:${run.index}`)}
                          <div
                            class="absolute inset-y-1 cursor-grab rounded-md active:cursor-grabbing"
                            style:left={`${run.left}px`}
                            style:width={`${run.width}px`}
                            title={`${layerLabel(effect)}  ${formatDuration(run.start)} to ${formatDuration(run.end)}`}
                            data-span={run.index}
                            data-span-piece={run.pieceId}
                            data-recording={run.recordingId}
                          >
                            <div
                              class={[
                                "pointer-events-none absolute inset-0 rounded-[inherit] border",
                                EFFECTS[kind].block,
                                isSelectedSpan(run.recordingId, effect.id, run.index) && [
                                  "ring-1 ring-inset",
                                  EFFECTS[kind].selected,
                                ],
                              ]}
                            ></div>
                            <div
                              class="absolute inset-y-0 -left-1 w-2.5 cursor-ew-resize"
                              data-edge="start"
                            ></div>
                            <div
                              class="absolute inset-y-0 -right-1 w-2.5 cursor-ew-resize"
                              data-edge="end"
                            ></div>
                          </div>
                        {/each}
                        {#each shownPieces.flatMap( (shown) => eventTicks(kind, shown) ) as time, i (i)}
                          <div
                            class="pointer-events-none absolute inset-y-2.5 w-px bg-white/35"
                            style:left={`${x(time)}px`}
                          ></div>
                        {/each}
                      </div>
                    {/if}
                  {/each}
                </div>
              {/each}
            </div>
          {/each}
          {#each cuts as cut, index (index)}
            <div
              data-cut
              class="pointer-events-none absolute inset-y-0"
              style:left={`${x(cut.start)}px`}
              style:width={`${(Math.min(cut.end, player.duration) - cut.start) * scale}px`}
            ></div>
            {#each ["start", "end"] as const as edge (edge)}
              <div
                role="slider"
                tabindex="0"
                class="group/edge absolute inset-y-0 z-[15] w-2.5 -translate-x-1/2 cursor-ew-resize touch-none outline-none"
                style:left={`${x(cut[edge])}px`}
                aria-label={`Cut ${index + 1} ${edge}`}
                aria-orientation="horizontal"
                aria-valuemin={cutBounds(index, edge).min}
                aria-valuemax={cutBounds(index, edge).max}
                aria-valuenow={cut[edge]}
                aria-valuetext={rulerLabel(cut[edge])}
                onpointerdown={(event) => onCutDown(event, index, edge)}
                onpointermove={onCutMove}
                onpointerup={onCutUp}
                onpointercancel={onCutUp}
                onkeydown={(event) => onCutKey(event, index, edge)}
                data-cut-edge={edge}
              >
                <div
                  class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/15 transition group-hover/edge:w-0.5 group-hover/edge:bg-primary group-focus-visible/edge:w-0.5 group-focus-visible/edge:bg-primary"
                ></div>
              </div>
            {/each}
          {/each}
          {#if snapLine !== null}
            <div
              data-snap-line
              class="pointer-events-none absolute inset-y-0 z-20 w-px bg-amber-300"
              style:left={`${x(snapLine)}px`}
            ></div>
          {/if}
          <div
            data-playhead
            class="playhead absolute inset-y-0 left-0 z-20 w-px cursor-ew-resize touch-none bg-white"
            style:transform={`translateX(${x(player.time)}px)`}
            title="Drag to adjust time"
          ></div>
        </div>
      </div>
    </div>
    <TimelineFooter label="Add track">
      {#snippet children({ close })}<MenuEntries entries={addTrackEntries()} {close} />{/snippet}
      {#snippet actions()}
        <button
          class={[
            "ml-auto flex h-7 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-glass-800 hover:text-neutral-100",
            snapping ? "bg-glass-800 text-neutral-100" : "text-glass-400",
          ]}
          onclick={() => (snapping = !snapping)}
          aria-pressed={snapping}
          aria-label="Snapping"
          title={withShortcut("Snapping", "snapping")}
          data-snapping
        >
          <Icon name="magnet" class="size-3.5" />
          <span class="@max-[360px]:sr-only">Snap</span>
        </button>
      {/snippet}
    </TimelineFooter>
  </div>
{:else}
  <div class="flex min-h-full flex-col">
    <p class="flex flex-1 items-center justify-center p-4 text-center text-[11px] text-glass-500">
      Recorded tracks will appear here.
    </p>
  </div>
{/if}

<style>
  .playhead::before {
    content: "";
    position: absolute;
    inset: 0 -5px;
  }

  .clip-label {
    text-shadow:
      0 1px 2px rgb(0 0 0 / 90%),
      0 0 4px rgb(0 0 0 / 80%);
  }
</style>
