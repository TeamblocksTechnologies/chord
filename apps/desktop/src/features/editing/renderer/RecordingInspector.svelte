<script lang="ts">
  import type { Backgrounds } from "#features/background-removal/renderer/backgrounds.svelte";
  import type { NoiseStates } from "#features/audio-processing/renderer/noise.svelte";
  import {
    selectedTrack,
    selectedLayerId,
    selectedTrackIndex,
    type WorkspaceSelection,
  } from "./selection.ts";
  import type { Transcriptions } from "#features/transcription/renderer/transcriptions.svelte";
  import type { Project, Recording } from "#project-document/domain/recording";
  import { appName } from "#features/recording/renderer/apps.svelte";
  import { layersOf } from "#media-engine/renderer/timeline";
  import type { TranscriptCut, TranscriptPlayback } from "#media-engine/renderer/transcript";
  import CameraBackgroundPanel from "#features/background-removal/renderer/CameraBackgroundPanel.svelte";
  import Inspector from "@teamblocks.dev/chord-ui/Inspector.svelte";
  import TranscriptPanel from "./TranscriptPanel.svelte";
  import { isAnnotationLayer, visualLayersOf } from "../domain/visualLayers.ts";
  import AudioTrackPanel from "./AudioTrackPanel.svelte";
  import AnnotationTrackPanel from "./AnnotationTrackPanel.svelte";

  /** A recording edited on its own: its transcript, and each of its tracks that has something to adjust. */
  let {
    project,
    recording,
    selected,
    backgrounds,
    noise,
    transcriptions,
    playback,
    onseek,
    ontoggle,
    oncut,
    onrestore,
    onrecut,
    onundo,
    onselect,
  }: {
    project: Project;
    recording: Recording;
    selected: WorkspaceSelection | null;
    backgrounds: Backgrounds;
    noise: NoiseStates;
    transcriptions: Transcriptions;
    playback: TranscriptPlayback;
    onseek: (time: number) => void;
    ontoggle: () => void;
    oncut: (recordingId: string, ranges: TranscriptCut[]) => void;
    onrecut: (recordingId: string, cuts: TranscriptCut[]) => void;
    onrestore: (recordingId: string, start: number, end: number) => void;
    onundo: () => void;
    onselect: (selection: WorkspaceSelection) => void;
  } = $props();

  const MEDIA = {
    screen: "Screen",
    camera: "Camera",
    microphone: "Microphone",
    systemAudio: "System audio",
  } as const;

  /** Selecting a track opens its settings; the microphone opens the transcript. */
  const section = $derived(
    selectedTrack(selected) ??
      (recording.hasMicrophone
        ? "microphone"
        : recording.mode
          ? "screen"
          : recording.hasCamera
            ? "camera"
            : recording.hasSystemAudio
              ? "systemAudio"
              : undefined),
  );
  const media = $derived(section && section in MEDIA ? (section as keyof typeof MEDIA) : undefined);
  const index = $derived(selectedTrackIndex(selected));
  const effect = $derived(
    visualLayersOf(recording)
      .filter(isAnnotationLayer)
      .find((layer) => layer.id === selectedLayerId(selected)),
  );
  const duration = $derived(
    playback.parts.find((part) => part.recordingId === recording.id)?.timeline.duration ??
      recording.duration,
  );
  const layers = $derived(
    media
      ? playback.parts
          .filter((part) => part.recordingId === recording.id)
          .flatMap(layersOf)
          .filter((layer) => layer.kind === media && layer.index === index)
      : [],
  );
  /** The files the selected media track plays, in order. */
  const files = $derived([
    ...new Set(layers.flatMap((layer) => layer.blocks.map((block) => block.file))),
  ]);
  /** A pinned window's track is named for its app. */
  const pinned = $derived(layers.find((layer) => layer.window)?.window);
  const camera = $derived(
    recording.directory ? backgrounds.states[recording.directory] : undefined,
  );
  const canReprocess = $derived(
    !!camera?.result?.settings && camera.phase !== "queued" && camera.phase !== "processing",
  );
</script>

{#key recording.id}
  {#if media}
    <Inspector
      title={pinned ? appName(pinned.bundleId) : `${MEDIA[media]}${index ? ` ${index + 1}` : ""}`}
      detail={files.length > 1 ? `${files[0]} and ${files.length - 1} more` : files[0]}
      reveal={recording.directory
        ? () =>
            void window.chord.desktop.recording.reveal(
              files[0] ? `${recording.directory}/${files[0]}` : recording.directory!,
            )
        : undefined}
      actions={media === "camera" && canReprocess
        ? [
            {
              label: "Process background again",
              onselect: () => {
                if (recording.directory) void backgrounds.run(recording.directory);
              },
            },
          ]
        : []}
    >
      {#if media === "microphone"}
        <AudioTrackPanel {project} {recording} kind="microphone" {index} {noise} />
        <TranscriptPanel
          {recording}
          {transcriptions}
          {playback}
          {onseek}
          {ontoggle}
          {oncut}
          {onrestore}
          {onrecut}
          {onundo}
        />
      {:else if media === "systemAudio"}
        <AudioTrackPanel {project} {recording} kind="systemAudio" {index} {noise} />
      {:else if media === "camera"}
        <CameraBackgroundPanel {recording} {backgrounds} />
      {/if}
    </Inspector>
  {:else if effect}
    <AnnotationTrackPanel {project} {recording} layer={effect} {selected} {duration} {onselect} />
  {/if}
{/key}
